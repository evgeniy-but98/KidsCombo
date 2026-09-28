// Видеодвижок: слои-буферы, граф остановок и пролётов, поиск пути, склейки, заглушки.
// Про интерфейс ничего не знает. API: window.Player (init, show, go, path, unblock, state).
(function () {
  const M = window.MANIFEST || { stops: {}, edges: {} };
  const C = window.CONFIG;
  const D = C.defaults;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const state = { current: null, target: null, path: [], segment: null, busy: false, slow: 1, blocked: false, missing: [] };
  const layers = new Map(); // "stop:<id>" | "edge:<from>><to>" -> { kind, id, el, videos, fps }
  let stage, fx, z = 1;

  // ---------- граф ----------
  let G;
  function graph() {
    if (G) return G;
    G = new Map();
    const add = (a, b, edge) => { if (!G.has(a)) G.set(a, []); G.get(a).push({ from: a, to: b, edge }); };
    for (const k in M.edges) { const [a, b] = k.split('>'); add(a, b, k); }
    // заглушки: соседи по туру (и пары из CONFIG.stubs), между которыми нет пути по реальным рёбрам
    const pairs = C.tour.slice(1).map((b, i) => [C.tour[i], b]).concat(Object.keys(C.stubs || {}).map(k => k.split('>')));
    const missing = new Map();
    for (const [a, b] of pairs) if (!bfs(a, b) && !missing.has(b + '>' + a)) missing.set(a + '>' + b, [a, b]);
    for (const [a, b] of missing.values()) { add(a, b, null); add(b, a, null); }
    state.missing = [...missing.keys()];
    return G;
  }
  function bfs(from, to) {
    if (from === to) return [];
    const prev = new Map([[from, null]]), q = [from];
    while (q.length) {
      for (const h of G.get(q.shift()) || []) {
        if (prev.has(h.to)) continue;
        prev.set(h.to, h);
        if (h.to === to) { const p = []; for (let x = h; x; x = prev.get(x.from)) p.unshift(x); return p; }
        q.push(h.to);
      }
    }
    return null;
  }
  function path(from, to) {
    graph();
    const p = bfs(from, to) || [{ from, to, edge: null }];
    // подряд идущие обычные заглушки (кадров ещё нет) склеиваем в одну — нечего проезжать
    const fade = h => !h.edge && stubJoin(h.from, h.to).type === 'fade';
    return p.reduce((acc, h) => {
      const prev = acc[acc.length - 1];
      if (prev && fade(prev) && fade(h)) acc[acc.length - 1] = { from: prev.from, to: h.to, edge: null };
      else acc.push(h);
      return acc;
    }, []);
  }

  // ---------- параметры склеек ----------
  function cfg(key) {
    const e = C.edges[key] || {};
    return Object.assign({}, D, e, { push: Object.assign({}, D.push, e.push) });
  }
  function startJoin(key) { // из цикла в первый кадр пролёта
    const rev = M.edges[key].reverseOf;
    if (rev && C.edges[rev] && C.edges[rev].join === 'push') { const f = cfg(rev); return { type: 'pull', dur: f.joinDuration, push: f.push }; }
    const c = cfg(key);
    return { type: c.loopExitFade ? 'crossfade' : 'cut', dur: c.loopExitFade };
  }
  function endJoin(key) { const c = cfg(key); return { type: c.join, dur: c.joinDuration, push: c.push }; }
  function transitJoin(e1, e2) { // между двумя пролётами на промежуточной остановке
    const j = endJoin(e1);
    if (j.type !== 'push') { const s = startJoin(e2); if (s.type === 'pull') return s; }
    return j;
  }
  function stubJoin(from, to) {
    let s = C.stubs && C.stubs[from + '>' + to], back = false;
    if (!s && C.stubs && C.stubs[to + '>' + from]) { s = C.stubs[to + '>' + from]; back = true; }
    const type = (s && s.type) || D.stub;
    const kind = { doors: back ? 'doorsBack' : 'doors', push: back ? 'pull' : 'push' }[type] || 'fade';
    return { type: kind, dur: (s && s.duration) || D.stubDuration };
  }

  // ---------- кейфреймы склеек: a — уходящий слой, b — входящий, fx — тёплый свет ----------
  const S = k => `scale(${k})`, F = b => `blur(${b}px)`;
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)', EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'; // как --ease-* в style.css
  const KF = {
    crossfade: () => ({ b: [{ opacity: 0 }, { opacity: 1 }] }),
    push: p => ({
      a: [{ transform: S(1), filter: F(0) }, { transform: S(p.outScale), filter: F(p.outBlur) }],
      b: [{ opacity: 0, transform: S(p.inScale), filter: F(p.inBlur) }, { opacity: 1, transform: S(1), filter: F(0) }],
    }),
    pull: p => ({ // зеркальный push: цикл «отъезжает», пролёт проявляется из наезда
      a: [{ transform: S(1), filter: F(0) }, { transform: S(p.inScale), filter: F(p.inBlur) }],
      b: [{ opacity: 0, transform: S(p.outScale), filter: F(p.outBlur) }, { opacity: 1, transform: S(1), filter: F(0) }],
    }),
    fade: () => ({
      a: [{ transform: S(1) }, { transform: S(1.08) }],
      b: [{ opacity: 0, transform: S(1.04) }, { opacity: 1, transform: S(1) }],
    }),
    // Двери остаются закрытыми: свет из центральной щели заполняет кадр и открывает комнату.
    doors: () => ({
      easing: 'linear',
      a: [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0, offset: 0.78 }],
      fx: [{ opacity: 0, transform: 'scaleX(0.002)' }, { opacity: 1, transform: 'scaleX(1.05)', offset: 0.58, easing: EASE_IN_OUT }, { opacity: 1, transform: 'scaleX(1.05)', offset: 0.68 }, { opacity: 0, transform: 'scaleX(1.05)' }],
      b: [{ opacity: 0 }, { opacity: 0, offset: 0.55 }, { opacity: 1, offset: 0.8 }, { opacity: 1 }],
    }),
    doorsBack: () => ({
      easing: 'linear',
      a: [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.76 }],
      fx: [{ opacity: 0, transform: 'scaleX(0.002)' }, { opacity: 1, transform: 'scaleX(1.05)', offset: 0.55, easing: EASE_IN_OUT }, { opacity: 1, transform: 'scaleX(1.05)', offset: 0.65 }, { opacity: 0, transform: 'scaleX(1.05)' }],
      b: [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.78 }, { opacity: 1 }],
    }),
  };

  function join(j, a, b, rate) {
    const ms = (j.dur || 0) * 1000 / (rate * state.slow);
    b.el.style.opacity = 1;
    if (j.type === 'cut' || !ms || !KF[j.type]) return Promise.resolve();
    const k = KF[j.type](j.push || D.push);
    const opts = { duration: ms, easing: k.easing || EASE_IN_OUT, fill: 'both' };
    const anims = [];
    if (k.a && a) anims.push(a.el.animate(k.a, opts));
    if (k.b) anims.push(b.el.animate(k.b, opts));
    if (k.fx) anims.push(fx.animate(k.fx, opts));
    return Promise.all(anims.map(x => x.finished)).then(() => {
      b.el.getAnimations().forEach(x => x.cancel());
      fx.getAnimations().forEach(x => x.cancel());
    });
  }

  // ---------- слои ----------
  function div(cls, text) { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; return d; }
  function video(src) {
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    v.src = src;
    return v;
  }
  function layer(k) {
    let L = layers.get(k);
    if (L) return L;
    const id = k.slice(5);
    if (k.startsWith('edge:')) {
      const e = M.edges[id], v = video(e.src);
      v.className = 'layer';
      L = { k, kind: 'edge', id, el: v, videos: [v], fps: e.fps || 24 };
    } else {
      const s = M.stops[id] || {}, cs = C.stops[id] || {};
      const src = s.loop || s.once; // once — играет один раз и держит последний кадр (логотип)
      const el = div('layer stop' + (src ? '' : s.still ? ' stop--still' : cs.backdrop ? ' stop--backdrop' : ' stop--empty') + (cs.finale ? ' stop--finale' : ''));
      // Кадр целиком на любом экране (CONFIG.stops.<id>.frame): другой формат — логотип 2:1, поля залиты цветом фона ролика
      if (cs.frame && cs.frame.fit === 'contain') {
        el.dataset.fitAll = 'contain';
        if (cs.frame.background) el.style.backgroundColor = cs.frame.background;
      }
      // Узкий экран: кадр целиком, свободное место — заполнение (CONFIG.stops.<id>.mobileFrame, см. style.css)
      const mf = cs.mobileFrame, narrowFit = mf && mf.fit === 'contain';
      if (narrowFit) { el.dataset.fit = 'contain'; if (mf.frame) el.dataset.frame = mf.frame; }
      if (cs.content && cs.content.box) el.dataset.text = ''; // на телефоне карточка сверху (слева), текст — рядом с ней
      // заполнение полей: на узком экране (mobileFrame) и/или на любом (frame.fill — кадр пэкшота целиком на 16:10, 21:9)
      const fill = (narrowFit && (mf.fill || 'ambient')) || (cs.frame && cs.frame.fill);
      let cv = null;
      if (fill) {
        el.dataset.fill = fill;
        const f = div('stop__fill'), tint = (mf && mf.tint) || (cs.frame && cs.frame.tint);
        if (tint) f.style.setProperty('--tint', tint);
        if (fill === 'ambient') {
          if (s.poster) f.style.backgroundImage = `url("${s.poster}")`;
          cv = document.createElement('canvas');
          cv.width = 64; cv.height = 36;
          f.append(cv);
        }
        el.append(f);
      }
      const bg = div('stop__bg');
      const poster = s.poster || (!src && !s.still && cs.backdrop); // раздел тритмента: размытый утверждённый кадр
      if (poster) bg.style.backgroundImage = `url("${poster}")`;
      el.append(bg);
      const videos = [];
      if (src) for (let i = 0; i < (s.loop && D.loopMode === 'pingpong' ? 2 : 1); i++) { const v = video(src); el.append(v); videos.push(v); }
      if (!src && !s.still && !cs.backdrop) { el.append(div('stop__todo', 'кадр в работе')); el.lastChild.append(div('stop__id', id)); }
      L = { k, kind: 'stop', id, el, videos, bg, once: !!s.once, fps: s.fps || 24, cv, cx: cv && cv.getContext('2d') };
    }
    L.el.dataset.layer = k;
    stage.insertBefore(L.el, fx);
    layers.set(k, L);
    return L;
  }
  const stopLayer = id => layer('stop:' + id);
  // «Живое размытие» вокруг кадра: раз в 120 мс крошечная копия текущего кадра в canvas, размывает её CSS
  const narrow = matchMedia('(max-width: 700px), (max-height: 580px), (max-aspect-ratio: 4/3), (min-aspect-ratio: 37/20)');
  setInterval(() => {
    for (const L of layers.values()) {
      if (!L.cx || L.el.style.opacity === '0' || !(narrow.matches || L.el.dataset.fitAll)) continue;
      const v = L.videos.find(x => !x.paused) || L.videos[0];
      if (v && v.readyState >= 2) L.cx.drawImage(v, 0, 0, L.cv.width, L.cv.height);
    }
  }, 120);
  function dispose(L) {
    for (const v of L.videos) { v._want = false; v.pause(); v.removeAttribute('src'); v.load(); }
    L.el.remove();
    layers.delete(L.k);
  }
  function hide(L) {
    L.el.style.opacity = 0;
    L.el.getAnimations({ subtree: true }).forEach(x => x.cancel());
    if (L.kind === 'stop') stopLoop(L);
    else { L.el._want = false; L.el.pause(); L.el.currentTime = 0; }
  }

  // Готовность: видео загружено и стоит на кадре 0 (кадр уже отрисован). false по таймауту.
  function ready(v, ms = 8000) {
    return new Promise(res => {
      if (!v.getAttribute('src')) return res(false);
      if (v.currentTime !== 0) v.currentTime = 0;
      const ok = () => v.readyState >= 2 && !v.seeking;
      if (ok()) return res(true);
      const evs = ['loadeddata', 'seeked', 'canplay'];
      const chk = () => ok() && done(true);
      const done = r => { clearTimeout(t); clearTimeout(kick); evs.forEach(e => v.removeEventListener(e, chk)); res(r); };
      evs.forEach(e => v.addEventListener(e, chk));
      const t = setTimeout(() => done(ok()), ms);
      // iOS игнорирует preload и не грузит видео без play(): muted play → pause запускает загрузку.
      // Видео, которое уже запустили по-настоящему (v._want, см. play), не трогаем — иначе цикл застынет на кадре 0.
      const kick = setTimeout(() => { if (!ok() && !v._want) v.play().then(() => { if (!v._want) { v.pause(); v.currentTime = 0; } }, () => {}); }, 1200);
    });
  }
  const readyLayer = L => Promise.all(L.videos.map(v => ready(v))).then(r => r.every(Boolean));

  // ---------- воспроизведение ----------
  let release, unblocked;
  const resetBlock = () => { unblocked = new Promise(r => { release = r; }); };
  resetBlock();
  function play(v) {
    v._want = true; // видео должно играть; сбрасывается там, где его останавливают намеренно
    return v.play().catch(err => {
      if (err.name !== 'NotAllowedError') return; // AbortError: play() прерван pause() — это нормально
      if (!state.blocked) { state.blocked = true; if (P.onblocked) P.onblocked(); }
      return unblocked.then(() => play(v));
    });
  }

  // Когда показан кадр, начиная с которого сегмент считаем законченным (последний кадр).
  function watchEnd(v, fps, cb) {
    let done = false;
    const end = () => v.duration - 1.5 / fps;
    const finish = () => { if (!done) { done = true; v.removeEventListener('ended', finish); cb(); } };
    v.addEventListener('ended', finish); // страховка
    if (v.requestVideoFrameCallback) {
      const f = (now, md) => { if (!done) md.mediaTime >= end() ? finish() : v.requestVideoFrameCallback(f); };
      v.requestVideoFrameCallback(f);
    } else {
      let last = 0;
      const f = () => {
        if (done) return;
        const t = v.currentTime;
        (t >= end() || t < last - 0.5) ? finish() : (last = t, requestAnimationFrame(f));
      };
      requestAnimationFrame(f);
    }
    return () => { done = true; v.removeEventListener('ended', finish); };
  }
  function playOnce(v, fps, rate) {
    return new Promise(res => {
      v.loop = false;
      v.playbackRate = rate * state.slow;
      v._rate = rate;
      let t;
      const stop = watchEnd(v, fps, () => { clearTimeout(t); res(); });
      play(v).then(() => { // страховка от зависшей сети: сегмент не может длиться бесконечно
        t = setTimeout(() => { stop(); res(); }, (v.duration || 10) / (rate * state.slow) * 2000 + 5000);
      });
    });
  }

  // Цикл остановки: атрибут loop или пинг-понг двух элементов (CONFIG.defaults.loopMode).
  function startLoop(L) {
    stopLoop(L);
    if (L.kind !== 'stop') return;
    if (!L.videos.length) {
      if (L.el.classList.contains('stop--still') && !reduced.matches)
        L.kb = L.bg.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }], { duration: 20000, easing: 'linear', fill: 'forwards' });
      return;
    }
    if (L.once) { if (!state.busy) playHold(L); return; } // разовый ролик — только после прихода, не во время перехода
    const token = L.token = {};
    const [a, b] = L.videos;
    if (!b) { a.loop = true; a.playbackRate = state.slow; a._rate = 1; play(a); return; }
    (async () => {
      let cur = a, next = b;
      cur.style.zIndex = 2; next.style.zIndex = 1;
      while (L.token === token) {
        await playOnce(cur, L.fps, 1); // играет до последнего кадра
        if (L.token !== token) break;
        next.style.zIndex = 2; cur.style.zIndex = 1; // второй элемент (кадр 0, пауза) выходит наверх
        [cur, next] = [next, cur];
        next._want = false; next.pause(); next.currentTime = 0; // первый перематывается под ним
      }
    })();
  }
  // Разовый ролик остановки (once, логотип): с начала, один раз, затем остаётся последний кадр
  function playHold(L) {
    const v = L.videos[0];
    v.loop = false; v._rate = 1; v.playbackRate = state.slow;
    play(v);
  }
  function stopLoop(L) {
    L.token = null;
    if (L.kb) { L.kb.cancel(); L.kb = null; }
    for (const v of L.videos) { v._want = false; v.pause(); v.currentTime = 0; }
  }
  // waitLoopEnd: дождаться последнего кадра текущей итерации цикла, но не дольше maxWait
  function loopEnd(L, maxWait) {
    const v = L.videos.find(x => !x.paused);
    if (!v) return Promise.resolve();
    return new Promise(res => {
      const t = setTimeout(() => { stop(); res(); }, maxWait * 1000);
      const stop = watchEnd(v, L.fps, () => { clearTimeout(t); res(); });
    });
  }

  // ---------- переходы ----------
  function plan(from, to, hops) {
    const steps = [];
    let prevEdge = null;
    hops.forEach((h, i) => {
      const rate = i === hops.length - 1 ? 1 : D.transitSpeed;
      if (h.edge) {
        steps.push({ L: layer('edge:' + h.edge), edge: h.edge, rate, once: true, join: prevEdge ? transitJoin(prevEdge, h.edge) : startJoin(h.edge), wait: !prevEdge && i === 0 });
        prevEdge = h.edge;
      } else {
        steps.push({ L: stopLayer(h.to), rate, join: h.join || stubJoin(h.from, h.to) });
        prevEdge = null;
      }
    });
    if (prevEdge) steps.push({ L: stopLayer(to), rate: 1, join: endJoin(prevEdge) });
    return steps;
  }

  async function go(to, hops) {
    if (state.busy || (!hops && to === state.current)) return false;
    state.busy = true;
    const from = state.current;
    try {
      if (!hops) hops = reduced.matches ? [{ from, to, edge: null, join: { type: 'crossfade', dur: 0.8 } }] : path(from, to);
      state.target = to; state.path = hops;
      const steps = plan(from, to, hops);
      steps.forEach(s => readyLayer(s.L)); // грузим весь путь заранее, параллельно
      let cur = stopLayer(from);
      for (const s of steps) {
        if (s.once && !(await readyLayer(s.L))) { // видео не загрузилось — не ломаем тур, растворяемся в цель
          const T = stopLayer(to);
          T.el.style.zIndex = ++z; startLoop(T);
          await join({ type: 'fade', dur: D.stubDuration }, cur, T, 1);
          hide(cur); cur = T;
          break;
        }
        if (s.wait && cfg(s.edge).waitLoopEnd) await loopEnd(cur, cfg(s.edge).maxWait);
        state.segment = s;
        s.L.el.style.zIndex = ++z;
        const ended = s.once ? playOnce(s.L.el, s.L.fps, s.rate) : (startLoop(s.L), null);
        await join(s.join, cur, s.L, s.rate);
        if (cur !== s.L) hide(cur);
        cur = s.L;
        if (ended) await ended;
      }
      state.current = to;
      if (cur.kind !== 'stop' || cur.id !== to) { const T = stopLayer(to); T.el.style.zIndex = ++z; T.el.style.opacity = 1; startLoop(T); hide(cur); }
      const T = stopLayer(to);
      if (T.once) playHold(T); // переход закончился — логотип играет целиком, а не под растворением
    } finally {
      state.busy = false; state.target = null; state.segment = null;
    }
    keep(to);
    return true;
  }

  // Мгновенный показ остановки (старт, переход по hash). Постер виден сразу, цикл — когда загрузится.
  async function show(id) {
    const L = stopLayer(id);
    L.el.style.zIndex = ++z; L.el.style.opacity = 1;
    for (const o of layers.values()) if (o !== L) hide(o);
    state.current = id;
    const ok = await readyLayer(L);
    if (state.current === id) startLoop(L);
    keep(id);
    return ok;
  }

  // Предзагрузка: текущий цикл + пролёты к соседям по туру + циклы соседей. Остальное выгружаем.
  function keep(id) {
    const want = new Set(['stop:' + id]);
    const i = C.tour.indexOf(id);
    for (const n of [C.tour[i - 1], C.tour[i + 1]]) {
      if (!n) continue;
      want.add('stop:' + n);
      for (const h of path(id, n)) if (h.edge) want.add('edge:' + h.edge);
    }
    for (const L of [...layers.values()]) if (!want.has(L.k)) dispose(L);
    for (const k of want) { const L = layer(k); if (k !== 'stop:' + id) readyLayer(L); }
  }

  function setSlow(f) {
    state.slow = f;
    for (const L of layers.values()) for (const v of L.videos) v.playbackRate = (v._rate || 1) * f;
  }

  const P = window.Player = {
    state, layers, path, show, go, setSlow,
    onblocked: null,
    init(el) {
      stage = el;
      fx = div('fx-light');
      stage.append(fx);
      graph();
    },
    unblock() {
      state.blocked = false;
      release(); resetBlock();
    },
    missing: () => graph() && state.missing,
  };
})();
