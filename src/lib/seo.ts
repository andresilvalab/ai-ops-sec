import { AUTHOR, SITE, type Locale } from '../consts';
import type { Post } from './posts';

const PERSON_ID = `${AUTHOR.github}#person`;
const person = () => ({
	'@type': 'Person',
	'@id': PERSON_ID,
	name: AUTHOR.name,
	url: AUTHOR.github,
	sameAs: [AUTHOR.github, AUTHOR.linkedin].filter(Boolean),
});

export function websiteLd(locale: Locale, siteUrl: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'WebSite',
		name: SITE[locale].title,
		description: SITE[locale].description,
		url: siteUrl,
		inLanguage: SITE[locale].locale,
		author: person(),
	};
}

export function articleLd(post: Post, url: string, image: string) {
	const d = post.data;
	return {
		'@context': 'https://schema.org',
		'@type': 'BlogPosting',
		headline: d.title,
		description: d.description,
		datePublished: d.pubDate.toISOString(),
		dateModified: (d.updatedDate ?? d.pubDate).toISOString(),
		inLanguage: SITE[d.lang].locale,
		keywords: d.tags.join(', '),
		url,
		mainEntityOfPage: url,
		image,
		author: person(),
		citation: d.sources.map((s) => ({ '@type': 'CreativeWork', name: s.title, url: s.url })),
	};
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
	};
}

/** Página "Sobre": ProfilePage com a mesma Person (@id) que assina os artigos. */
export function profilePageLd(locale: Locale, url: string) {
	return {
		'@context': 'https://schema.org',
		'@type': 'ProfilePage',
		url,
		inLanguage: SITE[locale].locale,
		dateModified: new Date().toISOString().slice(0, 10),
		mainEntity: {
			...person(),
			description: SITE[locale].description,
			jobTitle: locale === 'pt' ? 'Process Automation & Agentic AI' : 'Process Automation & Agentic AI',
			worksFor: { '@type': 'Organization', name: AUTHOR.company.name, url: AUTHOR.company.url },
			address: { '@type': 'PostalAddress', addressLocality: 'Porto', addressCountry: 'PT' },
			knowsAbout: ['Agentic AI', 'Process automation', 'AI agent security', 'AI observability', 'MCP', 'n8n', 'Token economics', 'Performance marketing'],
		},
	};
}

/** FAQPage a partir do frontmatter `faq`. A Google limitou os rich results de FAQ em 2023; o JSON-LD fica
    porque outros motores e agentes o lêem como pares pergunta-resposta citáveis. */
export function faqLd(post: Post, url: string) {
	const f = post.data.faq ?? [];
	if (!f.length) return null;
	return {
		'@context': 'https://schema.org', '@type': 'FAQPage', url, inLanguage: SITE[post.data.lang].locale,
		mainEntity: f.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
	};
}
