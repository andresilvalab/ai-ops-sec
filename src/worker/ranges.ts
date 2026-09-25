/* Verificação de bots por IP contra as listas oficiais que cada fornecedor publica. O User-Agent
   declara-se; o IP prova-se. Um pedido que diz ser OAI-SearchBot e vem de fora das redes da OpenAI
   é um impostor. Operadores sem lista publicada ficam "não verificável", nunca "verificado". */

export const LISTS: Record<string, string[]> = {
	openai: ['https://openai.com/searchbot.json', 'https://openai.com/gptbot.json', 'https://openai.com/chatgpt-user.json'],
	anthropic: ['https://claude.com/crawling/bots.json'],
	perplexity: ['https://www.perplexity.com/perplexitybot.json', 'https://www.perplexity.com/perplexity-user.json'],
	google: [
		'https://developers.google.com/static/search/apis/ipranges/googlebot.json',
		'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json',
		'https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json',
		'https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers-google.json',
	],
	microsoft: ['https://www.bing.com/toolbox/bingbot.json'],
	apple: ['https://search.developer.apple.com/applebot.json'],
	commoncrawl: ['https://index.commoncrawl.org/ccbot.json'],
};

export interface Net { v6: boolean; base: bigint; mask: bigint; }
export interface Ip { v6: boolean; n: bigint; }

function parseV4(s: string): bigint | null {
	const p = s.split('.');
	if (p.length !== 4) return null;
	let n = 0n;
	for (const x of p) {
		if (!/^\d{1,3}$/.test(x)) return null;
		const v = Number(x);
		if (v > 255) return null;
		n = (n << 8n) | BigInt(v);
	}
	return n;
}

function parseV6(s: string): bigint | null {
	let tail: bigint | null = null;
	let str = s;
	const lastColon = str.lastIndexOf(':');
	if (str.includes('.') && lastColon >= 0) {
		tail = parseV4(str.slice(lastColon + 1));
		if (tail === null) return null;
		str = str.slice(0, lastColon) + ':0:0';
	}
	const halves = str.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
	if (fill < 0) return null;
	const groups = [...head, ...Array(fill).fill('0'), ...rest];
	if (groups.length !== 8) return null;
	let n = 0n;
	for (const g of groups) {
		if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
		n = (n << 16n) | BigInt(parseInt(g, 16));
	}
	if (tail !== null) n = (n & ~0xffffffffn) | tail;
	return n;
}

export function parseIp(ip: string): Ip | null {
	const s = ip.trim();
	if (s.includes(':')) {
		const n = parseV6(s);
		if (n === null) return null;
		// IPv4 mapeado (::ffff:a.b.c.d) compara-se como IPv4
		if (n >> 32n === 0xffffn) return { v6: false, n: n & 0xffffffffn };
		return { v6: true, n };
	}
	const n = parseV4(s);
	return n === null ? null : { v6: false, n };
}

export function parseCidr(cidr: string): Net | null {
	const [addr, bitsStr] = cidr.split('/');
	const ip = parseIp(addr);
	if (!ip) return null;
	const width = ip.v6 ? 128n : 32n;
	const bits = BigInt(bitsStr === undefined ? Number(width) : Number(bitsStr));
	if (bits < 0n || bits > width) return null;
	const all = (1n << width) - 1n;
	const mask = all ^ ((1n << (width - bits)) - 1n);
	return { v6: ip.v6, base: ip.n & mask, mask };
}

export function inNets(ip: Ip, nets: Net[]): boolean {
	for (const net of nets) if (net.v6 === ip.v6 && (ip.n & net.mask) === net.base) return true;
	return false;
}

/** Extrai CIDRs do formato comum ({prefixes:[{ipv4Prefix|ipv6Prefix}]}). */
export function cidrsFrom(json: unknown): string[] {
	const p = (json as { prefixes?: Record<string, string>[] })?.prefixes;
	if (!Array.isArray(p)) return [];
	return p.map((x) => x.ipv4Prefix || x.ipv6Prefix).filter((x): x is string => typeof x === 'string');
}
