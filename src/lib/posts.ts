import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from '../consts';

export type Post = CollectionEntry<'posts'>;

/** id "pt/lethal-trifecta" => slug "lethal-trifecta". */
export function slugOf(post: Post): string {
	return post.id.replace(/^(pt|en)\//, '');
}

/** Em produção só sai o que está `published`. Em dev vê-se tudo, para rever. */
export function isVisible(post: Post): boolean {
	return import.meta.env.DEV || process.env.SHOW_DRAFTS === '1' || post.data.status === 'published';
}

export async function getPosts(locale?: Locale): Promise<Post[]> {
	const all = await getCollection('posts', (p) => isVisible(p) && (!locale || p.data.lang === locale));
	return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export async function getTranslation(post: Post): Promise<Post | undefined> {
	if (!post.data.translationKey) return undefined;
	const others = await getCollection(
		'posts',
		(p) => isVisible(p) && p.data.lang !== post.data.lang && p.data.translationKey === post.data.translationKey,
	);
	return others[0];
}

export async function getTags(locale: Locale): Promise<Map<string, number>> {
	const posts = await getPosts(locale);
	const m = new Map<string, number>();
	for (const p of posts) for (const tag of p.data.tags) m.set(tag, (m.get(tag) ?? 0) + 1);
	return new Map([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/** Minutos de leitura a 200 palavras/min, sem contar código nem frontmatter. */
export function readingMinutes(body: string | undefined): number {
	if (!body) return 1;
	const text = body.replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]+>/g, ' ');
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.max(1, Math.round(words / 200));
}

/** Versão do artigo: 1 + número de entradas do changelog depois da publicação. */
export function versionOf(post: Post): string {
	const after = post.data.changelog.filter((c) => c.date.valueOf() > post.data.pubDate.valueOf()).length;
	return `v1.${after}`;
}

/* Leituras relacionadas: 3 por artigo, mesma língua. Pontuação por tags partilhadas (2), mesma série (3) e
   mesma área (1); desempate pelo mais recente. Depois, uma passagem de cobertura: um artigo que não aparece em
   nenhuma lista (órfão) toma o último lugar da lista onde pontua mais, desde que o artigo que sai continue
   ligado a partir de outro sítio. Sem isto, os artigos mais antigos de uma área ficavam a um clique de ninguém
   (7 de 24 nunca foram pedidos por um crawler em 25-28 Set 2026). Determinístico: o mesmo input dá o mesmo site. */
const RELATED_N = 3;
function relScore(a: Post, b: Post): number {
	const tags = a.data.tags.filter((t) => b.data.tags.includes(t)).length;
	return tags * 2 + (a.data.series && a.data.series === b.data.series ? 3 : 0) + (a.data.area === b.data.area ? 1 : 0);
}
let relatedCache: Map<string, Post[]> | null = null;
export async function relatedMap(): Promise<Map<string, Post[]>> {
	if (relatedCache) return relatedCache;
	const out = new Map<string, Post[]>();
	for (const locale of ['pt', 'en'] as Locale[]) {
		const posts = await getPosts(locale);
		const rank = (p: Post) => posts.filter((o) => o.id !== p.id)
			.map((o) => ({ o, s: relScore(p, o) }))
			.sort((x, y) => y.s - x.s || y.o.data.pubDate.valueOf() - x.o.data.pubDate.valueOf() || x.o.id.localeCompare(y.o.id));
		for (const p of posts) out.set(p.id, rank(p).slice(0, RELATED_N).map((x) => x.o));
		const inbound = () => { const m = new Map<string, number>(); for (const p of posts) for (const r of out.get(p.id) ?? []) m.set(r.id, (m.get(r.id) ?? 0) + 1); return m; };
		for (const orphan of posts) {
			if ((inbound().get(orphan.id) ?? 0) > 0 || posts.length <= RELATED_N) continue;
			const inb = inbound();
			const host = posts.filter((h) => h.id !== orphan.id && !(out.get(h.id) ?? []).some((r) => r.id === orphan.id))
				.map((h) => ({ h, s: relScore(h, orphan), last: (out.get(h.id) ?? [])[RELATED_N - 1] }))
				.filter((x) => x.last && (inb.get(x.last.id) ?? 0) > 1)
				.sort((x, y) => y.s - x.s || x.h.id.localeCompare(y.h.id))[0];
			if (host) { const l = out.get(host.h.id)!; l[RELATED_N - 1] = orphan; }
		}
	}
	relatedCache = out;
	return out;
}
