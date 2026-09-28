// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `site` e `base` vêm do ambiente. Produção: https://andresilvalab.com na raiz (Cloudflare Workers).
const SITE = process.env.SITE_URL ?? 'https://andresilvalab.com';
const BASE = process.env.BASE_PATH ?? '/';

/* lastmod por artigo, lido do frontmatter (updatedDate, senão pubDate). Sem isto o sitemap não tinha
   datas e os crawlers não tinham como priorizar o que mudou. Só artigos publicados. */
function postDates() {
	const out = new Map();
	for (const lang of ['pt', 'en']) {
		const dir = join('src/content/posts', lang);
		for (const f of readdirSync(dir)) {
			if (f.startsWith('_') || !/\.(md|mdx)$/.test(f)) continue;
			const fm = readFileSync(join(dir, f), 'utf8').split(/^---\s*$/m)[1] ?? '';
			const get = (k) => fm.match(new RegExp(`^${k}:\\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})`, 'm'))?.[1];
			const status = fm.match(/^status:\s*["']?(\w+)/m)?.[1] ?? 'draft';
			const date = get('updatedDate') ?? get('pubDate');
			if (status !== 'published' || !date) continue;
			const slug = f.replace(/\.(md|mdx)$/, '');
			out.set(`${SITE}${BASE === '/' ? '' : BASE}${lang === 'en' ? '/en' : ''}/blog/${slug}/`, new Date(date));
		}
	}
	return out;
}
const POST_DATES = postDates();

export default defineConfig({
	site: SITE,
	base: BASE,
	trailingSlash: 'always',
	i18n: {
		defaultLocale: 'pt',
		locales: ['pt', 'en'],
		routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false },
	},
	integrations: [
		mdx(),
		sitemap({
			i18n: { defaultLocale: 'pt', locales: { pt: 'pt-PT', en: 'en' } },
			// tags e pesquisa são navegação, não conteúdo: fora do sitemap (28-Set-2026, 128 das 178 entradas eram tags)
			filter: (page) => !page.includes('/og/') && !/\/tags\//.test(page) && !/\/search\//.test(page),
			serialize: (item) => {
				const d = POST_DATES.get(item.url);
				return d ? { ...item, lastmod: d } : item;
			},
		}),
	],
	markdown: {
		shikiConfig: {
			themes: { light: 'vitesse-light', dark: 'vitesse-black' },
			defaultColor: false,
			wrap: false,
		},
	},
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Geist',
			cssVariable: '--font-sans',
			fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
			options: {
				variants: [{ src: ['./src/assets/fonts/geist-latin-wght-normal.woff2'], weight: '100 900', style: 'normal', display: 'swap' }],
			},
		},
		{
			provider: fontProviders.local(),
			name: 'Geist Mono',
			cssVariable: '--font-mono',
			fallbacks: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
			options: {
				variants: [{ src: ['./src/assets/fonts/geist-mono-latin-wght-normal.woff2'], weight: '100 900', style: 'normal', display: 'swap' }],
			},
		},
	],
});
