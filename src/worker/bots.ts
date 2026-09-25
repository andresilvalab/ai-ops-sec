/* Classificação de bots de IA por User-Agent, com a etapa do Agent-Ready Stack a que pertencem.
   1 = crawl de índice (decide se somos citados) · 2 = crawl de treino · 3 = fetch accionado por uma
   pergunta de utilizador · 4 = clique humano numa citação (referer/UTM de um assistente).
   Fontes: docs oficiais de cada fornecedor (OpenAI bots, Anthropic crawlers, Perplexity bots, Google
   common crawlers e user-triggered fetchers, Bing, Meta web crawlers, Apple). */

export type Etapa = '1' | '2' | '3';
export interface BotMatch { bot: string; operador: string; etapa: Etapa; }

const BOTS: [RegExp, string, string, Etapa][] = [
	// índice / resposta
	[/OAI-SearchBot/i, 'OAI-SearchBot', 'openai', '1'],
	[/Claude-SearchBot/i, 'Claude-SearchBot', 'anthropic', '1'],
	[/PerplexityBot/i, 'PerplexityBot', 'perplexity', '1'],
	[/Googlebot/i, 'Googlebot', 'google', '1'],
	[/bingbot/i, 'bingbot', 'microsoft', '1'],
	[/Applebot-Extended/i, 'Applebot-Extended', 'apple', '2'],
	[/Applebot/i, 'Applebot', 'apple', '1'],
	[/DuckDuckBot|DuckAssistBot/i, 'DuckDuckBot', 'duckduckgo', '1'],
	[/meta-webindexer/i, 'meta-webindexer', 'meta', '1'],
	// fetch por pergunta de utilizador
	[/ChatGPT-User/i, 'ChatGPT-User', 'openai', '3'],
	[/Claude-User/i, 'Claude-User', 'anthropic', '3'],
	[/Perplexity-User/i, 'Perplexity-User', 'perplexity', '3'],
	[/Google-Agent|Google-GeminiNotebook|Google-NotebookLM/i, 'Google-Agent', 'google', '3'],
	[/meta-externalfetcher/i, 'meta-externalfetcher', 'meta', '3'],
	[/MistralAI-User/i, 'MistralAI-User', 'mistral', '3'],
	// treino
	[/GPTBot/i, 'GPTBot', 'openai', '2'],
	[/ClaudeBot|anthropic-ai/i, 'ClaudeBot', 'anthropic', '2'],
	[/CCBot/i, 'CCBot', 'commoncrawl', '2'],
	[/Google-Extended|Google-CloudVertexBot/i, 'Google-Extended', 'google', '2'],
	[/meta-externalagent|FacebookBot/i, 'meta-externalagent', 'meta', '2'],
	[/Bytespider/i, 'Bytespider', 'bytedance', '2'],
	[/Amazonbot/i, 'Amazonbot', 'amazon', '2'],
	[/cohere-ai|cohere-training-data-crawler/i, 'cohere', 'cohere', '2'],
	[/AI2Bot|Ai2Bot-Dolma/i, 'AI2Bot', 'ai2', '2'],
	[/Diffbot/i, 'Diffbot', 'diffbot', '2'],
	[/PanguBot|PetalBot/i, 'PetalBot', 'huawei', '2'],
	[/DeepSeekBot/i, 'DeepSeekBot', 'deepseek', '2'],
	[/YouBot/i, 'YouBot', 'you', '1'],
	[/omgili|omgilibot/i, 'omgili', 'webz', '2'],
];

/** Devolve o bot de IA, ou null para humanos e bots que não interessam (monitorização, uptime...). */
export function classify(ua: string, headers: Headers): BotMatch | null {
	for (const [rx, bot, operador, etapa] of BOTS) if (rx.test(ua)) return { bot, operador, etapa };
	// Agente do ChatGPT em browser: UA de Chrome normal, identidade só na assinatura (Web Bot Auth).
	const sig = headers.get('signature-agent');
	if (sig) {
		if (/chatgpt\.com|openai\.com/i.test(sig)) return { bot: 'ChatGPT agent (signed)', operador: 'openai', etapa: '3' };
		return { bot: `signed agent ${sig.replace(/"/g, '').slice(0, 60)}`, operador: 'signed', etapa: '3' };
	}
	return null;
}

const REFERRERS: [RegExp, string, string][] = [
	[/(^|\.)chatgpt\.com$/i, 'chatgpt.com', 'openai'],
	[/(^|\.)openai\.com$/i, 'openai.com', 'openai'],
	[/(^|\.)claude\.ai$/i, 'claude.ai', 'anthropic'],
	[/(^|\.)perplexity\.ai$/i, 'perplexity.ai', 'perplexity'],
	[/(^|\.)copilot\.microsoft\.com$/i, 'copilot.microsoft.com', 'microsoft'],
	[/(^|\.)gemini\.google\.com$/i, 'gemini.google.com', 'google'],
	[/(^|\.)meta\.ai$/i, 'meta.ai', 'meta'],
	[/(^|\.)you\.com$/i, 'you.com', 'you'],
	[/(^|\.)mistral\.ai$/i, 'mistral.ai', 'mistral'],
	[/(^|\.)duckduckgo\.com$/i, 'duckduckgo.com', 'duckduckgo'],
];

/** Etapa 4: clique humano vindo de um assistente. Fonte pelo referer ou pelo utm_source. */
export function isAiReferral(referer: string | null, url: URL): { fonte: string; operador: string } | null {
	const utm = url.searchParams.get('utm_source');
	if (utm && /chatgpt|openai/i.test(utm)) return { fonte: `utm:${utm}`, operador: 'openai' };
	if (utm && /perplexity/i.test(utm)) return { fonte: `utm:${utm}`, operador: 'perplexity' };
	if (!referer) return null;
	let host = '';
	try { host = new URL(referer).hostname; } catch { return null; }
	for (const [rx, fonte, operador] of REFERRERS) if (rx.test(host)) return { fonte, operador };
	return null;
}
