/* Durable Object com SQLite: o único sítio onde o site guarda estado. Três tabelas:
   hits (etapas 1 a 4), requests (chamadas MCP, etapas 5 e 6) e contacts (pedidos de contacto com
   consentimento). O sal do hash de IP nasce aqui, aleatório, na primeira escrita: nunca está no repo. */
import { DurableObject } from 'cloudflare:workers';
import { sha256Hex, nowIso } from './util';

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
`;

export class AgentObs extends DurableObject {
	private ready = false;
	private salt: string | null = null;

	private async init(): Promise<void> {
		if (this.ready) return;
		this.ctx.storage.sql.exec(SCHEMA);
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

	async fetch(req: Request): Promise<Response> {
		await this.init();
		const url = new URL(req.url);
		const body = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : {};
		const sql = this.ctx.storage.sql;
		const ip = String(body.ip ?? 'unknown');
		switch (url.pathname) {
			case '/log-hit': {
				sql.exec(
					'INSERT OR IGNORE INTO hits VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
					crypto.randomUUID(), nowIso(), String(body.etapa), body.operador ?? null, body.bot ?? null, body.path ?? null,
					body.ua ?? null, body.referer_src ?? null, body.country ?? null, body.asn ?? null, await this.ipHash(ip), body.signed_agent ? 1 : 0,
				);
				return ok();
			}
			case '/log-request': {
				sql.exec(
					'INSERT OR IGNORE INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
					crypto.randomUUID(), nowIso(), body.tool ?? null, body.method ?? 'POST', body.status ?? 'ok', body.error_code ?? null,
					body.latency_ms ?? null, body.user_agent ?? null, body.agent_profile ?? null, await this.ipHash(ip),
					body.query_text ? String(body.query_text).slice(0, 500) : null, body.lang ?? null,
				);
				return ok();
			}
			case '/contact': {
				sql.exec(
					'INSERT INTO contacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
					crypto.randomUUID(), nowIso(), body.name, body.email, body.topic ?? null, body.message, body.language ?? null,
					body.consent_statement, body.consent_given_at, body.agent_profile ?? null, await this.ipHash(ip), body.dry_run ? 1 : 0,
				);
				return ok();
			}
			case '/rate': {
				const h = await this.ipHash(ip);
				const now = Date.now();
				const win = Number(body.window_s ?? 600) * 1000;
				sql.exec('DELETE FROM rate WHERE ts < ?', now - win);
				const n = Number(sql.exec('SELECT COUNT(*) AS n FROM rate WHERE ip_hash = ?', h).one().n);
				const allowed = n < Number(body.max ?? 60);
				if (allowed) sql.exec('INSERT INTO rate VALUES (?,?)', h, now);
				return json({ allowed, ip_hash: h });
			}
			case '/contacts-today': {
				const h = await this.ipHash(ip);
				const since = new Date(Date.now() - 86400_000).toISOString();
				const n = Number(sql.exec('SELECT COUNT(*) AS n FROM contacts WHERE ip_hash = ? AND dry_run = 0 AND created_at > ?', h, since).one().n);
				return json({ n });
			}
			case '/export': {
				const since = String(body.since);
				const limit = Number(body.limit ?? 5000);
				const rows = sql.exec('SELECT * FROM requests WHERE created_at > ? ORDER BY created_at, id LIMIT ?', since, limit).toArray();
				const hits = sql.exec('SELECT * FROM hits WHERE ts > ? ORDER BY ts, id LIMIT ?', since, limit).toArray();
				const contacts = sql.exec('SELECT * FROM contacts WHERE created_at > ? ORDER BY created_at LIMIT ?', since, limit).toArray();
				const last = (xs: Record<string, unknown>[], k: string) => (xs.length === limit ? (xs[xs.length - 1][k] as string) : null);
				return json({ generated_at: nowIso(), since, rows, hits, contacts, next_since: last(rows, 'created_at') ?? last(hits, 'ts') });
			}
			default:
				return new Response('not found', { status: 404 });
		}
	}
}

function ok(): Response { return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }
function json(b: unknown): Response { return new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } }); }
