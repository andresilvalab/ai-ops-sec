import type { APIContext } from 'astro';
import { AUTHOR, SITE } from '../consts';
import { href, isoDate } from '../lib/i18n';
import { getPosts, slugOf } from '../lib/posts';

export async function GET({ site }: APIContext) {
	const posts = await getPosts();
	const parts = [`# ${SITE.pt.title}: full text`, '', `Author: ${AUTHOR.name}. License: CC BY 4.0 (text). Cite by URL and date.`, ''];
	for (const p of posts) {
		const url = new URL(href(p.data.lang, `blog/${slugOf(p)}`), site).toString();
		parts.push('---', '', `# ${p.data.title}`, '', `URL: ${url}`, `Language: ${p.data.lang}`, `Published: ${isoDate(p.data.pubDate)}${p.data.updatedDate ? ` · Updated: ${isoDate(p.data.updatedDate)}` : ''}`, `Tags: ${p.data.tags.join(', ')}`, '', p.data.description, '', p.body ?? '', '');
		if (p.data.sources.length) parts.push('Sources:', ...p.data.sources.map((s) => `- ${s.title}: ${s.url}`), '');
	}
	if (posts.length === 0) parts.push('(first article under review)');
	parts.push('---', '', `Canary link for this file: ${new URL('/c/llms-full/', site)} (requests to it are counted to learn which agents read llms-full.txt; it redirects to the home page).`, '');
	return new Response(parts.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
