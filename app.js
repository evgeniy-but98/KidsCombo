// Навигация, UI, текст слайдов, аудио. Видео целиком на player.js.
(function () {
  const C = window.CONFIG, P = window.Player, tour = C.tour;
  const $ = s => document.querySelector(s);
  const sleep = s => new Promise(r => setTimeout(r, s * 1000));
  const idx = id => tour.indexOf(id);
  const COVER = tour[0];

  const nav = { busy: false, dir: 0, queued: 0, cooldownUntil: 0 };
  let current = null;

  // ---------- переходы ----------
  // hops — готовый путь (отладка: проиграть конкретный сегмент); без него путь ищет плеер
  async function goTo(id, hops) {
    if (!id || (id === current && !hops) || nav.busy) return;
    nav.busy = true;
    document.body.classList.add('is-moving');
    nav.dir = Math.sign(idx(id) - idx(current));
    if (current === COVER) music.want(true); // двери открываются — синхронно, пока жива активация клика
    if (id === COVER) music.want(false);     // возврат на обложку — затихание
    await hideText();
    await P.go(id, hops);
    arrive(id);
    document.body.classList.remove('is-moving');
    nav.busy = false;
    nav.cooldownUntil = performance.now() + 400;
    const q = nav.queued;
    nav.queued = 0;
    if (q) step(q); else showTextLater(id); // в очереди следующий шаг — текст не мелькает
  }
  // Шаг по туру. Во время пролёта: в ту же сторону — в очередь (одна), в обратную — игнор.
  function step(dir) {
    if (nav.busy) { if (dir === nav.dir) nav.queued = dir; return; }
    goTo(tour[idx(current) + dir]);
  }
  // Мгновенно, без пролётов (отладка)
  async function jump(id) {
    if (nav.busy) return;
    await hideText();
    await P.show(id);
    arrive(id);
    showTextLater(id);
  }
  function arrive(id) {
    current = id;
    history.replaceState(null, '', '#' + id);
    updateUI();
  }

  // ---------- UI ----------
  const prev = $('.nav__prev'), next = $('.nav__next'), dots = $('.nav__dots'), count = $('.nav__count');
  const pad = n => String(n).padStart(2, '0');
  // История ролика (до логотипа) и режиссёрские решения после неё считаются отдельно
  const isSection = id => !!(C.stops[id] || {}).section;
  const story = tour.filter(id => !isSection(id)), decisions = tour.filter(isSection);
  tour.forEach((id, i) => {
    const c = (C.stops[id] || {}).content || {}, name = c.title || c.label || c.kicker || id;
    const li = document.createElement('li');
    if (isSection(id)) li.className = 'nav__item--section'; // разделы тритмента после истории
    const b = document.createElement('button');
    b.className = 'nav__dot';
    b.setAttribute('aria-label', isSection(id) ? `Решение ${decisions.indexOf(id) + 1} — ${name}` : `${pad(story.indexOf(id) + 1)} — ${name}`);
    b.title = name;
    b.addEventListener('click', () => goTo(id));
    li.append(b);
    dots.append(li);
  });
  function updateUI() {
    const i = idx(current);
    prev.hidden = i <= 0;
    next.hidden = i >= tour.length - 1;
    count.textContent = isSection(current)
      ? `Решения ${decisions.indexOf(current) + 1}/${decisions.length}`
      : `${pad(story.indexOf(current) + 1)} / ${pad(story.length)}`;
    // конец истории (логотип): «Вперёд» с подписью ведёт к разбору, сам кадр остаётся чистым
    const bridge = !isSection(current) && isSection(tour[i + 1]);
    next.classList.toggle('nav__next--bridge', bridge);
    next.setAttribute('aria-label', bridge ? 'Режиссёрские решения' : 'Вперёд');
    dots.querySelectorAll('.nav__dot').forEach((b, j) => b.toggleAttribute('aria-current', j === i));
    document.body.dataset.slide = current;
    const mf = (C.stops[current] || {}).mobileFrame || {}; // кадр целиком на узком экране
    document.body.dataset.fit = mf.fit || '';
    document.body.dataset.frame = mf.frame || '';
    document.body.dataset.fitAll = ((C.stops[current] || {}).frame || {}).fit || ''; // кадр целиком на любом экране
    document.body.classList.toggle('on-cover', current === COVER);
  }
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  $('.open').addEventListener('click', () => step(1));

  // ---------- музыка ----------
  // Стартует при открытии дверей с fade-in. Колесо не считается активацией: если play() отклонён,
  // музыка запустится на первый клик/клавишу. Нет файла — кнопка звука скрыта, всё работает молча.
  const muteBtn = $('.mute');
  const music = (() => {
    const src = (window.MANIFEST || {}).music;
    const cfg = Object.assign({ volume: 0.5, fadeIn: 2.5, fadeOut: 1.2 }, C.music);
    if (!src) return { want() {}, unlock() {}, toggle() {} };
    const a = new Audio(src);
    a.loop = true; a.preload = 'auto'; a.volume = 0;
    a.addEventListener('error', () => { muteBtn.hidden = true; });
    muteBtn.hidden = false;
    let wanted = false, muted = false, raf = 0, armed = false;
    function fade(to, secs, done) { // ponytail: громкость через a.volume; на iOS она только для чтения — там без фейдов
      cancelAnimationFrame(raf);
      const from = a.volume, t0 = performance.now();
      const tick = now => {
        const k = Math.min(1, Math.max(0, (now - t0) / (secs * 1000))); // метка rAF бывает раньше t0
        a.volume = from + (to - from) * k * (2 - k); // ease-out
        if (k < 1) raf = requestAnimationFrame(tick); else if (done) done();
      };
      raf = requestAnimationFrame(tick);
    }
    function apply() {
      if (!wanted || muted) return fade(0, cfg.fadeOut, () => a.pause());
      if (a.paused) a.play().then(() => fade(cfg.volume, cfg.fadeIn), arm);
      else fade(cfg.volume, cfg.fadeIn);
    }
    const acts = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
    function arm() {
      if (armed) return;
      armed = true;
      const go = () => { armed = false; acts.forEach(e => removeEventListener(e, go, true)); apply(); };
      acts.forEach(e => addEventListener(e, go, true));
    }
    return {
      audio: a,
      want(on) { wanted = on; apply(); },
      unlock() { if (a.paused && !wanted) a.play().then(() => { if (!wanted) a.pause(); }, () => {}); },
      toggle() { muted = !muted; muteBtn.setAttribute('aria-pressed', muted); apply(); },
    };
  })();
  muteBtn.addEventListener('click', () => music.toggle());
  // любой клик на обложке заранее «разблокирует» аудио (play → сразу pause)
  addEventListener('pointerdown', () => { if (current === COVER) music.unlock(); });

  // ---------- текст слайдов ----------
  // Шаблоны: title | text | text-image | gallery | palette | quote | video; none — без оверлея.
  // Всё через textContent; отсутствующие поля не рендерятся.
  const overlay = $('#overlay');
  let shown = null;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text).replace(/ ([—–]) /g, "\u00a0$1 "); // тире не начинает строку
    return e;
  }
  const list = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
  function figure(img, fallbackCaption, tag = 'figure') {
    const it = typeof img === 'string' ? { src: img } : img || {};
    const f = el(tag, 'media'), frame = el('div', 'media__frame');
    if (it.src) {
      const im = el('img');
      im.alt = it.caption || '';
      im.decoding = 'async';
      im.onerror = () => { im.remove(); frame.classList.add('is-empty'); };
      im.src = it.src;
      frame.append(im);
    } else frame.classList.add('is-empty');
    f.append(frame);
    const cap = it.caption || fallbackCaption;
    if (cap) f.append(el(tag === 'figure' ? 'figcaption' : 'div', 'media__caption', cap));
    return f;
  }
  function player(c) {
    const box = el('div', 'player'), v = el('video'), b = el('button', 'player__play');
    v.preload = 'none'; v.playsInline = true; v.src = c.video;
    if (c.poster) v.poster = c.poster;
    b.type = 'button';
    b.setAttribute('aria-label', 'Смотреть');
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15L19.5 12z"/></svg>';
    b.addEventListener('click', () => { v.controls = true; v.play(); });
    // пока играет аниматик со своим звуком, фоновая музыка молчит
    v.addEventListener('play', () => { box.classList.add('is-playing'); music.want(false); });
    v.addEventListener('pause', () => { if (!nav.busy && current !== COVER) music.want(true); });
    v.addEventListener('ended', () => { box.classList.remove('is-playing'); v.controls = false; });
    box.append(v, b);
    return box;
  }
  // Палитра — ориентиры по цвету: образец и название. Точные HEX остаются в config.js, в интерфейс не выводятся.
  function palette(colors, cls) {
    const ul = el('ul', cls);
    list(colors).forEach(col => {
      const li = el('li', 'swatch'), chip = el('span', 'swatch__chip');
      chip.style.background = col.hex;
      li.append(chip);
      if (col.name) li.append(el('span', 'swatch__name', col.name));
      ul.append(li);
    });
    return ul;
  }
  // Раскрываемый блок под текстом плашки (палитра «Свет и цвет»); на телефоне — отдельная область под заголовком
  function more(m, sec) {
    const d = el('details', 'slide__more');
    d.append(el('summary', null, m.title), palette(m.colors, 'palette palette--compact'));
    d.addEventListener('toggle', () => { if (d.open && sec.classList.contains('is-open')) setOpen(sec, false); });
    return d;
  }
  // Свёрнутая плашка на телефоне: заголовок + «Читать», текст раскрывается по нажатию.
  // Текст и палитра на телефоне не раскрываются одновременно — иначе вместе закроют лицо.
  function setOpen(sec, on) {
    sec.classList.toggle('is-open', on);
    const b = sec.querySelector('.slide__open');
    b.setAttribute('aria-expanded', on);
    b.textContent = on ? 'Свернуть' : 'Читать';
    const d = sec.querySelector('.slide__more');
    if (on && d && d.open) d.open = false;
  }
  function opener(sec) {
    const b = el('button', 'slide__open', 'Читать');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => setOpen(sec, !sec.classList.contains('is-open')));
    return b;
  }
  function render(c) {
    const sec = el('section', 'slide'), block = el('div', 'slide__block'), parts = [];
    sec.dataset.layout = c.layout;
    sec.dataset.side = c.side || 'left';
    sec.dataset.theme = c.theme || 'dark';
    if (c.size) sec.dataset.size = c.size;
    if (c.scrim === false) sec.dataset.scrim = 'off';
    if (c.wide) sec.dataset.wide = '';
    if (c.box) { // место в долях видеокадра, см. style.css (#overlay --fw/--fh)
      sec.dataset.box = c.box.y == null ? 'bottom' : 'top';
      sec.dataset.mobile = c.mobile || 'top';
      sec.style.setProperty('--bx', c.box.x);
      sec.style.setProperty('--bw', c.box.w);
      if (c.box.max) sec.style.setProperty('--bmax', c.box.max + 'rem');
      if (c.box.avoid) sec.dataset.avoid = c.box.avoid; // не под кнопки справа вверху
      if (c.box.y != null) sec.style.setProperty('--by', c.box.y);
    }
    const texts = () => list(c.text).forEach(t => parts.push(el('p', 'slide__text', t)));
    if (c.kicker) parts.push(el('p', 'slide__kicker', c.kicker));
    if (c.title && c.layout !== 'quote') parts.push(el(c.layout === 'title' ? 'h1' : 'h2', 'slide__title', c.title));
    if (c.box && (c.text || c.more)) parts.push(opener(sec));
    switch (c.layout) {
      case 'title':
        if (c.text) parts.push(el('p', 'slide__lead', list(c.text).join(' ')));
        break;
      case 'quote':
        if (c.text) parts.push(el('blockquote', 'slide__quote', list(c.text).join(' ')));
        if (c.caption) parts.push(el('p', 'slide__cite', c.caption));
        break;
      case 'text-image':
        texts();
        if (list(c.images).length) parts.push(figure(list(c.images)[0], c.caption));
        break;
      case 'gallery': {
        texts();
        const imgs = list(c.images).slice(0, 6), g = el('ul', 'gallery');
        const cols = c.cols || (imgs.length <= 3 ? imgs.length : imgs.length === 4 ? 2 : 3);
        g.style.setProperty('--cols', cols);
        g.style.setProperty('--rows', Math.ceil(imgs.length / cols));
        if (c.flow) g.dataset.flow = ''; // последовательность: стрелки между кадрами
        imgs.forEach(im => g.append(figure(im, null, 'li')));
        parts.push(g);
        list(c.caption).forEach(t => parts.push(el('p', 'media__caption', t)));
        break;
      }
      case 'timeline': { // хронометраж: ширина отрезка пропорциональна длительности
        texts();
        const segs = list(c.timeline), total = segs.reduce((a, s) => a + s.t, 0), secs = t => String(t).replace('.', ',') + ' с';
        const wrap = el('div', 'timeline'), ol = el('ol', 'timeline__track'), scale = el('div', 'timeline__scale');
        segs.forEach(s => {
          const li = el('li', 'timeline__seg'), bar = el('span', 'timeline__bar');
          li.style.setProperty('--t', s.t);
          if (s.poster) bar.style.backgroundImage = `url("${s.poster}")`;
          if (s.zoom) bar.style.backgroundSize = `${s.zoom * 100}% auto`;
          if (s.background) bar.style.backgroundColor = s.background;
          li.append(bar, el('span', 'timeline__time', secs(s.t)), el('span', 'timeline__label', s.label), el('span', 'timeline__len'));
          ol.append(li);
        });
        for (let t = 0; t <= total + 1e-9; t += 5) { // засечки каждые 5 секунд
          const tick = el('span', 'timeline__tick', t === 0 || t >= total - 1e-9 ? secs(t) : String(t));
          tick.style.setProperty('--at', (t / total * 100) + '%');
          scale.append(tick);
        }
        wrap.append(ol, scale);
        parts.push(wrap);
        if (c.notes) {
          const dl = el('dl', 'notes');
          list(c.notes).forEach(n => { const d = el('div', 'notes__item'); d.append(el('dt', null, n.term), el('dd', null, n.text)); dl.append(d); });
          parts.push(dl);
        }
        list(c.caption).forEach(t => parts.push(el('p', 'media__caption', t)));
        break;
      }
      case 'palette':
        texts();
        parts.push(palette(c.colors, 'palette'));
        break;
      case 'video':
        texts();
        if (c.video) parts.push(player(c));
        if (c.caption) parts.push(el('p', 'media__caption', c.caption));
        break;
      default:
        texts();
    }
    if (c.more) parts.push(more(c.more, sec));
    parts.forEach((p, i) => { p.style.setProperty('--i', i); block.append(p); });
    sec.append(el('div', 'slide__scrim'), block);
    return sec;
  }
  // Текст показывается один раз на приход к остановке (повтор цикла видео его не трогает);
  // зритель может скрыть его кнопкой или клавишей T — тогда он не появляется и на следующих остановках.
  let textOn = true, textTimer = 0;
  function showText(id) {
    const c = (C.stops[id] || {}).content;
    if (!textOn || shown || !c || !c.layout || c.layout === 'none') return;
    const s = shown = render(c);
    overlay.append(s);
    void s.offsetWidth; // стартовые стили применены — дальше идут transition
    s.classList.add('is-in');
  }
  // Сначала чистый кадр: текст проявляется через textDelay (~1.5 с) после прихода
  function showTextLater(id) {
    clearTimeout(textTimer);
    const c = (C.stops[id] || {}).content || {};
    const d = c.textDelay != null ? c.textDelay : C.defaults.textDelay != null ? C.defaults.textDelay : 1.5;
    textTimer = setTimeout(() => { if (current === id && !nav.busy) showText(id); }, d * 1000);
  }
  const textBtn = $('.text-toggle');
  function setTextOn(on) {
    textOn = on;
    textBtn.setAttribute('aria-pressed', !on);
    textBtn.setAttribute('aria-label', on ? 'Скрыть текст' : 'Показать текст');
    if (!on) hideText();
    else if (!nav.busy) showText(current);
  }
  textBtn.addEventListener('click', () => setTextOn(!textOn));
  // Текст уходит за textLead (~0.3 с) до начала пролёта
  function hideText() {
    clearTimeout(textTimer);
    const s = shown;
    shown = null;
    if (!s) return Promise.resolve();
    s.classList.add('is-out');
    return sleep(C.defaults.textLead != null ? C.defaults.textLead : 0.3).then(() => s.remove());
  }

  // ---------- ввод ----------
  // Колесо/тачпад. Жест — серия событий без паузы 200 мс; один жест — максимум один шаг.
  // Жест, заставший переход или cooldown, сгорает целиком: инерция тачпада не пролистает лишнего.
  // Плашка раздела со своей прокруткой (маленький экран): пока её есть куда крутить, колесо и свайп листают её, а не сайт.
  const scroller = t => {
    const b = t && t.closest && t.closest('.slide__block');
    return b && /auto|scroll/.test(getComputedStyle(b).overflowY) && b.scrollHeight > b.clientHeight + 1 ? b : null;
  };
  const canScroll = (b, dy) => (dy > 0 ? b.scrollTop + b.clientHeight < b.scrollHeight - 1 : dy < 0 && b.scrollTop > 0);
  let acc = 0, lastWheel = 0, used = false;
  addEventListener('wheel', e => {
    const b = scroller(e.target);
    if (b && Math.abs(e.deltaY) >= Math.abs(e.deltaX) && canScroll(b, e.deltaY)) { lastWheel = performance.now(); used = true; return; }
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 200) { acc = 0; used = false; }
    lastWheel = now;
    if (nav.busy || now < nav.cooldownUntil) { used = true; return; }
    if (used) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    acc += e.deltaMode === 1 ? d * 16 : d;
    if (Math.abs(acc) >= 60) { used = true; step(Math.sign(acc)); }
  }, { passive: false });

  const keys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('video')) return; // клавиши управляют аниматиком
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, summary')) return; // кнопка сама обработает
    if (e.key in keys) { e.preventDefault(); step(e.key === ' ' && e.shiftKey ? -1 : keys[e.key]); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(tour[0]); }
    else if (e.key === 'End') { e.preventDefault(); goTo(tour[tour.length - 1]); }
    else if (e.key === 'Enter' && current === COVER) step(1);
    else if (e.code === 'KeyF') toggleFullscreen();
    else if (e.code === 'KeyM') music.toggle();
    else if (e.code === 'KeyT') setTextOn(!textOn);
  });

  function toggleFullscreen() {
    const d = document;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else { const el = d.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen; if (rq) rq.call(el); }
  }

  // Свайпы: вверх/влево — вперёд, вниз/вправо — назад. Прокрутку и pull-to-refresh глушит CSS (overscroll-behavior).
  let t0 = null;
  addEventListener('touchstart', e => { const t = e.touches[0], b = scroller(e.target); t0 = { x: t.clientX, y: t.clientY, at: performance.now(), b, top: b ? b.scrollTop : 0 }; }, { passive: true });
  addEventListener('touchend', e => {
    if (!t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    const quick = performance.now() - t0.at < 800, scrolled = t0.b && t0.b.scrollTop !== t0.top;
    t0 = null;
    if (scrolled) return; // жест прокрутил плашку раздела — слайд не меняем
    if (!quick || Math.max(Math.abs(dx), Math.abs(dy)) < 50) return;
    step((Math.abs(dx) > Math.abs(dy) ? dx : dy) < 0 ? 1 : -1);
  });

  addEventListener('hashchange', () => { const id = location.hash.slice(1); if (tour.includes(id)) goTo(id); });

  // ---------- старт: слайд из hash, сразу его цикл, без пролётов ----------
  // Экран загрузки ждёт цикл стартового слайда, постеры всех остановок и шрифты; остальное грузится фоном.
  const tap = $('.tap');
  P.onblocked = () => { tap.hidden = false; }; // автоплей запрещён (iOS в энергосбережении)
  tap.addEventListener('click', () => { tap.hidden = true; P.unblock(); });

  P.init($('#stage'));
  const start = tour.includes(location.hash.slice(1)) ? location.hash.slice(1) : COVER;
  P.show(start);
  arrive(start);
  if (start !== COVER) music.want(true); // стартует с первым кликом

  (async function boot() {
    const loader = $('.loader'), bar = $('.loader__bar span'), pct = $('.loader__pct');
    const M = window.MANIFEST || { stops: {} };
    const img = src => new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = src; }); // не decode(): в фоновой вкладке он ждёт видимости
    const tasks = Object.values(M.stops).filter(s => s.poster).map(s => img(s.poster));
    if (document.fonts) tasks.push(document.fonts.load('700 1em "Shantell Sans"', 'Кидз 03'), document.fonts.load('1em Onest', 'Сцена 03'));
    let done = 0;
    tasks.forEach(t => t.then(() => done++, () => done++));
    const v = (P.layers.get('stop:' + start) || { videos: [] }).videos[0];
    const buffered = () => {
      if (!v || v.readyState >= 4) return 1;
      const b = v.buffered;
      return b.length && v.duration ? Math.min(1, b.end(b.length - 1) / v.duration) : 0;
    };
    const t0 = performance.now();
    for (;;) {
      const p = 0.5 * buffered() + 0.5 * (tasks.length ? done / tasks.length : 1);
      bar.style.transform = `scaleX(${p})`;
      pct.textContent = Math.round(p * 100) + '%';
      loader.setAttribute('aria-valuenow', Math.round(p * 100));
      if (p >= 1 || performance.now() - t0 > 15000) break; // ponytail: 15 с — дальше показываем как есть, постер уже на экране
      await sleep(0.1);
    }
    loader.classList.add('is-done');
    await sleep(0.25);
    showTextLater(current);
  })();

  window.App = { goTo, jump, step, nav, music, get current() { return current; } };
})();
