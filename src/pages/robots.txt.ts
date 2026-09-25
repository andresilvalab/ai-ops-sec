import type { APIContext } from 'astro';
export function GET({ site }: APIContext) {
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	// Bots de PESQUISA de IA (citam a fonte) ficam explicitamente permitidos: é a única via com
	// evidência para aparecer em respostas geradas. Bots de TREINO (GPTBot, ClaudeBot, CCBot,
	// Google-Extended) seguem a regra geral; decidir à parte e por escrito se um dia se bloquear.
	const search = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Applebot'];
	// Fetchers accionados por uma pergunta de um utilizador (etapa 3): também permitidos.
	const userFetch = ['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'Google-Agent', 'meta-externalfetcher'];
	// Treino: permitido por decisão explícita (25-Set-2026); reversível aqui, uma linha por bot.
	const training = ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended'];
	const body = [
		'# André Silva Lab. Agentes: /agents.md · manifesto MCP: /.well-known/mcp.json · contexto: /llms.txt',
		...search.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
		...userFetch.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
		...training.flatMap((ua) => [`User-agent: ${ua}`, 'Allow: /', '']),
		'User-agent: *',
		'Allow: /',
		`Disallow: ${base}/search/`,
		`Disallow: ${base}/en/search/`,
		'',
		'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
		`Sitemap: ${new URL(`${base}/sitemap-index.xml`, site)}`,
		'',
	].join('\n');
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
