// Отладочный оверлей: ?debug=1 или клавиша D.
// Узел, играющий сегмент и его время, найденный путь, состояние буферов, заглушки вместо рёбер;
// кнопки: проиграть любой сегмент, замедлить до 0.25× для проверки стыков.
(function () {
  const P = window.Player, M = window.MANIFEST || { stops: {}, edges: {} };
  let box, out, timer;
  const fmt = n => (n == null || isNaN(n) ? '–' : n.toFixed(2));
  const hop = h => h.from + (h.edge ? ' =[видео]=> ' : ' ~заглушка~> ') + h.to;
  function ranges(v) {
    const b = v.buffered, r = [];
    for (let i = 0; i < b.length; i++) r.push(fmt(b.start(i)) + '–' + fmt(b.end(i)));
    return r.join(' ') || 'пусто';
  }
  function segments() {
    const list = Object.keys(M.edges).map(k => {
      const [from, to] = k.split('>');
      return { from, to, edge: k, label: k + (M.edges[k].reverseOf ? '  (авто-реверс)' : '') };
    });
    for (const k of P.missing()) {
      const [a, b] = k.split('>');
      list.push({ from: a, to: b, edge: null, label: `${a}>${b}  (заглушка)` }, { from: b, to: a, edge: null, label: `${b}>${a}  (заглушка)` });
    }
    return list;
  }

  function build() {
    box = document.createElement('aside');
    box.className = 'debug';
    box.setAttribute('aria-label', 'Отладка');
    out = document.createElement('pre');
    out.className = 'debug__state';
    const row = document.createElement('div');
    row.className = 'debug__row';
    const sel = document.createElement('select');
    const segs = segments();
    segs.forEach((s, i) => sel.add(new Option(s.label, i)));
    const btn = (text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', fn); return b; };
    const slow = btn('Замедлить 0.25×', () => {
      const on = P.state.slow === 1;
      P.setSlow(on ? 0.25 : 1);
      slow.setAttribute('aria-pressed', on);
    });
    slow.setAttribute('aria-pressed', 'false');
    row.append(sel, btn('Проиграть', async () => {
      const s = segs[sel.value];
      await App.jump(s.from);
      await new Promise(r => setTimeout(r, 400));
      App.goTo(s.to, [{ from: s.from, to: s.to, edge: s.edge }]);
    }));
    const row2 = document.createElement('div');
    row2.className = 'debug__row';
    row2.append(slow, btn('Закрыть (D)', () => toggle(false)));
    box.append(out, row, row2);
    // внутри панели колесо и клавиши принадлежат ей, а не навигации
    box.addEventListener('wheel', e => e.stopPropagation());
    box.addEventListener('keydown', e => e.stopPropagation());
    document.body.append(box);
  }

  function render() {
    const s = P.state, seg = s.segment;
    const segTxt = !seg ? '—'
      : seg.once ? `${seg.edge}  ${fmt(seg.L.el.currentTime)} / ${fmt(seg.L.el.duration)} с  ×${seg.rate}  (вход: ${seg.join.type})`
      : `→ ${seg.L.id}  склейка ${seg.join.type} ${seg.join.dur} с`;
    const layers = [...P.layers.values()].map(L => {
      const vis = L.el.style.opacity === '1' ? '[виден]' : '[скрыт]';
      const vids = L.videos.map(v => `readyState=${v.readyState} ${v.paused ? 'пауза' : 'играет'} t=${fmt(v.currentTime)} буфер ${ranges(v)}`).join(' | ');
      return `  ${vis} ${L.k}  z=${L.el.style.zIndex || 0}  ${vids || (L.kind === 'stop' ? 'без видео' : '')}`;
    });
    out.textContent = [
      `узел: ${s.current}${s.target ? ' → ' + s.target : ''}${s.busy ? '  (в пути)' : ''}   скорость ×${s.slow}${s.blocked ? '   АВТОПЛЕЙ ЗАБЛОКИРОВАН' : ''}`,
      `сегмент: ${segTxt}`,
      `путь: ${s.path.map(hop).join('  |  ') || '—'}`,
      `буферы (${P.layers.size}):`, ...layers,
      `заглушки вместо рёбер: ${P.missing().join(', ') || 'нет'}`,
      `PSNR стыков пролёт→цикл, дБ: ${Object.entries(M.edges).map(([k, e]) => `${k} ${e.joinPsnr != null ? e.joinPsnr : '–'}`).join(', ') || '—'}`,
      `PSNR циклов, дБ: ${Object.entries(M.stops).filter(([, x]) => x.loop).map(([k, x]) => `${k} ${x.loopPsnr != null ? x.loopPsnr : '–'}`).join(', ') || '—'}`,
    ].join('\n');
  }

  function toggle(on = !box || box.hidden) {
    if (on && !box) build();
    if (box) box.hidden = !on;
    clearInterval(timer);
    if (on) { render(); timer = setInterval(render, 200); }
  }
  addEventListener('keydown', e => { if (e.code === 'KeyD' && !e.ctrlKey && !e.metaKey && !e.altKey) toggle(); });
  if (/[?&]debug=1\b/.test(location.search)) toggle(true);
})();
