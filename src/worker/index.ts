/* Worker do andresilvalab.com: corre antes dos static assets (run_worker_first) e faz três coisas.
   1. Observabilidade de agentes de IA por etapa: regista crawlers de índice (1), de treino (2), fetchers
      accionados por perguntas de utilizadores (3) e cliques vindos de assistentes (4). Só bots de IA
      conhecidos e referências de assistentes; visitas humanas normais não são registadas (o site não
      tem trackers e continua sem os ter). IP guardado só em hash com sal gerado no próprio objecto.
   2. Servidor MCP em /mcp (JSON-RPC 2.0, sem estado): tools de leitura sobre o índice de artigos e
      uma tool de contacto que exige consentimento explícito e nasce em dry_run.
   3. Exportação para a Torre em /api/agent-obs/export, protegida por token (hash em vars).
   O prompt do utilizador nunca chega aqui: o que se regista é o que o agente escolhe enviar às tools. */

import { AgentObs } from './obs';
import { classify, isAiReferral } from './bots';
import { handleMcp } from './mcp';
import { sha256Hex } from './util';
import { normaliseTarget, scan } from './scan';

export { AgentObs };

export interface Env {
	ASSETS: { fetch(req: Request): Promise<Response> };
	AGENT_OBS: DurableObjectNamespace;
	OPS_TOKEN_HASH: string;
	SITE_URL: string;
}

const RATE_MAX = 60;           // chamadas por janela, por ip_hash
const RATE_WINDOW_S = 600;
const SCAN_MAX = 10;           // scans por hora, por ip_hash
const SCAN_CACHE_S = 1800;     // o mesmo domínio devolve o resultado guardado durante 30 min

/* Canários: um link que só existe num ficheiro para máquinas. Um pedido a este caminho prova que
   quem o fez leu aquele ficheiro. Anunciados como tal no agents.md (transparência, não armadilha). */
const CANARIES = new Set(['llms-txt', 'llms-full', 'agents-md', 'mcp-json', 'agent-index']);

function obs(env: Env): DurableObjectStub {
	return env.AGENT_OBS.get(env.AGENT_OBS.idFromName('main'));
}

function clientIp(req: Request): string {
	return req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function post(stub: DurableObjectStub, path: string, body: unknown): Promise<Response> {
	return stub.fetch(`https://obs${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const stub = obs(env);
		const ip = clientIp(request);
		const ua = request.headers.get('user-agent') || '';
		const cf = (request as Request & { cf?: Record<string, unknown> }).cf || {};

		// ── exportação para a Torre ───────────────────────────────────────────
		if (path === '/api/agent-obs/export') {
			const token = request.headers.get('x-ops-token')?.trim() || '';
			const ok = token.length > 0 && (await sha256Hex(token)) === env.OPS_TOKEN_HASH;
			const since = url.searchParams.get('since') || '';
			const limit = Math.min(20000, Math.max(1, Number(url.searchParams.get('limit') || 5000) || 5000));
			if (!ok || request.method !== 'GET' || !/^\d{4}-\d{2}-\d{2}/.test(since)) {
				ctx.waitUntil(post(stub, '/log-request', { ip, tool: 'agent-obs-export', method: request.method, status: 'error', error_code: ok ? 'invalid_since' : 'unauthorized', user_agent: ua.slice(0, 500) }));
				return json({ error: ok ? "Query param 'since' (ISO 8601) is required" : 'Unauthorized' }, ok ? 400 : 401);
			}
			const r = await post(stub, '/export', { since, limit });
			ctx.waitUntil(post(stub, '/log-request', { ip, tool: 'agent-obs-export', method: 'GET', status: 'ok', user_agent: ua.slice(0, 500) }));
			return new Response(await r.text(), { status: 200, headers: { 'content-type': 'application/json' } });
		}

		// ── servidor MCP ──────────────────────────────────────────────────────
		if (path === '/mcp') {
			if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
			if (request.method === 'GET') return json({ name: 'André Silva Lab', spec: '/.well-known/mcp.json' }, 200);
			if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST, OPTIONS' });
			const started = Date.now();
			const rate = await (await post(stub, '/rate', { ip, max: RATE_MAX, window_s: RATE_WINDOW_S })).json<{ allowed: boolean; ip_hash: string }>();
			if (!rate.allowed) {
				ctx.waitUntil(post(stub, '/log-request', { ip, tool: null, method: 'POST', status: 'rate_limited', error_code: 'rate_limited', user_agent: ua.slice(0, 500), latency_ms: Date.now() - started }));
				return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Rate limited', data: { code: 'rate_limited', retry_after_seconds: RATE_WINDOW_S } } }, 429, { 'Retry-After': String(RATE_WINDOW_S) });
			}
			const result = await handleMcp(request, env, { ip });
			ctx.waitUntil(post(stub, '/log-request', { ...result.log, ip, user_agent: ua.slice(0, 500), agent_profile: request.headers.get('x-agent-profile'), latency_ms: Date.now() - started }));
			if (result.contact) ctx.waitUntil(post(stub, '/contact', result.contact));
			return json(result.body, result.status ?? 200, CORS);
		}

		// ── canários ──────────────────────────────────────────────────────────
		const can = path.match(/^\/c\/([a-z-]+)\/?$/);
		if (can && CANARIES.has(can[1])) {
			const bot = classify(ua, request.headers);
			ctx.waitUntil(post(stub, '/log-hit', {
				ip, path, ua: ua.slice(0, 300), etapa: bot ? bot.etapa : 'c', operador: bot?.operador ?? null, bot: bot?.bot ?? null,
				canario: can[1], country: (cf.country as string) ?? null, asn: (cf.asn as number) ?? null, signed_agent: request.headers.has('signature-agent'),
			}));
			return new Response(null, { status: 302, headers: { location: `${env.SITE_URL}/`, 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } });
		}

		// ── Scanner Agent-Ready ───────────────────────────────────────────────
		if (path === '/api/scan') {
			if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, { Allow: 'GET' });
			const target = normaliseTarget(url.searchParams.get('url') || '');
			if (!target) return json({ error: 'invalid_url', message: 'Indica um domínio público, por exemplo exemplo.pt' }, 400);
			const cached = await (await post(stub, '/scan-cache', { host: target.hostname, ttl_s: SCAN_CACHE_S })).json<{ hit: boolean; ts?: string; result?: unknown }>();
			if (cached.hit) {
				ctx.waitUntil(post(stub, '/scan-log', { ip, host: target.hostname, score: (cached.result as { score?: number })?.score ?? null, cached: true }));
				return json({ cached: true, cached_at: cached.ts, ...(cached.result as object) }, 200, { 'cache-control': 'no-store' });
			}
			const rate = await (await post(stub, '/rate', { ip: `scan:${ip}`, max: SCAN_MAX, window_s: 3600 })).json<{ allowed: boolean }>();
			if (!rate.allowed) return json({ error: 'rate_limited', message: 'Limite de 10 análises por hora.' }, 429, { 'Retry-After': '3600' });
			const result = await scan(target);
			ctx.waitUntil(post(stub, '/scan-log', { ip, host: target.hostname, score: result.score, result, cached: false }));
			return json({ cached: false, ...result }, 200, { 'cache-control': 'no-store' });
		}

		// ── observabilidade por etapa, depois entrega o asset ─────────────────
		const bot = classify(ua, request.headers);
		const ref = isAiReferral(request.headers.get('referer'), url);
		if (bot || ref) {
			ctx.waitUntil(post(stub, '/log-hit', {
				ip, path: path.slice(0, 300), ua: ua.slice(0, 300),
				etapa: bot ? bot.etapa : '4', operador: bot ? bot.operador : ref!.operador, bot: bot?.bot ?? null,
				referer_src: ref?.fonte ?? null, country: (cf.country as string) ?? null, asn: (cf.asn as number) ?? null,
				signed_agent: request.headers.has('signature-agent'),
			}));
		}
		const res = await env.ASSETS.fetch(request);
		if (path === '/agents.md') {
			const h = new Headers(res.headers); h.set('content-type', 'text/markdown; charset=utf-8');
			return new Response(res.body, { status: res.status, headers: h });
		}
		return res;
	},
};

const CORS: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Protocol-Version, X-Agent-Profile',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...extra } });
}
