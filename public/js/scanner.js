/* Scanner Agent-Ready: chama /api/scan e desenha o resultado. Tudo por textContent: o resultado traz
   texto vindo do site analisado (tipos JSON-LD, nomes de tools, erros) e nunca entra como HTML. */
(() => {
	const form = document.getElementById('scan-form');
	if (!form) return;
	const lang = form.dataset.lang === 'en' ? 'en' : 'pt';
	const api = form.dataset.api || '/api/scan';
	const $ = (id) => document.getElementById(id);
	const T = {
		pt: { run: 'A analisar… (até 30 s)', err: 'Não foi possível analisar', cached: 'resultado em cache de', fresh: 'analisado agora', na: 'n/a', invalid: 'Indica um domínio público, por exemplo exemplo.pt', none: 'Nada urgente: o site cobre as camadas que se medem de fora.' },
		en: { run: 'Scanning… (up to 30 s)', err: 'Could not scan', cached: 'cached result from', fresh: 'scanned just now', na: 'n/a', invalid: 'Enter a public domain, for example example.com', none: 'Nothing urgent: the site covers the layers measurable from outside.' },
	}[lang];
	const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };

	function render(r) {
		$('scan-host').textContent = `//${r.host}`;
		$('scan-score').textContent = `${r.score}/100`;
		$('scan-when').textContent = r.cached ? `${T.cached} ${String(r.cached_at || '').slice(0, 16).replace('T', ' ')} UTC` : T.fresh;
		const bars = $('scan-bars'); bars.replaceChildren();
		const layers = $('scan-layers'); layers.replaceChildren();
		const recs = $('scan-recs'); recs.replaceChildren();
		for (const l of r.layers || []) {
			const row = el('div', 'barrow');
			row.append(el('span', null, l.id));
			const track = el('div', 'track'); const fill = el('div', 'fill');
			fill.style.width = l.applicable && l.max ? `${Math.round((100 * l.score) / l.max)}%` : '0%';
			track.append(fill); row.append(track);
			row.append(el('span', null, l.applicable ? `${l.score}/${l.max}` : T.na));
			bars.append(row);

			const card = el('div', 'card layer');
			const h = el('h3');
			h.append(el('span', null, `${l.id} · ${l.name[lang]}`), el('span', 'mono', l.applicable ? `${l.score}/${l.max}` : T.na));
			card.append(h);
			const ul = el('ul');
			for (const c of l.checks || []) {
				const li = el('li');
				li.append(el('span', c.ok === true ? 'ok' : c.ok === false ? 'no' : 'na', c.ok === true ? '✓' : c.ok === false ? '✕' : '·'));
				const body = el('span');
				body.append(el('span', null, c.label[lang]));
				if (c.detail) { body.append(document.createElement('br')); body.append(el('span', 'd', c.detail)); }
				li.append(body); ul.append(li);
				if (c.rec) recs.append(el('li', null, `${l.id}: ${c.rec[lang]}`));
			}
			card.append(ul); layers.append(card);
		}
		if (!recs.children.length) recs.append(el('li', null, T.none));
		$('scan-method').textContent = r.method ? r.method[lang] : '';
		$('scan-result').hidden = false;
	}

	async function run(target) {
		const status = $('scan-status'); status.className = 'status mono'; status.textContent = T.run;
		$('scan-go').disabled = true;
		try {
			const res = await fetch(`${api}?url=${encodeURIComponent(target)}`, { headers: { accept: 'application/json' } });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
			render(data); status.textContent = '';
			const u = new URL(location.href); u.searchParams.set('url', data.host); history.replaceState(null, '', u);
		} catch (e) {
			status.className = 'status mono err'; status.textContent = `${T.err}: ${e.message}`;
		} finally { $('scan-go').disabled = false; }
	}

	form.addEventListener('submit', (ev) => {
		ev.preventDefault();
		const v = $('scan-url').value.trim();
		if (!v) { $('scan-status').textContent = T.invalid; return; }
		run(v);
	});
	const q = new URLSearchParams(location.search).get('url');
	if (q) { $('scan-url').value = q; run(q); }
})();
