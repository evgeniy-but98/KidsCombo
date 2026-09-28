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
    viewer.close();
    nav.busy = true;
    document.body.classList.add('is-moving');
    nav.dir = Math.sign(idx(id) - idx(current));
    if (current === COVER) music.want(true); // музыка начинается по нажатию «Открыть»
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
  // История ролика (до логотипа) и режиссёрские решения после неё считаются отдельно;
  // завершение тритмента («Спасибо!») — вне обоих счётчиков и без своей точки
  const isSection = id => !!(C.stops[id] || {}).section;
  const isFinale = id => !!(C.stops[id] || {}).finale;
  const story = tour.filter(id => !isSection(id) && !isFinale(id)), decisions = tour.filter(isSection);
  tour.forEach(id => {
    if (isFinale(id)) return;
    const c = (C.stops[id] || {}).content || {}, name = c.title || c.label || c.kicker || id;
    const li = document.createElement('li');
    if (isSection(id)) li.className = 'nav__item--section'; // разделы тритмента после истории
    const b = document.createElement('button');
    b.className = 'nav__dot';
    b.dataset.id = id;
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
    count.textContent = isFinale(current) ? ''
      : isSection(current) ? `Решения ${decisions.indexOf(current) + 1}/${decisions.length}`
      : `${pad(story.indexOf(current) + 1)} / ${pad(story.length)}`;
    // конец истории (логотип): «Вперёд» с подписью ведёт к разбору, сам кадр остаётся чистым
    const bridge = !isSection(current) && isSection(tour[i + 1]);
    next.classList.toggle('nav__next--bridge', bridge);
    next.setAttribute('aria-label', bridge ? 'Режиссёрские решения' : 'Вперёд');
    dots.querySelectorAll('.nav__dot').forEach(b => b.toggleAttribute('aria-current', b.dataset.id === current));
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
  // На обложке музыка включается кнопкой звука или при нажатии «Открыть».
  // Браузер требует действие пользователя для звука; колесо не считается активацией.
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
      if (a.paused) a.play().then(() => { if (wanted && !muted) fade(cfg.volume, cfg.fadeIn); else a.pause(); }, arm);
      else fade(cfg.volume, cfg.fadeIn);
    }
    const acts = ['pointerdown', 'pointerup', 'touchend', 'keydown'];
    function arm() {
      if (armed) return;
      armed = true;
      const go = () => { armed = false; acts.forEach(e => removeEventListener(e, go, true)); apply(); };
      acts.forEach(e => addEventListener(e, go, true));
    }
    function syncButton() {
      const off = muted || !wanted;
      muteBtn.setAttribute('aria-pressed', off);
      muteBtn.setAttribute('aria-label', off ? 'Включить музыку' : 'Выключить музыку');
      muteBtn.title = off ? 'Включить музыку' : 'Выключить музыку';
    }
    syncButton();
    return {
      audio: a,
      want(on) { wanted = on; syncButton(); apply(); },
      toggle() {
        if (!wanted) { wanted = true; muted = false; }
        else muted = !muted;
        syncButton();
        apply();
      },
    };
  })();
  muteBtn.addEventListener('click', () => music.toggle());

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
    d.addEventListener('toggle', () => fit(sec, true)); // плашка остаётся на месте; что не поместилось — прокручивается
    return d;
  }
  // Текст не поместился целиком: видны заголовок и начало, остальное — по «Читать дальше» (прокрутка внутри плашки)
  function setOpen(sec, on) {
    sec.classList.toggle('is-open', on);
    const b = sec.querySelector('.slide__open');
    b.setAttribute('aria-expanded', on);
    b.textContent = on ? 'Свернуть' : 'Читать дальше';
    fit(sec, true);
  }
  function opener(sec) {
    const b = el('button', 'slide__open', 'Читать дальше');
    b.type = 'button';
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => setOpen(sec, !sec.classList.contains('is-open')));
    return b;
  }

  // ---------- мудборд крупно: просмотр поверх сайта ----------
  // Мудборд вписан в экран; нажатие (или + и −) — увеличение: дальше прокрутка, мышью — перетаскивание.
  // «Оригинал» — исходный файл в новой вкладке (на телефоне там работает обычное увеличение пальцами).
  // Esc — закрыть, ← → — другой мудборд. Пока просмотр открыт, клавиши, колесо и свайпы сайт не листают.
  const svgIcon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const viewer = (() => {
    let root, stage, img, title, note, hint, orig, count, prevB, nextB, closeB;
    let items = [], at = 0, from = null, opened = false, zoomed = false, drag = null, moved = false, token = 0;
    const coarse = matchMedia('(pointer: coarse)');
    const hints = () => zoomed ? (coarse.matches ? 'Коснитесь ещё раз, чтобы вписать в экран' : 'Перетащите, чтобы рассмотреть; нажмите ещё раз — вписать в экран')
      : (coarse.matches ? 'Коснитесь, чтобы увеличить' : 'Нажмите, чтобы увеличить');
    function button(cls, label, d) {
      const b = el('button', 'nav__btn ' + cls);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.innerHTML = svgIcon(d);
      return b;
    }
    function build() {
      root = el('div', 'viewer');
      root.hidden = true;
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      const bar = el('div', 'viewer__bar'), head = el('div', 'viewer__head'), foot = el('div', 'viewer__foot');
      title = el('h2', 'viewer__title'); note = el('p', 'viewer__note'); hint = el('p', 'viewer__hint');
      head.append(title, note, hint);
      orig = el('a', 'viewer__orig', 'Оригинал');
      orig.target = '_blank'; orig.rel = 'noopener';
      closeB = button('viewer__close', 'Закрыть', 'M6 6l12 12M18 6L6 18');
      bar.append(head, orig, closeB);
      stage = el('div', 'viewer__stage');
      stage.tabIndex = -1; // нажатие на кадр оставляет фокус внутри просмотра
      img = el('img', 'viewer__img');
      img.alt = ''; img.draggable = false;
      stage.append(img);
      prevB = button('viewer__prev', 'Предыдущий мудборд', 'M15 5l-7 7 7 7');
      nextB = button('viewer__next', 'Следующий мудборд', 'M9 5l7 7-7 7');
      count = el('span', 'viewer__count');
      foot.append(prevB, count, nextB);
      root.append(bar, stage, foot);
      document.body.append(root);
      closeB.addEventListener('click', close);
      prevB.addEventListener('click', () => show(at - 1));
      nextB.addEventListener('click', () => show(at + 1));
      stage.addEventListener('click', e => { if (moved) { moved = false; return; } zoom(!zoomed, e); });
      // мышью увеличенный мудборд перетаскивается; на тач-экране он двигается обычной прокруткой
      stage.addEventListener('pointerdown', e => {
        if (!zoomed || e.pointerType !== 'mouse' || e.button) return;
        drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
        moved = false;
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { moved = true; root.classList.add('is-dragging'); }
        stage.scrollLeft = drag.l - dx;
        stage.scrollTop = drag.t - dy;
      });
      const stop = () => { drag = null; root.classList.remove('is-dragging'); };
      stage.addEventListener('pointerup', stop);
      stage.addEventListener('pointercancel', stop);
      addEventListener('resize', () => { if (opened && !zoomed) img.style.width = fitW() + 'px'; });
    }
    function fitW() { // ширина мудборда, вписанного в область просмотра (без полос прокрутки от увеличенного кадра)
      if (!zoomed) img.style.width = '0px';
      const m = items[at], cs = getComputedStyle(stage);
      const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      return Math.max(1, Math.min(w, h * m.w / m.h));
    }
    // увеличение: не меньше исходного размера и вдвое крупнее вписанного; точка под курсором остаётся на месте
    function zoom(on, e) {
      if (on === zoomed) return;
      const m = items[at], r = img.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      const pt = e && e.clientX != null;
      const px = pt ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0.5;
      const py = pt ? Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) : 0.5;
      const ax = pt ? e.clientX - sr.left : sr.width / 2, ay = pt ? e.clientY - sr.top : sr.height / 2;
      const w = on ? Math.max(m.w, fitW() * 2) : 0;
      zoomed = on;
      root.classList.toggle('is-zoomed', on);
      hint.textContent = hints();
      img.style.width = (on ? w : fitW()) + 'px';
      if (on) { stage.scrollLeft = px * w - ax; stage.scrollTop = py * w * m.h / m.w - ay; }
    }
    function show(i) {
      at = (i + items.length) % items.length;
      const m = items[at], t = ++token;
      title.textContent = m.title;
      orig.href = m.original || m.src;
      orig.setAttribute('aria-label', `${m.title}: исходный файл в новой вкладке`);
      count.textContent = `${at + 1} / ${items.length}`;
      root.classList.toggle('is-single', items.length < 2);
      zoomed = false;
      root.classList.remove('is-zoomed');
      hint.textContent = hints(); // все подписи — до расчёта места под кадр
      img.alt = `${m.title} — мудборд`;
      img.style.aspectRatio = `${m.w} / ${m.h}`;
      img.style.width = fitW() + 'px';
      stage.scrollLeft = stage.scrollTop = 0;
      // сразу уменьшенная копия (уже загружена превью), полная — как только придёт
      img.src = m.preview || m.src;
      if (m.preview && m.preview !== m.src) { const full = new Image(); full.onload = () => { if (t === token) img.src = m.src; }; full.src = m.src; }
    }
    function open(list, i, text, back) {
      if (!root) build();
      items = list; from = back; opened = true;
      note.textContent = text || '';
      root.hidden = false;
      show(i);
      document.body.classList.add('has-viewer');
      requestAnimationFrame(() => root.classList.add('is-in'));
      closeB.focus();
    }
    function close() {
      if (!opened) return;
      opened = false; token++;
      root.classList.remove('is-in');
      root.hidden = true;
      document.body.classList.remove('has-viewer');
      if (from && from.isConnected) from.focus({ preventScroll: true });
    }
    function key(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(at - 1);
      else if (e.key === 'ArrowRight') show(at + 1);
      else if (e.key === '+' || e.key === '=') zoom(true);
      else if (e.key === '-' || e.key === '0') zoom(false);
      else if (e.key === 'Tab') { // фокус остаётся внутри просмотра
        const f = [...root.querySelectorAll('a[href], button')].filter(b => b.offsetParent);
        const k = f.indexOf(document.activeElement);
        f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      } else return;
      e.preventDefault();
    }
    return { open, close, key, get isOpen() { return opened; } };
  })();
  // Превью мудборда в разделе: кадр, название и «открыть»; по нажатию — крупный просмотр
  function mood(items, i, text) {
    const m = items[i], b = el('button', 'mood'), f = el('span', 'mood__frame'), im = el('img'), z = el('span', 'mood__zoom');
    b.type = 'button';
    b.setAttribute('aria-label', `${m.title}: открыть мудборд крупно`);
    im.alt = ''; im.decoding = 'async'; im.src = m.preview || m.src;
    z.innerHTML = svgIcon('M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.2 15.2L20 20M10.5 7.5v6M7.5 10.5h6');
    f.append(im, z);
    b.append(f, el('span', 'mood__title', m.title), el('span', 'mood__hint', 'Мудборд · открыть'));
    b.addEventListener('click', () => viewer.open(items, i, text, b));
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
    sec._c = c;
    if (c.box) sec.dataset.box = ''; // плашка на кадре: место выбирает fit() — см. ниже
    const texts = () => list(c.text).forEach(t => parts.push(el('p', 'slide__text', t)));
    if (c.kicker) parts.push(el('p', 'slide__kicker', c.kicker));
    if (c.title && c.layout !== 'quote') parts.push(el(c.layout === 'title' ? 'h1' : 'h2', 'slide__title', c.title));
    switch (c.layout) {
      case 'title':
        list(c.text).forEach(t => parts.push(el('p', 'slide__lead', t)));
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
        if (c.moodboards) { // мудборды по бокам вводного текста: слева комната, справа ночь (в узком окне — рядом под текстом)
          const ms = list(c.moodboards), row = el('div', 'moods'), head = el('div', 'moods__head');
          head.append(...parts.splice(0));
          row.append(head, ...ms.map((m, i) => mood(ms, i, c.moodNote)));
          parts.push(row);
        }
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
      case 'finale': // завершение: одно слово по центру, подпись — внизу экрана, вне блока
        break;
      default:
        texts();
    }
    if (c.more) parts.push(more(c.more, sec));
    if (c.box && c.text) parts.push(opener(sec)); // видна, только если текст не поместился целиком
    parts.forEach((p, i) => { p.style.setProperty('--i', i); block.append(p); });
    sec.append(el('div', 'slide__scrim'), block);
    if (c.layout === 'finale' && c.caption) sec.append(el('p', 'slide__credit', c.caption));
    return sec;
  }

  // ---------- место и объём плашки на кадре (content.box) ----------
  // Компьютер: из вариантов box берётся первый, где текст целиком помещается и не задевает content.keep
  // (что на кадре нельзя закрывать), кнопки и навигацию. Кадр 16:9 — по cover, в очень широком окне (от 37:20) — целиком.
  // Телефон и узкие окна: кадр — карточкой, плашку рядом с ней ставит CSS. Если текст всё же не помещается —
  // видны заголовок и начало текста (сначала убираются последние абзацы, потом строки), остальное — по «Читать дальше».
  const cardMode = matchMedia('(max-width: 700px), (max-height: 580px), (max-aspect-ratio: 4/3)');
  const wideMode = matchMedia('(min-aspect-ratio: 37/20)');
  const insetProbe = el('div', 'inset-probe'); // отступы от краёв с учётом выреза экрана (--inset-*)
  document.body.append(insetProbe);
  function insets() {
    const s = getComputedStyle(insetProbe);
    return { t: parseFloat(s.paddingTop), r: parseFloat(s.paddingRight), b: parseFloat(s.paddingBottom), l: parseFloat(s.paddingLeft) };
  }
  // кнопки звука и текста справа вверху и навигация внизу — с зазором 8 px
  function uiRects() {
    return ['.mute', '.text-toggle', '.nav'].map(s => $(s))
      .filter(e => e && !e.hidden && e.offsetWidth && getComputedStyle(e).visibility !== 'hidden')
      .map(e => { const b = e.getBoundingClientRect(); return { l: b.left - 8, t: b.top - 8, r: b.right + 8, b: b.bottom + 8, top: b.top < innerHeight / 2 }; });
  }
  function place(sec, c, block, ins, sticky) {
    const W = overlay.clientWidth, H = overlay.clientHeight, st = C.stops[sec._id] || {}, R = 16 / 9;
    const contain = (st.frame || {}).fit === 'contain' || ((st.mobileFrame || {}).fit === 'contain' && wideMode.matches);
    const fw = contain ? Math.min(W, H * R) : Math.max(W, H * R), fh = fw / R, fx = (W - fw) / 2, fy = (H - fh) / 2;
    const pad = c.layout === 'title' ? 12 : 0; // у вступления мягкая подложка выходит за текст
    const keep = Object.values(c.keep || {}).map(([x1, y1, x2, y2]) =>
      ({ l: fx + fw * x1 / 100 - pad, t: fy + fh * y1 / 100 - pad, r: fx + fw * x2 / 100 + pad, b: fy + fh * y2 / 100 + pad }));
    const ui = uiRects(), rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16, minW = 16 * rem;
    const cands = list(c.box);
    const tryBox = i => {
      const b = cands[i], size = b.size || c.size;
      if (size) sec.dataset.size = size; else delete sec.dataset.size;
      const left = Math.max(ins.l, fx + fw * b.x / 100);
      let right = Math.min(b.r != null ? fx + fw * b.r / 100 : left + fw * b.w / 100, left + (b.max || 40) * rem, W - ins.r);
      let top = Math.max(ins.t, fy + fh * (b.y || 0) / 100);
      for (const u of ui) if (u.top && right > u.l && left < u.r && top < u.b) { if (b.avoid === 'left') right = Math.min(right, u.l); else top = u.b; }
      Object.assign(block.style, { left: left + 'px', top: top + 'px', width: right - left + 'px' });
      let limit = H - ins.b, blocked = right - left < minW - 1;
      for (const o of keep.concat(ui)) {
        if (o.r <= left || o.l >= right || o.b <= top) continue; // не под плашкой
        if (o.t <= top) { blocked = true; break; }            // уже у верхнего края плашки — вариант не годится
        limit = Math.min(limit, o.t);
      }
      const room = limit - top - 4;
      return { i, room, spare: room - block.offsetHeight, blocked }; // высота самого текста, без мягкой подложки вступления
    };
    const order = sticky && sec._box != null ? [sec._box] : cands.map((_, i) => i);
    let best = null, last = null;
    for (const i of order) {
      const r = last = tryBox(i);
      if (!r.blocked && r.spare >= 0) { best = r; break; }
      if (!best || (best.blocked && !r.blocked) || (r.blocked === best.blocked && r.spare > best.spare)) best = r;
    }
    if (best !== last) tryBox(best.i);
    sec._box = best.i;
    return best.room;
  }
  function fit(sec, sticky) {
    const c = sec._c, block = sec.querySelector('.slide__block');
    if (!c || !c.box || !sec.isConnected) return;
    sec.classList.remove('is-clamped');
    block.querySelectorAll('.is-cut, .is-hidden').forEach(p => { p.classList.remove('is-cut', 'is-hidden'); p.style.removeProperty('-webkit-line-clamp'); });
    block.style.maxHeight = '';
    const ins = insets(), H = overlay.clientHeight;
    let room;
    if (cardMode.matches) { // рядом с карточкой кадра: место и предельную высоту задаёт CSS
      block.style.left = block.style.top = block.style.width = '';
      if (c.size) sec.dataset.size = c.size; else delete sec.dataset.size;
      room = parseFloat(getComputedStyle(block).maxHeight) || H;
    } else room = place(sec, c, block, ins, sticky);
    if (sec.classList.contains('is-open')) { // раскрыто: весь текст, лишнее прокручивается внутри плашки
      block.style.maxHeight = (cardMode.matches ? room : Math.max(room, H - ins.b - 64 - block.offsetTop)) + 'px';
      return;
    }
    const over = () => (cardMode.matches ? block.scrollHeight : block.offsetHeight) > room + 1; // у карточки высоту ограничивает CSS
    if (!over()) return;
    if (block.querySelector('.slide__more[open]')) { block.style.maxHeight = room + 'px'; return; } // раскрытая палитра
    sec.classList.add('is-clamped');
    const ps = [...block.querySelectorAll('.slide__text, .slide__lead')];
    for (let i = ps.length - 1; i >= 0 && over(); i--) {
      const p = ps[i], lh = parseFloat(getComputedStyle(p).lineHeight) || 24;
      let n = Math.max(1, Math.round(p.offsetHeight / lh));
      p.classList.add('is-cut');
      p.style.webkitLineClamp = n;
      while (n > 1 && over()) p.style.webkitLineClamp = --n;
      if (over()) p.classList.add('is-hidden');
    }
  }
  let fitRaf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(() => { if (shown) fit(shown); }); });
  // Текст показывается один раз на приход к остановке (повтор цикла видео его не трогает);
  // зритель может скрыть его кнопкой или клавишей T — тогда он не появляется и на следующих остановках.
  let textOn = true, textTimer = 0;
  function showText(id) {
    const c = (C.stops[id] || {}).content;
    if (!textOn || shown || !c || !c.layout || c.layout === 'none') return;
    const s = shown = render(c);
    s._id = id;
    overlay.append(s);
    fit(s); // место на кадре и объём текста — до проявления, без скачков
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
    if (viewer.isOpen) return; // в просмотре мудборда колесо двигает увеличенный кадр
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
    if (viewer.isOpen) return viewer.key(e); // открыт мудборд: свои клавиши, сайт не листается
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
  addEventListener('touchstart', e => { if (viewer.isOpen) { t0 = null; return; } const t = e.touches[0], b = scroller(e.target); t0 = { x: t.clientX, y: t.clientY, at: performance.now(), b, top: b ? b.scrollTop : 0 }; }, { passive: true });
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
