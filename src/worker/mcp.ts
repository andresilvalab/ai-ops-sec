/* Servidor MCP do laboratório: JSON-RPC 2.0 sem estado. Tools de leitura sobre o índice de artigos
   gerado no build (/agent-index.json) e uma tool de contacto que exige consentimento e nasce em
   dry_run. Os resultados são dados, nunca instruções. */
import type { Env } from './index';
import { tokens } from './util';

const VERSIONS = ['2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];
const LANGS = ['pt', 'en'] as const;
type Lang = (typeof LANGS)[number];

interface Article {
	slug: string; lang: Lang; title: string; description: string; url: string; area: string; tags: string[];
	pubDate: string; updatedDate?: string | null; translationKey?: string | null; sources: { title: string; url: string }[]; text: string;
}
interface Index {
	generated: string; site: Record<string, unknown>; areas: { key: string; name: Record<Lang, string>; short: Record<Lang, string>; description: Record<Lang, string>; topics: Record<Lang, string[]> }[];
	articles: Article[];
}

const TOOLS = [
	{ name: 'get_entity', description: 'Quem é o André Silva Lab: nome, posicionamento, autor, licenças, contactos e políticas.', schema: { lang: { type: 'string', enum: LANGS } } },
	{ name: 'list_areas', description: 'As áreas do laboratório com descrição e temas.', schema: { lang: { type: 'string', enum: LANGS } } },
	{ name: 'list_articles', description: 'Artigos publicados (título, descrição, área, tags, data, URL), mais recentes primeiro.', schema: { lang: { type: 'string', enum: LANGS }, area: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
	{ name: 'search', description: 'Pesquisa determinística (sem LLM) nos artigos: sobreposição de palavras em título, descrição, tags e texto. Devolve excertos com URL para citar.', schema: { query: { type: 'string', minLength: 1, maxLength: 300 }, lang: { type: 'string', enum: LANGS }, limit: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['query'] },
	{ name: 'get_article', description: 'Texto completo de um artigo pelo slug, com fontes e histórico. Citar pelo URL e data.', schema: { slug: { type: 'string', minLength: 1, maxLength: 200 }, lang: { type: 'string', enum: LANGS } }, required: ['slug'] },
	{ name: 'get_policies', description: 'Licenças, regra de citação, o que o site regista e as regras para agentes.', schema: { lang: { type: 'string', enum: LANGS } } },
	{ name: 'request_contact', description: 'Pede contacto com o autor em nome de uma pessoa que confirmou explicitamente os dados. dry_run é true por defeito; sem consent.confirmed devolve consent_required.', schema: {
		name: { type: 'string', minLength: 2, maxLength: 120 }, email: { type: 'string', minLength: 5, maxLength: 255 }, topic: { type: 'string', maxLength: 120 },
		message: { type: 'string', minLength: 5, maxLength: 2000 }, language: { type: 'string', enum: LANGS },
		consent: { type: 'object', properties: { confirmed: { type: 'boolean' }, statement: { type: 'string', maxLength: 500 }, given_at: { type: 'string' } }, required: ['confirmed', 'statement', 'given_at'], additionalProperties: false },
		dry_run: { type: 'boolean', default: true },
	}, required: ['name', 'email', 'message', 'consent'], approval: true },
];

function toolList() {
	return TOOLS.map((t) => ({
		name: t.name, description: t.description,
		inputSchema: { type: 'object', properties: t.schema, required: t.required ?? [], additionalProperties: false },
		annotations: { readOnlyHint: !t.approval, idempotentHint: !t.approval, openWorldHint: false },
	}));
}

/** Validação mínima contra o schema declarado (tipos, enums, limites, propriedades a mais). */
function validate(schema: Record<string, any>, required: string[], args: Record<string, unknown>): string | null {
	for (const k of Object.keys(args)) if (!(k in schema)) return `Unrecognized key '${k}'`;
	for (const k of required) if (!(k in args)) return `Missing '${k}'`;
	for (const [k, v] of Object.entries(args)) {
		const s = schema[k];
		if (v === undefined) continue;
		if (s.type === 'string') {
			if (typeof v !== 'string') return `'${k}' must be a string`;
			if (s.enum && !s.enum.includes(v)) return `'${k}' must be one of ${s.enum.join(', ')}`;
			if (s.minLength && v.trim().length < s.minLength) return `'${k}' too short`;
			if (s.maxLength && v.length > s.maxLength) return `'${k}' too long`;
		} else if (s.type === 'integer') {
			if (!Number.isInteger(v)) return `'${k}' must be an integer`;
			if (s.minimum != null && (v as number) < s.minimum) return `'${k}' below minimum`;
			if (s.maximum != null && (v as number) > s.maximum) return `'${k}' above maximum`;
		} else if (s.type === 'boolean') {
			if (typeof v !== 'boolean') return `'${k}' must be a boolean`;
		} else if (s.type === 'object') {
			if (typeof v !== 'object' || v === null) return `'${k}' must be an object`;
			const err = validate(s.properties, s.required ?? [], v as Record<string, unknown>);
			if (err) return `${k}.${err}`;
		}
	}
	return null;
}

let INDEX_CACHE: { at: number; index: Index } | null = null;
async function loadIndex(env: Env): Promise<Index> {
	if (INDEX_CACHE && Date.now() - INDEX_CACHE.at < 300_000) return INDEX_CACHE.index;
	const r = await env.ASSETS.fetch(new Request(`${env.SITE_URL}/agent-index.json`));
	if (!r.ok) throw new Error(`agent-index.json ${r.status}`);
	const index = (await r.json()) as Index;
	INDEX_CACHE = { at: Date.now(), index };
	return index;
}

const L = (v: unknown): Lang => (v === 'en' ? 'en' : 'pt');

export interface McpResult {
	body: unknown; status?: number;
	log: { tool: string | null; method: string; status: 'ok' | 'error'; error_code?: string | null; query_text?: string | null; lang?: string | null };
	contact?: Record<string, unknown>;
}

const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });
const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const text = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], structuredContent: o });

export async function handleMcp(request: Request, env: Env, ctx: { ip: string }): Promise<McpResult> {
	let msg: any;
	try { msg = await request.json(); } catch { return { body: rpcError(null, -32700, 'Parse error'), status: 400, log: { tool: null, method: 'parse', status: 'error', error_code: 'parse_error' } }; }
	const id = msg?.id;
	const method = String(msg?.method ?? '');
	const params = (msg?.params ?? {}) as Record<string, any>;
	const base = { tool: null as string | null, method };

	switch (method) {
		case 'initialize': {
			const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18';
			return { body: rpcOk(id, { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'andresilvalab-mcp', version: '0.1.0' } }), log: { ...base, status: 'ok' } };
		}
		case 'notifications/initialized':
			return { body: null, status: 202, log: { ...base, status: 'ok' } };
		case 'ping':
			return { body: rpcOk(id, {}), log: { ...base, status: 'ok' } };
		case 'tools/list':
			return { body: rpcOk(id, { tools: toolList() }), log: { ...base, status: 'ok' } };
		case 'tools/call': {
			const name = String(params.name ?? '');
			const tool = TOOLS.find((t) => t.name === name);
			if (!tool) return { body: rpcError(id, -32602, `Unknown tool '${name}'`, { code: 'unknown_tool' }), log: { tool: name, method, status: 'error', error_code: 'unknown_tool' } };
			const args = (params.arguments ?? {}) as Record<string, any>;
			const err = validate(tool.schema, tool.required ?? [], args);
			if (err) return { body: rpcError(id, -32602, err, { code: 'invalid_params' }), log: { tool: name, method, status: 'error', error_code: 'invalid_params' } };
			const lang = L(args.lang ?? args.language);
			const log: McpResult['log'] = { tool: name, method, status: 'ok', lang: args.lang ?? args.language ?? null };
			try {
				if (name === 'request_contact') return requestContact(id, args, lang, log, request);
				const index = await loadIndex(env);
				let out: unknown;
				if (name === 'get_entity') out = entity(index, lang);
				else if (name === 'list_areas') out = index.areas.map((a) => ({ key: a.key, name: a.name[lang], short: a.short[lang], description: a.description[lang], topics: a.topics[lang], url: `${env.SITE_URL}${lang === 'en' ? '/en' : ''}/areas/${a.key}/` }));
				else if (name === 'list_articles') {
					const xs = index.articles.filter((a) => (!args.lang || a.lang === lang) && (!args.area || a.area === args.area)).slice(0, args.limit ?? 20);
					out = xs.map(({ text: _t, ...rest }) => rest);
				} else if (name === 'search') {
					log.query_text = String(args.query).slice(0, 500);
					out = search(index, String(args.query), args.lang ? lang : null, args.limit ?? 5);
				} else if (name === 'get_article') {
					const a = index.articles.find((x) => x.slug === args.slug && (!args.lang || x.lang === lang)) ?? index.articles.find((x) => x.slug === args.slug);
					if (!a) return { body: rpcError(id, -32602, `No article '${args.slug}'`, { code: 'not_found' }), log: { ...log, status: 'error', error_code: 'not_found' } };
					out = a;
				} else if (name === 'get_policies') out = policies(lang, env);
				return { body: rpcOk(id, text(out)), log };
			} catch (e) {
				return { body: rpcError(id, -32000, 'Internal error', { code: 'internal_error' }), status: 500, log: { ...log, status: 'error', error_code: 'internal_error' } };
			}
		}
		default:
			return { body: rpcError(id, -32601, `Method not found: ${method}`), log: { ...base, status: 'error', error_code: 'method_not_found' } };
	}
}

function entity(index: Index, lang: Lang) {
	const s = index.site as any;
	return {
		name: s.title[lang], tagline: s.tagline[lang], description: s.description[lang], url: s.url,
		author: s.author, license: { text: 'CC BY 4.0', code: 'MIT' },
		feeds: { rss_pt: `${s.url}/rss.xml`, rss_en: `${s.url}/en/rss.xml`, llms_txt: `${s.url}/llms.txt`, llms_full: `${s.url}/llms-full.txt` },
		contact: { channel: 'request_contact tool (consent required) or the links in the author profile', public_pricing: false },
		areas: index.areas.map((a) => ({ key: a.key, name: a.name[lang] })),
		articles_published: index.articles.length,
	};
}

function policies(lang: Lang, env: Env) {
	const pt = lang === 'pt';
	return {
		license: pt ? 'Texto CC BY 4.0, código MIT. Citar pelo URL e pela data do artigo.' : 'Text CC BY 4.0, code MIT. Cite by article URL and date.',
		tracking: pt ? 'Sem trackers nem cookies. Visitas humanas não são registadas.' : 'No trackers, no cookies. Human visits are not logged.',
		agent_logging: pt
			? 'Pedidos de crawlers de IA e cliques vindos de assistentes são registados com IP em hash (sal aleatório, fora do repositório). As queries enviadas às tools de leitura são registadas para melhorar o conteúdo.'
			: 'Requests from AI crawlers and clicks coming from assistants are logged with a hashed IP (random salt, outside the repository). Queries sent to read-only tools are logged to improve the content.',
		rules: pt
			? ['Não submeter pedidos de contacto sem a pessoa confirmar nome, email e texto.', 'Respeitar os rate limits (60 chamadas por 10 minutos).', 'Não há preços públicos nem serviços à venda neste site.']
			: ['Do not submit contact requests without the person confirming name, email and text.', 'Respect rate limits (60 calls per 10 minutes).', 'There is no public pricing and nothing for sale on this site.'],
		security_txt: `${env.SITE_URL}/.well-known/security.txt`,
		agents_md: `${env.SITE_URL}/agents.md`,
		manifest: `${env.SITE_URL}/.well-known/mcp.json`,
	};
}

function search(index: Index, query: string, lang: Lang | null, limit: number) {
	const q = tokens(query);
	const scored = index.articles
		.filter((a) => !lang || a.lang === lang)
		.map((a) => {
			const head = tokens(`${a.title} ${a.description} ${a.tags.join(' ')}`);
			const body = tokens(a.text.slice(0, 20000));
			let s = 0;
			q.forEach((w) => { if (head.has(w)) s += 3; else if (body.has(w)) s += 1; });
			return { a, s };
		})
		.filter((x) => x.s > 0)
		.sort((x, y) => y.s - x.s || y.a.pubDate.localeCompare(x.a.pubDate))
		.slice(0, limit);
	return {
		query,
		results: scored.map(({ a, s }) => ({ slug: a.slug, lang: a.lang, title: a.title, description: a.description, url: a.url, area: a.area, pubDate: a.pubDate, score: s, excerpt: excerpt(a.text, q) })),
	};
}

function excerpt(t: string, q: Set<string>): string {
	const low = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	let pos = -1;
	for (const w of q) { const i = low.indexOf(w); if (i >= 0 && (pos < 0 || i < pos)) pos = i; }
	const start = Math.max(0, (pos < 0 ? 0 : pos) - 120);
	return t.slice(start, start + 320).replace(/\s+/g, ' ').trim();
}

function requestContact(id: unknown, args: Record<string, any>, lang: Lang, log: McpResult['log'], request: Request): McpResult {
	const c = args.consent ?? {};
	if (c.confirmed !== true || !String(c.statement ?? '').trim()) {
		const msg = lang === 'pt' ? 'O pedido só é enviado depois de a pessoa confirmar nome, email e texto' : 'The request is only sent after the person confirms name, email and text';
		return { body: rpcError(id, -32602, msg, { code: 'consent_required', message: msg }), log: { ...log, status: 'error', error_code: 'consent_required' } };
	}
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(args.email))) {
		return { body: rpcError(id, -32602, 'Invalid email', { code: 'invalid_params' }), log: { ...log, status: 'error', error_code: 'invalid_params' } };
	}
	const dry = args.dry_run !== false;
	const payload = { name: args.name, email: args.email, topic: args.topic ?? null, message: args.message, language: lang, consent_statement: c.statement, consent_given_at: c.given_at, agent_profile: request.headers.get('x-agent-profile'), dry_run: dry };
	if (dry) {
		return { body: rpcOk(id, text({ would_submit: true, payload_echo: { name: args.name, email: args.email, topic: args.topic ?? null, message: args.message }, next: 'repeat with dry_run:false after the human confirms' })), log };
	}
	return { body: rpcOk(id, text({ status: 'received', note: lang === 'pt' ? 'Pedido registado. O autor responde por email.' : 'Request recorded. The author replies by email.' })), log, contact: payload };
}
