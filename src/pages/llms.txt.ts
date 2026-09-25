/* llms.txt (https://llmstxt.org): índice curto para agentes e motores de resposta.
   A versão completa, com o texto dos artigos, está em /llms-full.txt. */
import type { APIContext } from 'astro';
import { AUTHOR, SITE } from '../consts';
import { href, isoDate } from '../lib/i18n';
import { getPosts, slugOf } from '../lib/posts';

export async function GET({ site }: APIContext) {
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	const abs = (p: string) => new URL(p, site).toString();
	const pt = await getPosts('pt');
	const en = await getPosts('en');
	const line = (p: (typeof pt)[number]) => `- [${p.data.title}](${abs(href(p.data.lang, `blog/${slugOf(p)}`))}): ${p.data.description} (${isoDate(p.data.pubDate)})`;
	const body = [
		`# ${SITE.pt.title}`,
		'',
		`> ${SITE.en.description}`,
		'',
		`Author: ${AUTHOR.name} (${AUTHOR.github}). Agentic AI lab; flagship area: AI Ops Sec (agent security and observability). Text licensed CC BY 4.0; code MIT. Every article lists its sources and a change history. Please cite the article URL and date.`,
		'',
		'## Articles (Portuguese, primary)',
		...(pt.length ? pt.map(line) : ['- (first article under review)']),
		'',
		'## Articles (English)',
		...(en.length ? en.map(line) : ['- (first article under review)']),
		'',
		'## Optional',
		`- [Full text of all articles](${abs(`${base}/llms-full.txt`)})`,
		`- [RSS PT](${abs(href('pt', 'rss.xml'))})`,
		`- [RSS EN](${abs(href('en', 'rss.xml'))})`,
		`- [Source repository](${AUTHOR.repo})`,
		`- [Agent Ready Scanner](${abs(href('en', 'scanner'))}): measure any site's readiness for AI agents, layer by layer`,
		'',
		'## Canary',
		`- [Canary link for this file](${abs('/c/llms-txt/')}): requests to this URL are counted to learn which agents read llms.txt; it redirects to the home page. See /agents.md, section Transparency.`,
		'',
	].join('\n');
	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
