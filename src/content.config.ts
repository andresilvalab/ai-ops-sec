import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { AREA_KEYS } from './lib/areas';
import { ANIMATION_IDS } from './lib/animations';

// Um post é uma afirmação pública assinada. O frontmatter obriga a dizer de onde
// vem cada coisa (sources), o que foi verificado à mão (verified) e o que mudou
// desde a publicação (changelog). Isto aparece no cabeçalho de cada artigo.
const posts = defineCollection({
	loader: glob({ base: './src/content/posts', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string().min(8).max(120),
			description: z.string().min(40).max(200),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			lang: z.enum(['pt', 'en']),
			area: z.enum(AREA_KEYS),
			translationKey: z.string().optional(),
			tags: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1).max(8),
			series: z.string().optional(),
			heroImage: image().optional(),
			heroAlt: z.string().optional(),
			cover: z.enum(ANIMATION_IDS).optional(),
			status: z.enum(['draft', 'review', 'approved', 'published']).default('draft'),
			scheduledFor: z.coerce.date().optional(),
			sources: z
				.array(z.object({ title: z.string(), url: z.string().url(), accessed: z.coerce.date().optional() }))
				.default([]),
			verified: z.array(z.string()).default([]),
			verifiedOn: z.coerce.date().optional(),
			changelog: z.array(z.object({ date: z.coerce.date(), note: z.string() })).default([]),
			canonical: z.string().url().optional(),
			// Perguntas que o artigo responde, em 1 a 3 frases cada. Saem no fim do artigo e em JSON-LD FAQPage:
			// são as passagens que um motor de resposta extrai. Só perguntas que o texto responde de facto.
			faq: z.array(z.object({ q: z.string().min(8).max(160), a: z.string().min(20).max(600) })).max(8).default([]),
		}),
});

export const collections = { posts };
