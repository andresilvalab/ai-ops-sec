/* Scanner Agent-Ready: mede de fora as seis camadas de um site, como um agente as veria.
   Regras de conduta, escritas no próprio relatório:
   - identidade honesta (UA próprio); nunca se finge ser outro bot. O acesso de cada bot de IA
     lê-se do robots.txt, não se testa com o nome dele;
   - bloqueios de firewall (WAF) não são testados, porque isso exigiria fingir outro bot;
   - nunca se chamam tools de acção em sites de terceiros: só tools/list;
   - cada pedido tem timeout e tecto de bytes. */

const UA = 'AndreSilvaLab-AgentReadyScanner/1.0 (+https://andresilvalab.com/scanner/)';
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;

export const ANSWER_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Googlebot', 'Bingbot'];
export const TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'meta-externalagent', 'Bytespider'];

type T = { pt: string; en: string };
export interface Check { id: string; ok: boolean | null; label: T; detail?: string; rec?: T; }
export interface Layer { id: string; name: T; score: number; max: number; applicable: boolean; checks: Check[]; }
export interface ScanResult {
	host: string; url: string; scanned_at: string; score: number; layers: Layer[];
	facts: Record<string, unknown>; method: T;
}

export function normaliseTarget(input: string): URL | null {
	let s = (input || '').trim();
	if (!s || s.length > 300) return null;
	if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
	let u: URL;
	try { u = new URL(s); } catch { return null; }
	const h = u.hostname.toLowerCase();
	if (!['http:', 'https:'].includes(u.protocol)) return null;
	if (u.port && !['80', '443'].includes(u.port)) return null;
	if (u.username || u.password) return null;
	if (!h.includes('.') || h.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
	if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h)) return null;
	return new URL(`https://${h}/`);
}

interface Got { status: number; ct: string; text: string; ms: number; err?: string; }
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (u, i) => fetch(u, i);
async function get(url: string, init: RequestInit = {}): Promise<Got> {
	const t0 = Date.now();
	try {
		const r = await fetcher(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': UA, accept: '*/*', ...(init.headers || {}) } });
		const reader = r.body?.getReader();
		const chunks: Uint8Array[] = [];
		let n = 0;
		if (reader) {
			while (n < MAX_BYTES) {
				const { done, value } = await reader.read();
				if (done || !value) break;
				chunks.push(value); n += value.length;
			}
			try { await reader.cancel(); } catch { /* já fechado */ }
		}
		const buf = new Uint8Array(Math.min(n, MAX_BYTES));
		let o = 0;
		for (const c of chunks) { const take = Math.min(c.length, buf.length - o); buf.set(c.subarray(0, take), o); o += take; if (o >= buf.length) break; }
		return { status: r.status, ct: r.headers.get('content-type') || '', text: new TextDecoder().decode(buf), ms: Date.now() - t0 };
	} catch (e) {
		return { status: 0, ct: '', text: '', ms: Date.now() - t0, err: (e as Error).name || 'erro' };
	}
}

const looksHtml = (g: Got) => /text\/html/i.test(g.ct) || /^\s*<(!doctype|html)/i.test(g.text.slice(0, 300));
const isTextFile = (g: Got) => g.status === 200 && g.text.trim().length > 0 && !looksHtml(g);

/* ── robots.txt ─────────────────────────────────────────────────────── */
interface Group { agents: string[]; rules: { allow: boolean; path: string }[]; }
export function parseRobots(txt: string): Group[] {
	const groups: Group[] = [];
	let cur: Group | null = null;
	let lastWasAgent = false;
	for (const raw of txt.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, '').trim();
		const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
		if (!m) continue;
		const key = m[1].toLowerCase(); const val = m[2].trim();
		if (key === 'user-agent') {
			if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
			cur.agents.push(val.toLowerCase()); lastWasAgent = true;
		} else if ((key === 'allow' || key === 'disallow') && cur) {
			if (key === 'disallow' && val === '') { lastWasAgent = false; continue; }
			cur.rules.push({ allow: key === 'allow', path: val }); lastWasAgent = false;
		} else { lastWasAgent = false; }
	}
	return groups;
}
function ruleMatches(rule: string, path: string): number {
	const anchored = rule.endsWith('$');
	const body = anchored ? rule.slice(0, -1) : rule;
	const rx = new RegExp('^' + body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
	return rx.test(path) ? body.length : -1;
}
export function allowed(groups: Group[], ua: string, path = '/'): boolean {
	const token = ua.toLowerCase();
	let best: Group | null = null; let bestLen = -1;
	for (const g of groups) for (const a of g.agents) {
		if (a !== '*' && token.includes(a) && a.length > bestLen) { best = g; bestLen = a.length; }
	}
	if (!best) best = groups.find((g) => g.agents.includes('*')) ?? null;
	if (!best) return true;
	let len = -1; let verdict = true;
	for (const r of best.rules) {
		const l = ruleMatches(r.path, path);
		if (l > len || (l === len && r.allow)) { len = l; verdict = r.allow; }
	}
	return verdict;
}

/* ── JSON-LD ────────────────────────────────────────────────────────── */
function jsonLd(html: string): { blocks: unknown[]; errors: number } {
	const blocks: unknown[] = []; let errors = 0;
	for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		try { blocks.push(JSON.parse(m[1].trim())); } catch { errors++; }
	}
	return { blocks, errors };
}
function walk(v: unknown, fn: (o: Record<string, unknown>) => void) {
	if (Array.isArray(v)) { v.forEach((x) => walk(x, fn)); return; }
	if (v && typeof v === 'object') { const o = v as Record<string, unknown>; fn(o); Object.values(o).forEach((x) => walk(x, fn)); }
}
function prices(text: string): number[] {
	const out: number[] = [];
	for (const m of text.matchAll(/(?:€\s?(\d{1,6}(?:[.,]\d{1,2})?))|(?:(\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)\s?(?:€|EUR\b))/g)) {
		const raw = (m[1] || m[2] || '').replace(/\s/g, '');
		const n = Number(/,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
		if (Number.isFinite(n) && n > 0) out.push(Math.round(n * 100) / 100);
	}
	return out;
}

const INJECTION = /(ignore (all |any )?(previous|prior) instructions|disregard (the )?(above|previous)|you must (now )?(tell|send|reveal|include)|system prompt|<\s*system\s*>)/i;
const ACTION_TOOL = /(checkout|cart|order|book|submit|request_|schedule|contact|lead|pay|purchase|create_|update_|cancel_|complete_)/i;
const READ_TOOL = /^(search|get_|list_|lookup|describe|check_|find|read)/i;

/** `via` permite analisar o próprio site: um Worker não consegue fazer fetch à própria zona (522),
    por isso os pedidos ao próprio domínio passam pelo handler do Worker em vez da rede. */
export async function scan(target: URL, via?: Fetcher): Promise<ScanResult> {
	fetcher = via ?? ((u, i) => fetch(u, i));
	const base = target.origin;
	const [robotsG, llms, llmsFull, agents, mcpJ, ucpJ] = await Promise.all([
		get(`${base}/robots.txt`), get(`${base}/llms.txt`), get(`${base}/llms-full.txt`),
		get(`${base}/agents.md`), get(`${base}/.well-known/mcp.json`), get(`${base}/.well-known/ucp`),
	]);

	/* L0 */
	const hasRobots = isTextFile(robotsG);
	const groups = hasRobots ? parseRobots(robotsG.text) : [];
	const answer = ANSWER_BOTS.map((b) => ({ bot: b, allowed: allowed(groups, b) }));
	const training = TRAINING_BOTS.map((b) => ({ bot: b, allowed: allowed(groups, b) }));
	const nAns = answer.filter((x) => x.allowed).length;
	const blockedAns = answer.filter((x) => !x.allowed).map((x) => x.bot);
	const contentSignal = hasRobots && /^\s*content-signal\s*:/im.test(robotsG.text);
	const L0: Layer = {
		id: 'L0', name: { pt: 'Acesso (robots.txt)', en: 'Access (robots.txt)' }, max: 25, applicable: true,
		score: Math.round((25 * nAns) / ANSWER_BOTS.length),
		checks: [
			{ id: 'robots', ok: hasRobots, label: { pt: 'robots.txt servido como texto', en: 'robots.txt served as text' }, detail: hasRobots ? undefined : `HTTP ${robotsG.status}`,
				rec: hasRobots ? undefined : { pt: 'Publicar um robots.txt explícito: sem ele cada bot decide sozinho.', en: 'Publish an explicit robots.txt: without it each bot decides on its own.' } },
			{ id: 'answer-bots', ok: blockedAns.length === 0, label: { pt: `Bots de resposta permitidos: ${nAns} de ${ANSWER_BOTS.length}`, en: `Answer bots allowed: ${nAns} of ${ANSWER_BOTS.length}` },
				detail: blockedAns.length ? blockedAns.join(', ') : undefined,
				rec: blockedAns.length ? { pt: `Desbloquear ${blockedAns.join(', ')}: são estes que decidem se o site é citado. Bloquear treino não exige bloquear resposta.`, en: `Unblock ${blockedAns.join(', ')}: these decide whether the site gets cited. Refusing training does not require blocking answers.` } : undefined },
			{ id: 'content-signal', ok: contentSignal ? true : null, label: { pt: 'Content-Signal declarado (preferência, não obrigação)', en: 'Content-Signal declared (preference, not enforcement)' } },
		],
	};

	/* L1 */
	const hasLlms = isTextFile(llms); const hasFull = isTextFile(llmsFull); const hasAgents = isTextFile(agents);
	// Só nos ficheiros curtos de instruções: o llms-full.txt traz o texto dos artigos, e num site que escreve
	// sobre segurança os exemplos de injecção citados davam falso positivo.
	const injected = [llms, agents].filter((g) => isTextFile(g) && INJECTION.test(g.text)).length > 0;
	const L1: Layer = {
		id: 'L1', name: { pt: 'Contexto (llms.txt, agents.md)', en: 'Context (llms.txt, agents.md)' }, max: 10, applicable: true,
		score: (hasLlms ? 5 : 0) + (hasAgents ? 3 : 0) + (hasFull ? 2 : 0) - (injected ? 5 : 0),
		checks: [
			{ id: 'llms', ok: hasLlms, label: { pt: '/llms.txt', en: '/llms.txt' }, detail: hasLlms ? undefined : (looksHtml(llms) && llms.status === 200 ? 'devolve HTML (fallback de SPA)' : `HTTP ${llms.status}`),
				rec: hasLlms ? undefined : { pt: 'Publicar /llms.txt com quem são, o que oferecem e links para as páginas-chave. Custo baixo; nenhum motor confirma que o lê.', en: 'Publish /llms.txt with who you are, what you offer and links to key pages. Cheap; no engine confirms reading it.' } },
			{ id: 'agents', ok: hasAgents, label: { pt: '/agents.md', en: '/agents.md' }, detail: hasAgents ? undefined : `HTTP ${agents.status}` },
			{ id: 'llms-full', ok: hasFull, label: { pt: '/llms-full.txt', en: '/llms-full.txt' } },
			{ id: 'injection', ok: !injected, label: { pt: 'Sem instruções dirigidas a modelos nos ficheiros de contexto', en: 'No model-directed instructions in context files' },
				rec: injected ? { pt: 'Retirar frases imperativas dirigidas a modelos: os fornecedores tratam-nas como injecção.', en: 'Remove imperative model-directed sentences: vendors treat them as injection.' } : undefined },
		],
	};
	L1.score = Math.max(0, L1.score);

	/* L2 */
	const homeAllowed = allowed(groups, UA, '/');
	const home = homeAllowed ? await get(`${base}/`) : null;
	const ld = home && home.status === 200 ? jsonLd(home.text) : { blocks: [], errors: 0 };
	const types = new Set<string>(); const ldPrices: number[] = [];
	walk(ld.blocks, (o) => {
		const t = o['@type']; (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => types.add(String(x)));
		for (const k of ['price', 'lowPrice', 'highPrice']) { const v = Number(String(o[k] ?? '').replace(',', '.')); if (Number.isFinite(v) && v > 0) ldPrices.push(Math.round(v * 100) / 100); }
	});
	const ORG = ['Organization', 'WebSite', 'LocalBusiness', 'Store', 'Corporation', 'MedicalClinic', 'ProfessionalService'];
	const OFFER = ['Product', 'Offer', 'AggregateOffer', 'Service', 'FAQPage', 'Article', 'BlogPosting', 'SoftwareApplication', 'Course', 'Event', 'RealEstateListing', 'ProfilePage'];
	const hasOrg = [...types].some((t) => ORG.includes(t)); const hasOffer = [...types].some((t) => OFFER.includes(t));
	const llmsPrices = hasLlms ? prices(llms.text) : [];
	const divergence = llmsPrices.length > 0 && ldPrices.length > 0 && !llmsPrices.some((p) => ldPrices.includes(p));
	const L2: Layer = {
		id: 'L2', name: { pt: 'Facto (JSON-LD na página inicial)', en: 'Fact (JSON-LD on the home page)' }, max: 30, applicable: !!home,
		score: home ? (ld.blocks.length ? 10 : 0) + (hasOrg ? 5 : 0) + (hasOffer ? 10 : 0) + (home.status === 200 && ld.errors === 0 ? 5 : 0) : 0,
		checks: home ? [
			{ id: 'jsonld', ok: ld.blocks.length > 0, label: { pt: `Blocos JSON-LD: ${ld.blocks.length}${ld.errors ? ` (${ld.errors} inválidos)` : ''}`, en: `JSON-LD blocks: ${ld.blocks.length}${ld.errors ? ` (${ld.errors} invalid)` : ''}` },
				detail: [...types].slice(0, 12).join(', ') || undefined,
				rec: ld.blocks.length ? undefined : { pt: 'Acrescentar JSON-LD (Organization + o tipo da oferta: Product, Service, FAQPage). É o sinal estruturado que os motores de resposta extraem.', en: 'Add JSON-LD (Organization + the offer type: Product, Service, FAQPage). It is the structured signal answer engines extract.' } },
			{ id: 'entity', ok: hasOrg, label: { pt: 'Entidade declarada (Organization, WebSite, LocalBusiness)', en: 'Entity declared (Organization, WebSite, LocalBusiness)' } },
			{ id: 'offer', ok: hasOffer, label: { pt: 'Oferta ou conteúdo tipado (Product, Service, FAQPage, Article)', en: 'Typed offer or content (Product, Service, FAQPage, Article)' } },
			{ id: 'price-coherence', ok: divergence ? false : (llmsPrices.length && ldPrices.length ? true : null), label: { pt: 'Preços do llms.txt batem com o JSON-LD', en: 'llms.txt prices match JSON-LD' },
				detail: divergence ? `llms.txt ${llmsPrices.slice(0, 5).join(' / ')} · JSON-LD ${ldPrices.slice(0, 5).join(' / ')}` : undefined,
				rec: divergence ? { pt: 'Possível divergência de preço entre camadas (verificação simples, confirmar à mão). A divergência é pior do que a ausência.', en: 'Possible price mismatch across layers (simple check, confirm by hand). A mismatch is worse than absence.' } : undefined },
		] : [{ id: 'home-robots', ok: null, label: { pt: 'Página inicial não lida: o robots.txt não autoriza este scanner', en: 'Home page not read: robots.txt does not allow this scanner' } }],
	};

	/* L3 */
	let mcp: Record<string, any> | null = null; let ucp: Record<string, any> | null = null;
	if (mcpJ.status === 200 && !looksHtml(mcpJ)) { try { mcp = JSON.parse(mcpJ.text); } catch { /* inválido */ } }
	if (ucpJ.status === 200 && !looksHtml(ucpJ)) { try { const u = JSON.parse(ucpJ.text); if (u?.ucp) ucp = u; } catch { /* inválido */ } }
	const L3: Layer = {
		id: 'L3', name: { pt: 'Capacidade (manifesto)', en: 'Capability (manifest)' }, max: 10, applicable: true,
		score: (mcp ? 5 : 0) + (ucp ? 5 : 0),
		checks: [
			{ id: 'mcp-json', ok: !!mcp, label: { pt: '/.well-known/mcp.json', en: '/.well-known/mcp.json' } },
			{ id: 'ucp', ok: !!ucp, label: { pt: `/.well-known/ucp${ucp?.ucp?.version ? ` (versão ${ucp.ucp.version})` : ''}`, en: `/.well-known/ucp${ucp?.ucp?.version ? ` (version ${ucp.ucp.version})` : ''}` },
				rec: !mcp && !ucp ? { pt: 'Publicar um manifesto: UCP em e-commerce (há consumidores vivos), mcp.json nos outros sectores.', en: 'Publish a manifest: UCP for e-commerce (live consumers exist), mcp.json elsewhere.' } : undefined },
		],
	};

	/* L4 */
	const endpoints: string[] = [];
	if (typeof mcp?.endpoint === 'string') endpoints.push(mcp.endpoint);
	for (const svc of Object.values((ucp?.ucp?.services ?? {}) as Record<string, any[]>)) for (const s of svc || []) if (s?.transport === 'mcp' && typeof s.endpoint === 'string') endpoints.push(s.endpoint);
	let toolNames: string[] = []; let l4 = 0; let l4detail = '';
	const ep = endpoints.map((e) => normaliseTarget(e) ? e : null).find(Boolean) || null;
	if (ep) {
		const r = await get(ep, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
		let j: any = null; try { j = JSON.parse(r.text); } catch { /* não é JSON */ }
		if (Array.isArray(j?.result?.tools)) { toolNames = j.result.tools.map((t: any) => String(t.name)); l4 = toolNames.length ? 15 : 8; l4detail = toolNames.slice(0, 15).join(', '); }
		else if (j?.error) { l4 = 10; l4detail = `JSON-RPC ${j.error.code}: ${String(j.error.message).slice(0, 80)}`; }
		else { l4 = 3; l4detail = `HTTP ${r.status}${r.err ? ` ${r.err}` : ''}`; }
	}
	const L4: Layer = {
		id: 'L4', name: { pt: 'Operação (servidor MCP)', en: 'Operation (MCP server)' }, max: 15, applicable: true, score: l4,
		checks: [{ id: 'tools-list', ok: ep ? l4 >= 10 : false, label: { pt: ep ? 'tools/list responde' : 'Sem endpoint MCP declarado', en: ep ? 'tools/list answers' : 'No MCP endpoint declared' }, detail: l4detail || undefined,
			rec: ep ? undefined : { pt: 'Um servidor MCP com tools de leitura serve o chatbot do próprio site e os agentes externos.', en: 'An MCP server with read tools serves the site\'s own chatbot and external agents.' } }],
	};

	/* L5 */
	const actions = toolNames.filter((n) => ACTION_TOOL.test(n) && !READ_TOOL.test(n));
	const declared = (Array.isArray(mcp?.tools) && mcp.tools.some((t: any) => t?.requires_human_approval === true)) || !!(ucp?.ucp?.payment_handlers && Object.keys(ucp.ucp.payment_handlers).length);
	const L5: Layer = {
		id: 'L5', name: { pt: 'Acção com consentimento', en: 'Action with consent' }, max: 10, applicable: actions.length > 0 || declared,
		score: declared ? 10 : 0,
		checks: actions.length || declared ? [
			{ id: 'approval', ok: declared, label: { pt: 'Aprovação humana declarada (manifesto ou payment handlers)', en: 'Human approval declared (manifest or payment handlers)' }, detail: actions.join(', ') || undefined,
				rec: declared ? undefined : { pt: 'Há tools de acção sem aprovação humana declarada: exigir consentimento explícito e dry_run por defeito.', en: 'There are action tools with no declared human approval: require explicit consent and dry_run by default.' } },
			{ id: 'not-tested', ok: null, label: { pt: 'Declarado, não testado: o scanner nunca chama tools de acção em sites de terceiros', en: 'Declared, not tested: the scanner never calls action tools on third-party sites' } },
		] : [],
	};

	const layers = [L0, L1, L2, L3, L4, L5];
	const app = layers.filter((l) => l.applicable);
	const score = Math.round((100 * app.reduce((a, l) => a + l.score, 0)) / Math.max(1, app.reduce((a, l) => a + l.max, 0)));
	return {
		host: target.hostname, url: base, scanned_at: new Date().toISOString(), score, layers,
		facts: { answer, training, content_signal: contentSignal, jsonld_types: [...types], mcp_endpoint: ep, tools: toolNames, ucp_version: ucp?.ucp?.version ?? null },
		method: {
			pt: 'Identidade própria, sem fingir outros bots: o acesso de cada bot lê-se do robots.txt. Bloqueios de firewall não são testados. Nunca se chamam tools de acção. Verificação de preços é simples e só assinala.',
			en: 'Own identity, never impersonating other bots: each bot\'s access is read from robots.txt. Firewall blocks are not tested. Action tools are never called. The price check is simple and only flags.',
		},
	};
}
