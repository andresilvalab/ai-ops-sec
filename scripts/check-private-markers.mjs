#!/usr/bin/env node
/* Portão público e genérico: recusa marcadores que nunca deviam chegar a este repo
   (caminhos absolutos de máquina, referências a bases privadas, tokens óbvios).
   A lista de termos sensíveis vive fora deste repositório, de propósito. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro']);
const TEXT_EXT = new Set(['.md', '.mdx', '.astro', '.ts', '.mjs', '.js', '.json', '.yml', '.yaml', '.css', '.txt', '.svg']);
const RULES = [
	[/\/Volumes\/[A-Za-z0-9_.-]+\//, 'caminho absoluto de volume'],
	[/\/Users\/[A-Za-z0-9_.-]+\//, 'caminho absoluto de utilizador'],
	[/qmd:\/\//, 'referência a índice privado'],
	[/\.jsonl\b/, 'referência a ledger privado'],
	[/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, 'token GitHub'],
	[/\bgithub_pat_[A-Za-z0-9_]{50,}/, 'token GitHub (fine-grained)'],
	[/\bsk-(ant-)?[A-Za-z0-9\-_]{32,}/, 'chave de API'],
	[/\bxox[baprs]-[A-Za-z0-9-]{20,}/, 'token Slack'],
	[/\bAKIA[0-9A-Z]{16}\b/, 'chave AWS'],
	[/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT'],
	[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
];

let problems = 0;
function walk(dir) {
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p);
		else if (TEXT_EXT.has(extname(name)) && st.size < 4_000_000) {
			if (p.endsWith('scripts/check-private-markers.mjs')) continue;
			const text = readFileSync(p, 'utf8');
			text.split('\n').forEach((line, i) => {
				for (const [rx, label] of RULES) {
					if (rx.test(line)) {
						problems++;
						console.log(`${p.replace(ROOT + '/', '')}:${i + 1}: ${label}`);
					}
				}
			});
		}
	}
}
walk(ROOT);
// Ficheiros que nunca podem estar no repo, mesmo que o texto pareca limpo: o estado local do wrangler (SQLite com
// o que o `wrangler dev` registou) e os segredos locais. Auditoria de 28-Set-2026: .wrangler/state entrou no PR #37.
try {
	for (const f of execSync('git ls-files', { encoding: 'utf8' }).split('\n')) {
		if (/^\.wrangler\/|(^|\/)\.dev\.vars|\.sqlite(-wal|-shm)?$|(^|\/)\.env(\.|$)/.test(f)) {
			problems++;
			console.log(`${f}: estado local ou segredo local no repositório`);
		}
	}
} catch { /* fora de um repo git: so o varrimento de texto */ }
if (problems) {
	console.error(`\n${problems} marcador(es) privado(s). Nada disto pode ser publicado.`);
	process.exit(1);
}
console.log('check-private-markers: limpo');
