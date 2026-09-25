/* Durable Object com SQLite: o único sítio onde o site guarda estado.
   hits (etapas 1 a 4 e canários) · requests (chamadas MCP) · contacts (pedidos com consentimento,
   em cadeia de hashes) · scans (Scanner Agent-Ready) · ranges (listas oficiais de IPs de bots) · rate.
   O sal do hash de IP nasce aqui, aleatório, na primeira escrita: nunca está no repositório.
   O IP em claro chega só para ser verificado contra as listas e transformado em hash; nunca se grava. */
import { DurableObject } from 'cloudflare:workers';
import { sha256Hex, nowIso, canonical } from './util';
import { LISTS, cidrsFrom, inNets, parseCidr, parseIp, type Net } from './ranges';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hits (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, etapa TEXT NOT NULL, operador TEXT, bot TEXT, path TEXT,
  ua TEXT, referer_src TEXT, country TEXT, asn INTEGER, ip_hash TEXT, signed_agent INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS hits_ts ON hits(ts);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, tool TEXT, method TEXT, status TEXT, error_code TEXT,
  latency_ms INTEGER, user_agent TEXT, agent_profile TEXT, ip_hash TEXT, query_text TEXT, lang TEXT);
CREATE INDEX IF NOT EXISTS requests_ts ON requests(created_at);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT, email TEXT, topic TEXT, message TEXT,
  language TEXT, consent_statement TEXT, consent_given_at TEXT, agent_profile TEXT, ip_hash TEXT, dry_run INTEGER);
CREATE TABLE IF NOT EXISTS rate (ip_hash TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_ip ON rate(ip_hash, ts);
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, host TEXT NOT NULL, score INTEGER, result TEXT, ip_hash TEXT, cached INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS scans_host ON scans(host, ts);
CREATE TABLE IF NOT EXISTS ranges (operador TEXT NOT NULL, cidr TEXT NOT NULL);
`;
// Colunas acrescentadas depois do primeiro deploy (ALTER falha se já existirem: ignora-se).
const MIGRATIONS = [
	'ALTER TABLE hits ADD COLUMN canario TEXT',
	'ALTER TABLE hits ADD COLUMN verificado INTEGER',
	'ALTER TABLE requests ADD COLUMN results_n INTEGER',
	'ALTER TABLE requests ADD COLUMN top_score INTEGER',
	'ALTER TABLE contacts ADD COLUMN consent_hash TEXT',
	'ALTER TABLE contacts ADD COLUMN prev_chain_hash TEXT',
	'ALTER TABLE contacts ADD COLUMN chain_hash TEXT',
];
const GENESIS = '0'.repeat(64);
const RANGES_TTL_MS = 24 * 3600_000;

export class AgentObs extends DurableObject {
	private ready = false;
	private salt: string | null = null;
	private nets: Map<string, Net[]> | null = null;

	private async init(): Promise<void> {
		if (this.ready) return;
		this.ctx.storage.sql.exec(SCHEMA);
		for (const m of MIGRATIONS) {
			try { this.ctx.storage.sql.exec(m); } catch { /* coluna já existe */ }
		}
		let salt = await this.ctx.storage.get<string>('salt');
		if (!salt) {
			salt = crypto.randomUUID() + crypto.randomUUID();
			await this.ctx.storage.put('salt', salt);
		}
		this.salt = salt;
		this.ready = true;
	}

	private async ipHash(ip: string): Promise<string> {
		return sha256Hex(`${this.salt}:${ip}`);
	}

	/** Carrega as listas de IPs (memória > SQLite > rede). Refresca de 24 em 24 horas. */
	private async loadNets(): Promise<Map<string, Net[]>> {
		const sql = this.ctx.storage.sql;
		const at = (await this.ctx.storage.get<number>('ranges_at')) ?? 0;
		if (Date.now() - at > RANGES_TTL_MS) {
			for (const [op, urls] of Object.entries(LISTS)) {
				const cidrs: string[] = [];
				for (const u of urls) {
					try {
						const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'andresilvalab-agent-obs/1.0 (+https://andresilvalab.com/agents.md)' } });
						if (r.ok) cidrs.push(...cidrsFrom(await r.json()));
					} catch { /* lista em baixo: mantém a anterior */ }
				}
				if (cidrs.length) {
					sql.exec('DELETE FROM ranges WHERE operador = ?', op);
					for (const c of cidrs) sql.exec('INSERT INTO ranges VALUES (?,?)', op, c);
				}
			}
			await this.ctx.storage.put('ranges_at', Date.now());
			this.nets = null;
		}
		if (!this.nets) {
			const m = new Map<string, Net[]>();
			for (const row of sql.exec('SELECT operador, cidr FROM ranges').toArray()) {
				const n = parseCidr(String(row.cidr));
				if (!n) continue;
				const k = String(row.operador);
				if (!m.has(k)) m.set(k, []);
				m.get(k)!.push(n);
			}
			this.nets = m;
		}
		return this.nets;
	}

	/** 1 = IP dentro das redes do operador · 0 = fora (impostor) · null = operador sem lista publicada. */
	private async verify(ip: string, operador: string | null): Promise<number | null> {
		if (!operador || !(operador in LISTS)) return null;
		const nets = (await this.loadNets()).get(operador);
		const parsed = parseIp(ip);
		if (!nets?.length || !parsed) return null;
		return inNets(parsed, nets) ? 1 : 0;
	}

	async fetch(req: Request): Promise<Response> {
		await this.init();
		const url = new URL(req.url);
		const body = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : {};
		const sql = this.ctx.storage.sql;
		const ip = String(body.ip ?? 'unknown');
		switch (url.pathname) {
			case '/log-hit': {
				const operador = (body.operador as string) ?? null;
				const verificado = body.bot || body.canario ? await this.verify(ip, operador) : null;
				sql.exec(
					`INSERT OR IGNORE INTO hits (id, ts, etapa, operador, bot, path, ua, referer_src, country, asn, ip_hash, signed_agent, canario, verificado)
					 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
					crypto.randomUUID(), nowIso(), String(body.etapa), operador, body.bot ?? null, body.path ?? null,
					body.ua ?? null, body.referer_src ?? null, body.country ?? null, body.asn ?? null, await this.ipHash(ip),
					body.signed_agent ? 1 : 0, body.canario ?? null, verificado,
				);
				return ok();
			}
			case '/log-request': {
				sql.exec(
					`INSERT OR IGNORE INTO requests (id, created_at, tool, method, status, error_code, latency_ms, user_agent, agent_profile, ip_hash, query_text, lang, results_n, top_score)
					 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
					crypto.randomUUID(), nowIso(), body.tool ?? null, body.method ?? 'POST', body.status ?? 'ok', body.error_code ?? null,
					body.latency_ms ?? null, body.user_agent ?? null, body.agent_profile ?? null, await this.ipHash(ip),
					body.query_text ? String(body.query_text).slice(0, 500) : null, body.lang ?? null,
					body.results_n ?? null, body.top_score ?? null,
				);
				return ok();
			}
			case '/contact': {
				// Prova de consentimento: hash canónico do que a pessoa confirmou, encadeado ao anterior.
				// O DO serializa as escritas, por isso a cadeia não tem corridas.
				const proof = {
					site: 'andresilvalab', name: body.name, email: body.email, topic: body.topic ?? null, message: body.message,
					language: body.language ?? null, consent_statement: body.consent_statement, consent_given_at: body.consent_given_at,
					agent_profile: body.agent_profile ?? null,
				};
				const consentHash = await sha256Hex(canonical(proof));
				const last = sql.exec('SELECT chain_hash FROM contacts WHERE chain_hash IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 1').toArray();
				const prev = last.length ? String(last[0].chain_hash) : GENESIS;
				const chain = await sha256Hex(`${prev}:${consentHash}`);
				const id = crypto.randomUUID();
				sql.exec(
					`INSERT INTO contacts (id, created_at, name, email, topic, message, language, consent_statement, consent_given_at, agent_profile, ip_hash, dry_run, consent_hash, prev_chain_hash, chain_hash)
					 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
					id, nowIso(), body.name, body.email, body.topic ?? null, body.message, body.language ?? null,
					body.consent_statement, body.consent_given_at, body.agent_profile ?? null, await this.ipHash(ip), body.dry_run ? 1 : 0,
					consentHash, prev, chain,
				);
				return json({ id, consent_hash: consentHash, chain_hash: chain });
			}
			case '/rate': {
				const h = await this.ipHash(ip);
				const now = Date.now();
				const win = Number(body.window_s ?? 600) * 1000;
				sql.exec('DELETE FROM rate WHERE ts < ?', now - 3600_000);
				const n = Number(sql.exec('SELECT COUNT(*) AS n FROM rate WHERE ip_hash = ? AND ts >= ?', h, now - win).one().n);
				const allowed = n < Number(body.max ?? 60);
				if (allowed) sql.exec('INSERT INTO rate VALUES (?,?)', h, now);
				return json({ allowed, ip_hash: h });
			}
			case '/scan-cache': {
				const since = new Date(Date.now() - Number(body.ttl_s ?? 1800) * 1000).toISOString();
				const r = sql.exec('SELECT ts, result FROM scans WHERE host = ? AND cached = 0 AND ts > ? ORDER BY ts DESC LIMIT 1', String(body.host), since).toArray();
				return json(r.length ? { hit: true, ts: r[0].ts, result: JSON.parse(String(r[0].result)) } : { hit: false });
			}
			case '/scan-log': {
				sql.exec('INSERT INTO scans (id, ts, host, score, result, ip_hash, cached) VALUES (?,?,?,?,?,?,?)',
					crypto.randomUUID(), nowIso(), String(body.host), body.score ?? null, body.cached ? null : JSON.stringify(body.result ?? null),
					await this.ipHash(ip), body.cached ? 1 : 0);
				return ok();
			}
			case '/export': {
				const since = String(body.since);
				const limit = Number(body.limit ?? 5000);
				const rows = sql.exec('SELECT * FROM requests WHERE created_at > ? ORDER BY created_at, id LIMIT ?', since, limit).toArray();
				const hits = sql.exec('SELECT * FROM hits WHERE ts > ? ORDER BY ts, id LIMIT ?', since, limit).toArray();
				const contacts = sql.exec('SELECT * FROM contacts WHERE created_at > ? ORDER BY created_at, id LIMIT ?', since, limit).toArray();
				const scans = sql.exec('SELECT id, ts, host, score, cached, ip_hash FROM scans WHERE ts > ? ORDER BY ts LIMIT ?', since, limit).toArray();
				const rangesAt = (await this.ctx.storage.get<number>('ranges_at')) ?? 0;
				const rangesN = sql.exec('SELECT operador, COUNT(*) AS n FROM ranges GROUP BY operador').toArray();
				const last = (xs: Record<string, unknown>[], k: string) => (xs.length === limit ? (xs[xs.length - 1][k] as string) : null);
				return json({
					generated_at: nowIso(), since, rows, hits, contacts, scans,
					ranges: { refreshed_at: rangesAt ? new Date(rangesAt).toISOString() : null, operators: rangesN },
					next_since: last(rows, 'created_at') ?? last(hits, 'ts'),
				});
			}
			default:
				return new Response('not found', { status: 404 });
		}
	}
}

function ok(): Response { return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }
function json(b: unknown): Response { return new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } }); }
