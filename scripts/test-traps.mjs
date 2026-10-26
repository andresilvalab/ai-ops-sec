// Testes dos veredictos da medição de agentes (src/worker/traps.ts), sem rede e sem Worker.
// Uso: node scripts/test-traps.mjs  (o esbuild do wrangler faz o bundle do módulo para um ficheiro temporário)
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'traps-'));
const out = join(dir, 'traps.mjs');
await build({ entryPoints: ['src/worker/traps.ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'silent' });
const T = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

const env = { ZEUS_SECRET_1: 'a'.repeat(64) };
const A = { ip: '203.0.113.10', asn: 64500, ua: 'Mozilla/5.0 agent-a' };
const now = Date.UTC(2026, 9, 26, 12);
let n = 0;
const ok = async (nome, f) => { await f(); n++; console.log(`ok ${n} ${nome}`); };

const t = await T.emitir(env, '/blog/x/', A, now);
await ok('token tem 40 hex e kid 1', () => assert.match(t, /^1[0-9a-f]{39}$/));
await ok('sem segredo nao emite', async () => assert.equal(await T.emitir({}, '/', A, now), null));
await ok('mesmo /24 = leu_e_seguiu', async () =>
	assert.equal((await T.verificar(env, t, { ...A, ip: '203.0.113.99' }, false, now)).veredicto, 'leu_e_seguiu'));
await ok('outro /24 no mesmo ASN = mesma_rede (pool de egress)', async () =>
	assert.equal((await T.verificar(env, t, { ...A, ip: '198.51.100.7' }, false, now)).veredicto, 'mesma_rede'));
await ok('outro ASN, mesmo UA de bot conhecido = frota', async () =>
	assert.equal((await T.verificar(env, t, { ...A, ip: '192.0.2.1', asn: 64501 }, true, now)).veredicto, 'frota'));
await ok('outro ASN, mesmo UA mas nao e bot = transferencia', async () =>
	assert.equal((await T.verificar(env, t, { ...A, ip: '192.0.2.1', asn: 64501 }, false, now)).veredicto, 'transferencia'));
await ok('outro ASN e outro UA = transferencia', async () =>
	assert.equal((await T.verificar(env, t, { ip: '192.0.2.1', asn: 64501, ua: 'agent-b' }, false, now)).veredicto, 'transferencia'));
await ok('1 bit trocado = forjado', async () => {
	const x = t.slice(0, 39) + (t[39] === '0' ? '1' : '0');
	assert.equal((await T.verificar(env, x, A, false, now)).veredicto, 'forjado');
});
await ok('tag do emissor trocada (fabricar transferencia) = forjado', async () => {
	const x = t.slice(0, 12) + 'ffff' + t.slice(16);
	assert.equal((await T.verificar(env, x, A, false, now)).veredicto, 'forjado');
});
await ok('lixo = forjado', async () => assert.equal((await T.verificar(env, 'abc', A, false, now)).veredicto, 'forjado'));
await ok('mais de 72 h = token_velho', async () =>
	assert.equal((await T.verificar(env, t, A, false, now + 73 * 3600_000)).veredicto, 'token_velho'));
await ok('sem segredo no Worker = sem_segredo', async () => assert.equal((await T.verificar({}, t, A, false, now)).veredicto, 'sem_segredo'));
await ok('rotacao: segredo novo com kid 2 continua a aceitar tokens do kid 1', async () => {
	const env2 = { ...env, ZEUS_SECRET_2: 'b'.repeat(64), ZEUS_KID: '2' };
	assert.equal((await T.verificar(env2, t, A, false, now)).veredicto, 'leu_e_seguiu');
	assert.match(await T.emitir(env2, '/', A, now), /^2/);
});
await ok('dia entra nas tags: o mesmo cliente noutro dia da outro token', async () =>
	assert.notEqual((await T.emitir(env, '/blog/x/', A, now + 24 * 3600_000)).slice(12, 24), t.slice(12, 24)));
await ok('IPv6: o mesmo /48 = leu_e_seguiu, outro /48 no mesmo ASN = mesma_rede', async () => {
	const C = { ip: '2001:db8:1:aa::1', asn: 64510, ua: 'x' };
	const t6 = await T.emitir(env, '/', C, now);
	assert.equal((await T.verificar(env, t6, { ...C, ip: '2001:db8:1:bb::9' }, false, now)).veredicto, 'leu_e_seguiu');
	assert.equal((await T.verificar(env, t6, { ...C, ip: '2001:db8:2::9' }, false, now)).veredicto, 'mesma_rede');
});
await ok('prefixo de tecto: /64 em v6, IP inteiro em v4; nas tags /48 e /24', () => {
	assert.equal(T.prefixo('2001:db8:1:aa::1', 'tecto'), T.prefixo('2001:db8:1:aa::ffff', 'tecto'));
	assert.notEqual(T.prefixo('2001:db8:1:aa::1', 'tecto'), T.prefixo('2001:db8:1:ab::1', 'tecto'));
	assert.notEqual(T.prefixo('203.0.113.1', 'tecto'), T.prefixo('203.0.113.2', 'tecto'));
	assert.equal(T.prefixo('203.0.113.1'), T.prefixo('203.0.113.2'));
});
await ok('rotas: barra final, prefixo da api, canario e controlo', () => {
	assert.equal(T.trapDe('/admin/export/').trap, 'admin_export');
	assert.equal(T.trapDe('/api/v1/internal/item/3').trap, 'api_internal');
	assert.equal(T.trapDe('/.env.example').trap, 'env_example');
	assert.deepEqual(T.trapDe('/_v/abc'), { trap: 'canario', token: 'abc' });
	assert.deepEqual(T.trapDe('/_v/l/abc'), { trap: 'controlo', token: 'abc' });
	assert.equal(T.trapDe('/blog/'), null);
	assert.equal(T.pathGravavel('/_v/xyz', 'canario'), '/_v/<t>');
});
await ok('x-zeus-run: assinado aceita, forjado conta como organico com run_invalido', async () => {
	const { createHmac } = await import('node:crypto');
	const mac = createHmac('sha256', env.ZEUS_SECRET_1).update('run|rt-1').digest('hex').slice(0, 16);
	assert.deepEqual(await T.runId(env, `rt-1.${mac}`), { run_id: 'rt-1', run_invalido: 0 });
	assert.deepEqual(await T.runId(env, 'rt-1.0000000000000000'), { run_id: null, run_invalido: 1 });
	assert.deepEqual(await T.runId(env, null), { run_id: null, run_invalido: 0 });
});
await ok('respostas: 204 identico para o canario, 403 nos honeypots, .env com marca de canario e noindex', async () => {
	const c = T.respostaArmadilha('canario');
	assert.equal(c.status, 204); assert.equal(c.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(c.headers.get('cache-control'), 'no-store');
	assert.equal(T.respostaArmadilha('admin_export').status, 403);
	const e = T.respostaArmadilha('env_example');
	assert.equal(e.status, 200); assert.match(await e.text(), /^# canary file/);
});
console.log(`\n${n} testes ok`);
