export async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso(): string {
	return new Date().toISOString();
}

/** Tokens normalizados: minúsculas, sem acentos, sem stopwords PT/EN, com 2+ caracteres. */
const STOP = new Set(
	('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem que e ou se ao aos nao mais como mas foi ser sao esta este isso isto qual quais sua seu suas seus me te lhe ja ' +
		'the an and or of to in on for with by at from is are be it its this that what which how do does can not no as into your you our we').split(' '),
);
export function tokens(s: string): Set<string> {
	const out = new Set<string>();
	for (const w of s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
		if (w.length >= 2 && !STOP.has(w)) out.add(w);
	}
	return out;
}
