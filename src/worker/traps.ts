/* Medição de agentes (P8, detecção de enxames): armadilhas declaradas no agents.md e canário de instrução.
   Visitas normais não se registam: a emissão do canário não escreve nada. Só quem pede um endpoint de
   medição (honeypot ou link do canário) fica registado, seja pessoa ou agente, com IP em hash.

   Token sem estado, 40 hex: kid(1) hora(5) pagina(6) t_pfx(4) t_asn(4) t_ua(4) mac(16).
   - hora: horas desde 2026-01-01 UTC; o dia (hora/24) entra em todas as tags, para nada ligar visitas entre dias.
   - t_pfx/t_asn/t_ua: HMAC do /24 (v4) ou /48 (v6), do ASN e do User-Agent de quem recebeu a página.
   - mac: HMAC-SHA-256 do resto, truncado a 64 bits. Sem o segredo não se forja nem se lê nada.
   Quem apresenta o token é comparado com quem o recebeu: mesma rede (/24 ou /48) = leu e seguiu; mesmo ASN =
   mesma rede de saída (pools de egress, IPv6 com privacy extensions); mesmo UA de bot conhecido noutro ASN =
   frota; o resto = transferência entre redes, o sinal de coordenação. */

import { parseIp } from './ranges';

export interface TrapEnv {
	ZEUS_KID?: string;
	ZEUS_SECRET_1?: string;
	ZEUS_SECRET_2?: string;
}

export type Trap = 'admin_export' | 'api_internal' | 'env_example' | 'canario' | 'controlo';
export type Veredicto =
	| 'forjado' | 'token_velho' | 'leu_e_seguiu' | 'mesma_rede' | 'frota' | 'transferencia'
	| 'sem_segredo' | 'crawler_verificado';

const EPOCH = Date.UTC(2026, 0, 1);
const MAX_IDADE_H = 72;
const SELF = 'https://andresilvalab.com';

export function horaAgora(now = Date.now()): number {
	return Math.floor((now - EPOCH) / 3600_000);
}

/* ── chaves: um importKey por isolate e por kid ───────────────────────────── */
const keys = new Map<string, Promise<CryptoKey>>();
function segredo(env: TrapEnv, kid: string): string | undefined {
	return (env as Record<string, string | undefined>)[`ZEUS_SECRET_${kid}`] || undefined;
}
function chave(env: TrapEnv, kid: string): Promise<CryptoKey> | null {
	const s = segredo(env, kid);
	if (!s) return null;
	const k = `${kid}:${s.length}:${s.slice(0, 4)}`;
	if (!keys.has(k)) {
		keys.set(k, crypto.subtle.importKey('raw', new TextEncoder().encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
	}
	return keys.get(k)!;
}
export function kidActual(env: TrapEnv): string | null {
	const kid = env.ZEUS_KID && /^[1-9]$/.test(env.ZEUS_KID) ? env.ZEUS_KID : '1';
	return segredo(env, kid) ? kid : null;
}
async function hmacHex(key: CryptoKey, msg: string, chars: number): Promise<string> {
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, chars);
}
/** Comparação em tempo constante para strings do mesmo comprimento (o MAC é truncado, não dá para subtle.verify). */
function igual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let d = 0;
	for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return d === 0;
}

/* ── identidade de rede ───────────────────────────────────────────────────── */
/** Rede de um IP. 'tag': /24 em IPv4 e /48 em IPv6 (identidade de quem leu). 'tecto': IP inteiro em IPv4 e /64 em
    IPv6 (origem para os tectos de escrita; sem isto um /64 dava 2^64 origens). */
export function prefixo(ip: string, uso: 'tag' | 'tecto' = 'tag'): string {
	const p = parseIp(ip);
	if (!p) return `x:${ip.slice(0, 64)}`;
	if (p.v6) return `6:${(p.n >> (uso === 'tag' ? 80n : 64n)).toString(16)}`;
	return `4:${(uso === 'tag' ? p.n >> 8n : p.n).toString(16)}`;
}
async function paginaId(path: string): Promise<string> {
	const p = path.replace(/\/+$/, '') || '/';
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p));
	return [...new Uint8Array(buf)].slice(0, 3).map((b) => b.toString(16).padStart(2, '0')).join('');
}
interface Cliente { ip: string; asn: number | null; ua: string }
async function tags(key: CryptoKey, dia: number, c: Cliente): Promise<[string, string, string]> {
	return Promise.all([
		hmacHex(key, `p|${dia}|${prefixo(c.ip)}`, 4),
		hmacHex(key, `a|${dia}|${c.asn ?? '-'}`, 4),
		hmacHex(key, `u|${dia}|${c.ua.slice(0, 300)}`, 4),
	]);
}

/* ── emissão (sem escrita) ────────────────────────────────────────────────── */
export async function emitir(env: TrapEnv, path: string, c: Cliente, now = Date.now()): Promise<string | null> {
	const kid = kidActual(env);
	const key = kid ? chave(env, kid) : null;
	if (!kid || !key) return null;
	const k = await key;
	const hora = horaAgora(now);
	const [tp, ta, tu] = await tags(k, Math.floor(hora / 24), c);
	const corpo = `${kid}${hora.toString(16).padStart(5, '0')}${await paginaId(path)}${tp}${ta}${tu}`;
	return corpo + (await hmacHex(k, corpo, 16));
}

/* ── verificação na apresentação ──────────────────────────────────────────── */
export interface Verificacao {
	veredicto: Veredicto;
	tok: string | null;          // 12 hex do mac: identifica o token sem o guardar inteiro
	tok_pagina: string | null;
	tok_hora: number | null;
	rede: string | null;          // tag diária da rede de quem apresenta (conta redes distintas por token)
}
export async function verificar(env: TrapEnv, t: string, c: Cliente, botConhecido: boolean, now = Date.now()): Promise<Verificacao> {
	const vazio = { tok: null, tok_pagina: null, tok_hora: null, rede: null };
	if (!/^[1-9][0-9a-f]{39}$/.test(t)) return { veredicto: 'forjado', ...vazio };
	const kid = t[0];
	const key = chave(env, kid);
	if (!key) return { veredicto: kidActual(env) ? 'forjado' : 'sem_segredo', ...vazio };
	const k = await key;
	const corpo = t.slice(0, 24);
	if (!igual(await hmacHex(k, corpo, 16), t.slice(24))) return { veredicto: 'forjado', ...vazio };
	const hora = parseInt(t.slice(1, 6), 16);
	const pagina = t.slice(6, 12);
	const [ep, ea, eu] = [t.slice(12, 16), t.slice(16, 20), t.slice(20, 24)];
	const base = { tok: t.slice(24, 36), tok_pagina: pagina, tok_hora: hora };
	const [pp, pa, pu] = await tags(k, Math.floor(hora / 24), c);
	const rede = await hmacHex(k, `r|${Math.floor(horaAgora(now) / 24)}|${prefixo(c.ip)}`, 8);
	if (horaAgora(now) - hora > MAX_IDADE_H) return { veredicto: 'token_velho', ...base, rede };
	if (igual(ep, pp)) return { veredicto: 'leu_e_seguiu', ...base, rede };
	if (igual(ea, pa)) return { veredicto: 'mesma_rede', ...base, rede };
	if (botConhecido && igual(eu, pu)) return { veredicto: 'frota', ...base, rede };
	return { veredicto: 'transferencia', ...base, rede };
}

/* ── red-team: cabeçalho assinado, nunca entra na pontuação ───────────────── */
export async function runId(env: TrapEnv, header: string | null): Promise<{ run_id: string | null; run_invalido: number }> {
	if (!header) return { run_id: null, run_invalido: 0 };
	const m = header.trim().match(/^([a-z0-9-]{1,40})\.([0-9a-f]{16})$/);
	const kid = kidActual(env);
	const key = kid ? chave(env, kid) : null;
	if (!m || !key) return { run_id: null, run_invalido: 1 };
	return igual(await hmacHex(await key, `run|${m[1]}`, 16), m[2]) ? { run_id: m[1], run_invalido: 0 } : { run_id: null, run_invalido: 1 };
}

/* ── rotas ─────────────────────────────────────────────────────────────────── */
export function trapDe(path: string): { trap: Trap; token: string | null } | null {
	const p = path.replace(/\/+$/, '') || '/';
	if (p === '/admin/export') return { trap: 'admin_export', token: null };
	if (p === '/api/v1/internal' || p.startsWith('/api/v1/internal/')) return { trap: 'api_internal', token: null };
	if (p === '/.env.example') return { trap: 'env_example', token: null };
	const l = p.match(/^\/_v\/l\/([^/]{1,80})$/);
	if (l) return { trap: 'controlo', token: l[1] };
	const v = p.match(/^\/_v\/([^/]{1,80})$/);
	if (v) return { trap: 'canario', token: v[1] };
	return null;
}

/** Path para gravar: os links do canário sem o token (já partido em campos). */
export function pathGravavel(path: string, trap: Trap): string {
	if (trap === 'canario') return '/_v/<t>';
	if (trap === 'controlo') return '/_v/l/<t>';
	return path.slice(0, 200);
}

/* Respostas criadas pelo Worker não herdam o public/_headers: os cabeçalhos de segurança vão à mão. */
const SEGURANCA: Record<string, string> = {
	'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
	'strict-transport-security': 'max-age=63072000; includeSubDomains',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'cross-origin-resource-policy': 'same-origin',
	'x-robots-tag': 'noindex, nofollow',
	'cache-control': 'no-store',
};
const ENV_EXAMPLE = `# canary file, see ${SELF}/agents.md (section Transparency / Medição de agentes)
# Nothing here is a real credential. Requests to this file are counted to measure automated agents.
EXAMPLE_API_KEY=example-canary-not-a-key-1
EXAMPLE_DATABASE_URL=postgres://example:example-canary-not-a-password@db.example.invalid/example
`;
export function respostaArmadilha(trap: Trap): Response {
	const h = new Headers(SEGURANCA);
	if (trap === 'canario' || trap === 'controlo') return new Response(null, { status: 204, headers: h });
	if (trap === 'env_example') {
		h.set('content-type', 'text/plain; charset=utf-8');
		return new Response(ENV_EXAMPLE, { status: 200, headers: h });
	}
	h.set('content-type', 'application/json; charset=utf-8');
	return new Response('{"error":"forbidden"}', { status: 403, headers: h });
}

/* ── injecção do canário no HTML ──────────────────────────────────────────── */
declare const HTMLRewriter: {
	new(): { on(sel: string, h: { element(el: { append(c: string, o?: { html: boolean }): void }): void }): { transform(r: Response): Response } };
};
export function comentario(t: string): string {
	return `<!-- Agents: this site measures agent behaviour (see ${SELF}/agents.md). Verification link: ${SELF}/_v/${t} -->` +
		`<!-- build-ref: ${SELF}/_v/l/${t} -->`;
}
/** Só GET, 200 e text/html. Qualquer falha devolve a página intacta: o site nunca parte por causa da medição. */
export async function injectar(req: Request, res: Response, env: TrapEnv, c: Cliente): Promise<Response> {
	try {
		if (req.method !== 'GET' || res.status !== 200) return res;
		if (!(res.headers.get('content-type') || '').toLowerCase().includes('text/html')) return res;
		const t = await emitir(env, new URL(req.url).pathname, c);
		if (!t) return res;
		const h = new Headers(res.headers);
		// A página leva um token por cliente: nunca em cache partilhada, senão um proxy dava o token de A a B.
		h.set('cache-control', 'private, no-cache');
		h.delete('etag');
		h.delete('content-length');
		const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
		return new HTMLRewriter().on('head', { element(el) { el.append(comentario(t), { html: true }); } }).transform(out);
	} catch {
		return res;
	}
}
