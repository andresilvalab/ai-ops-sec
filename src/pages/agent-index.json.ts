/* Índice para o servidor MCP (/mcp): tudo o que as tools de leitura devolvem vem daqui, gerado no
   build a partir do mesmo conteúdo que já sai em /llms-full.txt. Só artigos publicados. */
import type { APIContext } from 'astro';
import { AUTHOR, SITE } from '../consts';
import { AREAS } from '../lib/areas';
import { href, isoDate } from '../lib/i18n';
import { getPosts, slugOf } from '../lib/posts';

const MAX_TEXT = 40_000;

/** Texto legível a partir do MDX: sem import/export, sem componentes JSX, sem blocos de nota privada. */
function plain(body: string | undefined): string {
	if (!body) return '';
	return body
		.replace(/^(import|export)\s.*$/gm, '')
		.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
		.replace(/<[A-Z][A-Za-z]*[^>]*\/>/g, '')
		.replace(/<\/?[A-Z][A-Za-z]*[^>]*>/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
		.slice(0, MAX_TEXT);
}

export async function GET({ site }: APIContext) {
	const posts = await getPosts();
	const url = site!.toString().replace(/\/$/, '');
	const index = {
		generated: new Date().toISOString(),
		site: {
			url,
			title: { pt: SITE.pt.title, en: SITE.en.title },
			tagline: { pt: SITE.pt.tagline, en: SITE.en.tagline },
			description: { pt: SITE.pt.description, en: SITE.en.description },
			author: { name: AUTHOR.name, github: AUTHOR.github, linkedin: AUTHOR.linkedin, company: AUTHOR.company },
		},
		areas: AREAS.map((a) => ({ key: a.key, name: a.name, short: a.short, description: a.description, topics: a.topics })),
		articles: posts.map((p) => ({
			slug: slugOf(p),
			lang: p.data.lang,
			title: p.data.title,
			description: p.data.description,
			url: new URL(href(p.data.lang, `blog/${slugOf(p)}`), site).toString(),
			area: p.data.area,
			tags: p.data.tags,
			pubDate: isoDate(p.data.pubDate),
			updatedDate: p.data.updatedDate ? isoDate(p.data.updatedDate) : null,
			translationKey: p.data.translationKey ?? null,
			sources: p.data.sources.map((s) => ({ title: s.title, url: s.url })),
			text: plain(p.body),
		})),
	};
	return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}
