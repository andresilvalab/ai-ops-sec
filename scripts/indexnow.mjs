// IndexNow depois de cada deploy: avisa o Bing (índice do Copilot e da pesquisa do ChatGPT), a Yandex, a
// Seznam e a Naver de que URLs mudaram, em vez de esperar que voltem a passar. A chave é pública por desenho
// do protocolo (vive em /<chave>.txt); o que ela prova é que quem pinga controla o domínio.
// Uso: node scripts/indexnow.mjs <sha-anterior> [--dry]. Sem sha anterior (ou zeros): envia o sitemap inteiro.
// Falha avisa (::warning) e sai com 0: não se desfaz um deploy porque um índice externo não respondeu.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SITE = 'https://andresilvalab.com';
const key = readFileSync('.indexnow-key', 'utf8').trim();
const [before = '', flag] = process.argv.slice(2);
const dry = flag === '--dry' || before === '--dry';

function fromSitemap() {
	const xml = existsSync('dist/sitemap-0.xml') ? readFileSync('dist/sitemap-0.xml', 'utf8') : '';
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

let urls = [];
if (!before || /^0+$/.test(before) || before === '--dry') {
	urls = fromSitemap();
} else {
	let changed = [];
	try { changed = execSync(`git diff --name-only ${before} HEAD`, { encoding: 'utf8' }).split('\n').filter(Boolean); }
	catch { urls = fromSitemap(); }
	for (const f of changed) {
		const m = f.match(/^src\/content\/posts\/(pt|en)\/(.+)\.mdx?$/);
		if (m) urls.push(`${SITE}${m[1] === 'en' ? '/en' : ''}/blog/${m[2]}/`);
	}
	if (urls.length) urls.push(`${SITE}/`, `${SITE}/en/`, `${SITE}/blog/`, `${SITE}/en/blog/`, `${SITE}/rss.xml`);
	if (changed.some((f) => /^(src\/(layouts|components|lib)|astro\.config)/.test(f))) urls = fromSitemap();
}
urls = [...new Set(urls)].slice(0, 10000);
if (!urls.length) { console.log('indexnow: nada mudou em conteúdo'); process.exit(0); }
const body = { host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList: urls };
if (dry) { console.log(`indexnow (dry): ${urls.length} URLs`); console.log(urls.slice(0, 10).join('\n')); process.exit(0); }
try {
	const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
	console.log(`indexnow: HTTP ${r.status} para ${urls.length} URLs`);
	if (![200, 202].includes(r.status)) console.log(`::warning::IndexNow respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
} catch (e) {
	console.log(`::warning::IndexNow falhou: ${e.message}`);
}
