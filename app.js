/*
  Новогодняя комната — движок: камера, переходы, навигация, аудио.
  Без модулей и fetch: сайт должен открываться по file://.
*/
(function () {
  "use strict";

  var CFG = window.CONFIG;
  var gsap = window.gsap;
  var SET = Object.assign({
    kenBurns: true, kenBurnsScale: 1.03, kenBurnsDuration: 20,
    musicVolume: 0.5, musicFadeIn: 2.5,
    wheelThreshold: 60, wheelReset: 200, cooldown: 400, effects: true
  }, CFG.settings || {});
  var SLIDES = CFG.slides;
  var N = SLIDES.length;

  // Блок calibration (из режима калибровки) перекрывает координаты в слайдах и двери
  function applyCalibration(cal) {
    if (!cal) return;
    if (cal.cameras) {
      SLIDES.forEach(function (s) {
        var r = cal.cameras[s.id];
        if (r) s.camera = { x: r.x, y: r.y, w: r.w, h: r.h };
      });
    }
    if (cal.door) {
      ["rect", "posterRect", "paperRect", "hinge"].forEach(function (k) {
        if (cal.door[k] != null) CFG.door[k] = cal.door[k];
      });
    }
  }
  applyCalibration(CFG.calibration);

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  /*
    Упрощённый режим: кроссфейды вместо полётов камеры, без эффектов.
    По умолчанию системная настройка «уменьшить движение» НЕ учитывается: движение камеры —
    суть тритмента, а у многих зрителей она включена без их ведома (Windows: выключены
    «Эффекты анимации»; Android: «Удалить анимацию» или режим энергосбережения; iOS: «Уменьшение движения»).
    settings.reducedMotion: "ignore" (по умолчанию) | "respect" — учитывать системную настройку
                            | "always" — всегда упрощённый режим.
    Для проверки можно добавить в адрес ?motion=reduce или ?motion=full.
  */
  var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  var motionParam = null;
  try { motionParam = new URLSearchParams(location.search).get("motion"); } catch (e) {}
  var reducedMotion = {
    get matches() {
      if (motionParam === "reduce") return true;
      if (motionParam === "full") return false;
      if (SET.reducedMotion === "always") return true;
      if (SET.reducedMotion === "respect") return motionQuery.matches;
      return false;
    }
  };

  var el = {
    stage: $("#stage"),
    master: $("#master"),
    doorView: $("#door-view"),
    doorWorld: $("#door-world"),
    corridor: $("#corridor"),
    hinge: $("#door-hinge"),
    leaf: $("#door-leaf"),
    front: $(".door-front"),
    poster: $("#poster"),
    glowIn: $("#door-glow-in"),
    glowOut: $("#door-glow-out"),
    slots: Array.prototype.slice.call(document.querySelectorAll(".closeup")),
    frost: $("#frost"),
    shade: $("#shade"),
    flicker: $("#flicker"),
    snow: $("#snow"),
    content: $("#content"),
    ui: $("#ui"),
    prev: $("#btn-prev"),
    next: $("#btn-next"),
    dots: $("#dots"),
    counterCur: $("#counter-cur"),
    counterTotal: $("#counter-total"),
    mute: $("#btn-mute"),
    toast: $("#toast"),
    loader: $("#loader"),
    loaderFill: $("#loader-fill"),
    loaderPct: $("#loader-pct"),
    audio: $("#music")
  };

  /* ==========================================================================
     Загрузка картинок (с decode, чтобы переход не дёргался на первом кадре)
     ========================================================================== */

  var imageCache = new Map();
  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    var p = new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        var d = img.decode ? img.decode() : Promise.resolve();
        d.catch(function () {}).then(function () { resolve(img); });
      };
      img.onerror = function () { reject(new Error("Не удалось загрузить " + src)); };
      img.src = src;
    });
    imageCache.set(src, p);
    p.catch(function () { imageCache.delete(src); });
    return p;
  }

  // Очередь фоновой подгрузки с ограничением параллельности
  var bgQueue = [];
  var bgActive = 0;
  function enqueue(src, priority) {
    if (imageCache.has(src)) return;
    var item = { src: src, priority: priority || 0 };
    bgQueue.push(item);
    bgQueue.sort(function (a, b) { return b.priority - a.priority; });
    pumpQueue();
  }
  function pumpQueue() {
    while (bgActive < 3 && bgQueue.length) {
      var item = bgQueue.shift();
      if (imageCache.has(item.src)) continue;
      bgActive++;
      loadImage(item.src).catch(function () {}).then(function () { bgActive--; pumpQueue(); });
    }
  }

  function closeupSrc(slug) {
    return (CFG.assets.closeups || "assets/{bg}.webp").replace("{bg}", slug);
  }

  /* ==========================================================================
     Геометрия камеры
     Мир картинки: x ∈ [0, A], y ∈ [0, 1], где A — ширина/высота картинки.
     Вид камеры: { cx, cy, w } — центр и видимая ширина в единицах мира.
     ========================================================================== */

  function viewportAspect() { return window.innerWidth / window.innerHeight; }

  // Прямоугольник {x,y,w,h} (доли картинки) вписывается в окно по принципу cover
  function rectToView(rect, A, V) {
    var rw = rect.w * A, rh = rect.h;
    return { cx: (rect.x + rect.w / 2) * A, cy: rect.y + rect.h / 2, w: Math.min(rw, rh * V) };
  }

  // Не даём камере выйти за края картинки
  function clampView(v, A, V) {
    var w = Math.min(v.w, A, V);
    var h = w / V;
    return { cx: clamp(v.cx, w / 2, A - w / 2), cy: clamp(v.cy, h / 2, 1 - h / 2), w: w };
  }

  function mixView(a, b, t) {
    return {
      cx: lerp(a.cx, b.cx, t),
      cy: lerp(a.cy, b.cy, t),
      w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), t))
    };
  }

  function scaleView(v, f) { return { cx: v.cx, cy: v.cy, w: v.w * f }; }

  function sameView(a, b) {
    return Math.abs(a.cx - b.cx) < 1e-4 && Math.abs(a.cy - b.cy) < 1e-4 && Math.abs(Math.log(a.w / b.w)) < 1e-3;
  }

  /*
    Перелёт по дуге: оптимальный путь «зум + панорама» (van Wijk & Nuij, 2003).
    Чем дальше объекты, тем сильнее камера отъезжает. Для соседних объектов
    добавляется небольшой гарантированный отъезд — ~1.5× площади большей рамки.
  */
  var RHO = 1.25;
  var MIN_ZOOMOUT = Math.sqrt(1.5);
  function zoomPath(v0, v1) {
    var ux0 = v0.cx, uy0 = v0.cy, w0 = v0.w;
    var ux1 = v1.cx, uy1 = v1.cy, w1 = v1.w;
    var dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    var rho2 = RHO * RHO, rho4 = rho2 * rho2;
    var at, S;
    if (d2 < 1e-12) {
      S = Math.log(w1 / w0) / RHO;
      at = function (t) { return [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)]; };
    } else {
      var d1 = Math.sqrt(d2);
      var b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
      var b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
      var r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
      var r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (r1 - r0) / RHO;
      var coshr0 = Math.cosh(r0), sinhr0 = Math.sinh(r0);
      at = function (t) {
        var s = t * S;
        var u = w0 / (rho2 * d1) * (coshr0 * Math.tanh(RHO * s + r0) - sinhr0);
        return [ux0 + u * dx, uy0 + u * dy, w0 * coshr0 / Math.cosh(RHO * s + r0)];
      };
    }
    var peak = 0;
    for (var i = 0; i <= 20; i++) peak = Math.max(peak, at(i / 20)[2]);
    var extra = Math.max(0, Math.log(MIN_ZOOMOUT * Math.max(w0, w1) / peak));
    return {
      S: Math.abs(S),
      at: function (t) {
        var p = at(t);
        return { cx: p[0], cy: p[1], w: p[2] * Math.exp(extra * Math.sin(Math.PI * t)) };
      }
    };
  }

  // Длительность перелёта по длине пути: соседние объекты — короче, дальние — дольше
  function flyDuration(S) { return clamp(1.25 + S * 0.32, 1.4, 2.2); }

  /* ==========================================================================
     Мастер-кадр: canvas + тайлы (deep zoom)
     Всегда рисуется превью (2560 px), поверх — тайлы уровня, которого хватает
     для текущего зума. Недостающие тайлы догружаются по мере надобности.
     ========================================================================== */

  function MasterRenderer(canvas, manifest) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.manifest = manifest || null;
    this.A = manifest ? manifest.width / manifest.height : 16 / 9;
    this.preview = null;
    this.levels = manifest
      ? manifest.levels.slice().sort(function (a, b) { return a.width - b.width; })
          .map(function (l) { return Object.assign({ tiles: new Map() }, l); })
      : [];
    this.view = { cx: this.A / 2, cy: 0.5, w: this.A };
    this.blur = 0;
    this.dirty = true;
    this.V = viewportAspect();
    var self = this;
    gsap.ticker.add(function () { if (self.dirty) self.draw(); });
  }

  MasterRenderer.prototype.resize = function () {
    var cssW = window.innerWidth, cssH = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var maxPx = 3840 * 2160;
    if (cssW * cssH * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (cssW * cssH));
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.V = cssW / cssH;
    this.dirty = true;
  };

  MasterRenderer.prototype.fullView = function () {
    return clampView({ cx: this.A / 2, cy: 0.5, w: Infinity }, this.A, this.V);
  };

  MasterRenderer.prototype.viewFor = function (rect) {
    return clampView(rectToView(rect, this.A, this.V), this.A, this.V);
  };

  MasterRenderer.prototype.setView = function (v) {
    this.view = clampView(v, this.A, this.V);
    this.dirty = true;
  };

  MasterRenderer.prototype.setBlur = function (px) {
    this.blur = px;
    this.canvas.style.filter = px > 0.05 ? "blur(" + px.toFixed(2) + "px)" : "none";
  };

  MasterRenderer.prototype.tweenView = function (from, to, duration, ease) {
    var self = this, p = { t: 0 };
    return gsap.to(p, {
      t: 1, duration: duration, ease: ease || "power2.inOut", immediateRender: false,
      onUpdate: function () { self.setView(mixView(from, to, p.t)); }
    });
  };

  MasterRenderer.prototype.tweenBlur = function (from, to, duration, ease) {
    var self = this, p = { b: from };
    return gsap.to(p, {
      b: to, duration: duration, ease: ease || "power1.inOut", immediateRender: false,
      onStart: function () { self.setBlur(from); },
      onUpdate: function () { self.setBlur(p.b); }
    });
  };

  // Перелёт по дуге. Возвращает { tween, duration } или null, если лететь некуда
  MasterRenderer.prototype.fly = function (from, to) {
    if (sameView(from, to)) return null;
    var self = this, path = zoomPath(from, to), p = { t: 0 };
    var duration = flyDuration(path.S);
    var tween = gsap.to(p, {
      t: 1, duration: duration, ease: "power2.inOut", immediateRender: false,
      onUpdate: function () { self.setView(path.at(p.t)); }
    });
    return { tween: tween, duration: duration, S: path.S };
  };

  // Какой уровень тайлов нужен для плотности k (px холста на единицу мира)
  MasterRenderer.prototype.levelFor = function (k) {
    var prevPU = this.preview ? this.preview.naturalWidth / this.A : 0;
    if (prevPU * 1.2 >= k || !this.levels.length) return -1;
    for (var i = 0; i < this.levels.length; i++) {
      if ((this.levels[i].width / this.A) * 1.2 >= k) return i;
    }
    return this.levels.length - 1;
  };

  MasterRenderer.prototype.visibleTiles = function (li, x0, y0, w, h) {
    var L = this.levels[li], T = this.manifest.tile;
    var sx = L.width / this.A, sy = L.height;
    var c0 = Math.max(0, Math.floor(x0 * sx / T)), c1 = Math.min(L.cols - 1, Math.floor((x0 + w) * sx / T));
    var r0 = Math.max(0, Math.floor(y0 * sy / T)), r1 = Math.min(L.rows - 1, Math.floor((y0 + h) * sy / T));
    var out = [];
    for (var r = r0; r <= r1; r++) {
      for (var c = c0; c <= c1; c++) {
        var tw = Math.min(T, L.width - c * T), th = Math.min(T, L.height - r * T);
        out.push({
          key: c + "_" + r,
          src: L.path.replace("{c}", c).replace("{r}", r),
          x: c * T / sx, y: r * T / sy, w: tw / sx, h: th / sy
        });
      }
    }
    return out;
  };

  MasterRenderer.prototype.requestTile = function (li, t) {
    var L = this.levels[li], self = this;
    if (L.tiles.has(t.key)) return;
    L.tiles.set(t.key, null);
    loadImage(t.src).then(function (img) {
      if (!L.tiles.has(t.key)) return; // успели выгрузить
      L.tiles.set(t.key, img);
      self.touchTile(li, t.key, t.src);
      self.warm(img);
      self.dirty = true;
    }, function () { L.tiles.delete(t.key); });
  };

  /*
    Тайл полного разрешения в памяти — около 16 МБ. На телефонах памяти мало, поэтому
    держим ограниченное число тайлов верхнего уровня: давно не нужные выгружаются
    (видимые сейчас — никогда).
  */
  var TILE_BUDGET = window.matchMedia("(pointer: coarse)").matches ? 8 : 32;
  MasterRenderer.prototype.touchTile = function (li, key, src) {
    if (li !== this.levels.length - 1) return;
    var lru = this.lru || (this.lru = []);
    for (var i = 0; i < lru.length; i++) if (lru[i].key === key) { lru.splice(i, 1); break; }
    lru.push({ key: key, src: src });
    var L = this.levels[li], visible = this.visibleKeys || {};
    for (var j = 0; lru.length > TILE_BUDGET && j < lru.length; ) {
      if (visible[lru[j].key]) { j++; continue; }
      var old = lru.splice(j, 1)[0];
      L.tiles.delete(old.key);
      imageCache.delete(old.src);
    }
  };

  // Загрузить все тайлы уровня
  MasterRenderer.prototype.requestLevel = function (li) {
    var L = this.levels[li];
    if (!L) return;
    this.visibleTiles(li, 0, 0, this.A, 1).forEach(function (t) { this.requestTile(li, t); }, this);
  };

  /*
    Первая отрисовка большой картинки — это загрузка её в видеопамять (десятки мс).
    Делаем это заранее, пока камера стоит, чтобы не было рывка посреди перелёта.
  */
  MasterRenderer.prototype.warm = function (img) {
    this.warmQueue = this.warmQueue || [];
    this.warmQueue.push(img);
    this.flushWarm();
  };
  MasterRenderer.prototype.flushWarm = function () {
    var self = this;
    if (this.warmRaf || !this.warmQueue || !this.warmQueue.length || this.idle === false) return;
    this.warmRaf = requestAnimationFrame(function step() {
      self.warmRaf = 0;
      if (self.idle === false) return;
      var img = self.warmQueue.shift();
      if (!img) return;
      // В натуральном размере: иначе браузер загрузит уменьшенную копию, а не полную текстуру.
      // Альфа 1/255 — на экране не видно; перерисовка — через кадр, чтобы браузер
      // не выкинул эту операцию как перекрытую.
      self.ctx.save();
      self.ctx.globalAlpha = 0.004;
      self.ctx.drawImage(img, 0, 0);
      self.ctx.restore();
      self.warmRaf = requestAnimationFrame(function () {
        self.warmRaf = 0;
        self.dirty = true;
        if (self.warmQueue.length && self.idle !== false) self.warmRaf = requestAnimationFrame(step);
      });
    });
  };
  MasterRenderer.prototype.setIdle = function (idle) {
    this.idle = idle;
    if (idle) this.flushWarm();
  };

  // Подгрузить тайлы, нужные для вида v (для соседних остановок)
  MasterRenderer.prototype.prefetch = function (v) {
    if (!this.levels.length) return;
    var cw = this.canvas.width, vv = clampView(v, this.A, this.V);
    var li = this.levelFor(cw / vv.w);
    if (li < 0) return;
    var h = vv.w / this.V, self = this;
    this.visibleTiles(li, vv.cx - vv.w / 2, vv.cy - h / 2, vv.w, h).forEach(function (t) { self.requestTile(li, t); });
  };

  MasterRenderer.prototype.blit = function (img, iw, ih, r, x0, y0, w, h, k) {
    var ix0 = Math.max(r.x, x0), iy0 = Math.max(r.y, y0);
    var ix1 = Math.min(r.x + r.w, x0 + w), iy1 = Math.min(r.y + r.h, y0 + h);
    if (ix1 <= ix0 || iy1 <= iy0) return;
    var sx = (ix0 - r.x) / r.w * iw, sy = (iy0 - r.y) / r.h * ih;
    var sw = (ix1 - ix0) / r.w * iw, sh = (iy1 - iy0) / r.h * ih;
    var X0 = Math.round((ix0 - x0) * k), Y0 = Math.round((iy0 - y0) * k);
    var X1 = Math.round((ix1 - x0) * k), Y1 = Math.round((iy1 - y0) * k);
    if (X1 - X0 < 1 || Y1 - Y0 < 1) return;
    this.ctx.drawImage(img, sx, sy, sw, sh, X0, Y0, X1 - X0, Y1 - Y0);
  };

  MasterRenderer.prototype.draw = function () {
    this.dirty = false;
    var ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    var v = this.view, w = v.w, h = w / this.V, k = cw / w;
    var x0 = v.cx - w / 2, y0 = v.cy - h / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    var li = this.levelFor(k);
    var tiles = li >= 0 ? this.visibleTiles(li, x0, y0, w, h) : [];
    var L = li >= 0 ? this.levels[li] : null;
    var complete = li >= 0 && tiles.every(function (t) { return L.tiles.get(t.key); });
    var top = li >= 0 && li === this.levels.length - 1;
    var vk = {};
    if (top) tiles.forEach(function (t) { vk[t.key] = 1; });
    this.visibleKeys = vk;

    if (!complete) {
      ctx.fillStyle = "#120b08";
      ctx.fillRect(0, 0, cw, ch);
      if (this.preview) {
        this.blit(this.preview, this.preview.naturalWidth, this.preview.naturalHeight,
          { x: 0, y: 0, w: this.A, h: 1 }, x0, y0, w, h, k);
      }
      // Промежуточный уровень как подстраховка, пока грузятся тайлы нужного
      for (var pi = 0; pi < li; pi++) {
        var PL = this.levels[pi], self = this;
        this.visibleTiles(pi, x0, y0, w, h).forEach(function (t) {
          var img = PL.tiles.get(t.key);
          if (img) self.blit(img, img.naturalWidth, img.naturalHeight, t, x0, y0, w, h, k);
        });
      }
    }
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], img = L.tiles.get(t.key);
      if (img) {
        this.blit(img, img.naturalWidth, img.naturalHeight, t, x0, y0, w, h, k);
        if (top) this.touchTile(li, t.key, t.src);
      } else this.requestTile(li, t);
    }
  };

  /* ==========================================================================
     Дверь: коридор с вырезом, полотно на петлях, свет из проёма
     Мир двери: 1 единица мира = 1000 CSS-пикселей, камера — через transform.
     ========================================================================== */

  var WORLD_PX = 1000;

  function DoorScene(cfg) {
    this.cfg = cfg;
    this.A = 16 / 9;
    this.view = null;
  }

  DoorScene.prototype.setAspect = function (A) { this.A = A; this.layout(); };

  DoorScene.prototype.layout = function () {
    var c = this.cfg, A = this.A, r = c.rect;
    var W = A * WORLD_PX, H = WORLD_PX;
    var pct = function (v) { return (v * 100).toFixed(4) + "%"; };
    el.doorWorld.style.width = W + "px";
    el.doorWorld.style.height = H + "px";

    // Коридор с «отверстием» на месте полотна: внешний контур по часовой, вырез — против.
    // Вырез чуть меньше полотна, чтобы на стыке не просвечивала комната.
    var e = 0.0012;
    var x1 = pct(r.x + e), y1 = pct(r.y + e), x2 = pct(r.x + r.w - e), y2 = pct(r.y + r.h - e);
    var poly = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, " +
      x1 + " " + y1 + ", " + x1 + " " + y2 + ", " + x2 + " " + y2 + ", " + x2 + " " + y1 + ", " + x1 + " " + y1 + ")";
    el.corridor.style.clipPath = poly;
    el.corridor.style.webkitClipPath = poly;

    // Полотно двери: тот же door.webp, показан только прямоугольник rect
    var hs = el.hinge.style;
    hs.left = pct(r.x); hs.top = pct(r.y); hs.width = pct(r.w); hs.height = pct(r.h);
    hs.perspective = (r.w * W * 2.6).toFixed(0) + "px";
    hs.perspectiveOrigin = "50% 45%";
    el.leaf.style.transformOrigin = (c.hinge === "right" ? "100%" : "0%") + " 50%";
    var fs = el.front.style;
    fs.backgroundSize = (100 / r.w).toFixed(4) + "% " + (100 / r.h).toFixed(4) + "%";
    fs.backgroundPosition = (r.x / (1 - r.w) * 100).toFixed(4) + "% " + (r.y / (1 - r.h) * 100).toFixed(4) + "%";

    // Лист плаката (область под текст) — относительно полотна
    var p = c.paperRect || {
      x: c.posterRect.x + c.posterRect.w * 0.3, y: c.posterRect.y + c.posterRect.h * 0.08,
      w: c.posterRect.w * 0.4, h: c.posterRect.h * 0.84
    };
    var ps = el.poster.style;
    ps.left = pct((p.x - r.x) / r.w); ps.top = pct((p.y - r.y) / r.h);
    ps.width = pct(p.w / r.w); ps.height = pct(p.h / r.h);

    // Тёплый свет: внутри проёма (под коридором) и на полу перед дверью (над коридором)
    var gi = el.glowIn.style;
    gi.left = pct(r.x); gi.top = pct(r.y); gi.width = pct(r.w); gi.height = pct(r.h);
    gi.background = "radial-gradient(ellipse 90% 70% at 50% 75%, rgba(255,196,120,0.3), rgba(255,160,80,0.08) 60%, rgba(255,150,70,0) 100%)";
    var go = el.glowOut.style;
    go.left = pct(r.x - r.w * 0.9); go.top = pct(r.y + r.h * 0.35);
    go.width = pct(r.w * 2.8); go.height = pct(r.h * 0.95);
    go.background =
      "radial-gradient(ellipse 50% 42% at 50% 72%, rgba(255,190,110,0.5), rgba(255,170,90,0.14) 60%, rgba(255,170,90,0) 100%)," +
      "radial-gradient(ellipse 22% 60% at 50% 40%, rgba(255,200,130,0.28), rgba(255,200,130,0) 100%)";
  };

  DoorScene.prototype.viewFor = function (rect) {
    var V = viewportAspect();
    return clampView(rectToView(rect, this.A, V), this.A, V);
  };
  DoorScene.prototype.views = function () {
    return {
      poster: this.viewFor(this.cfg.posterRect),
      full: this.viewFor({ x: 0, y: 0, w: 1, h: 1 }),
      deep: scaleView(this.viewFor(this.cfg.rect), 0.78)
    };
  };

  DoorScene.prototype.setView = function (v) {
    this.view = v;
    var vw = window.innerWidth, V = viewportAspect();
    var k = vw / v.w, h = v.w / V;
    var tx = -(v.cx - v.w / 2) * k, ty = -(v.cy - h / 2) * k;
    el.doorWorld.style.transform = "translate3d(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px,0) scale(" + (k / WORLD_PX).toFixed(6) + ")";
  };

  DoorScene.prototype.tweenView = function (from, to, duration, ease) {
    var self = this, p = { t: 0 };
    return gsap.to(p, {
      t: 1, duration: duration, ease: ease || "power2.inOut", immediateRender: false,
      onUpdate: function () { self.setView(mixView(from, to, p.t)); }
    });
  };

  DoorScene.prototype.renderPoster = function () {
    var c = this.cfg.content || {};
    el.poster.textContent = "";
    var inner = mk("div", "poster-inner");
    if (c.kicker) inner.append(mk("div", "poster-kicker", c.kicker));
    inner.append(mk("h1", "poster-title", c.title || CFG.title || ""));
    if (c.subtitle) inner.append(mk("div", "poster-sub", c.subtitle));
    var btn = mk("button", "poster-btn", c.button || "Открыть");
    btn.type = "button";
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      audio.unlock();
      nav.go(nav.index + 1);
    });
    inner.append(btn);
    inner.append(mk("div", "poster-hint", c.hint || "или колесо мыши, → или свайп"));
    el.poster.append(inner);
  };

  DoorScene.prototype.reset = function () {
    gsap.set(el.leaf, { rotationY: 0 });
    gsap.set([el.glowIn, el.glowOut], { opacity: 0 });
    gsap.set(el.doorWorld, { opacity: 1 });
    gsap.set(el.poster, { opacity: 1 });
    el.doorView.style.visibility = "visible";
  };

  /* ==========================================================================
     Крупные планы: два слота, чередуются
     ========================================================================== */

  var closeups = {
    current: -1,   // индекс видимого слота
    kb: null,
    slot: function (i) { return { el: el.slots[i], img: el.slots[i].querySelector("img") }; },
    // Подготовить свободный слот под slug, вернуть его
    prepare: function (slug) {
      var i = this.current === 0 ? 1 : 0;
      var s = this.slot(i);
      if (s.img.getAttribute("src") !== closeupSrc(slug)) s.img.src = closeupSrc(slug);
      gsap.set(s.img, { scale: fx.baseScale(), x: 0, y: 0 });
      gsap.set(s.el, { opacity: 0, scale: 1, filter: "blur(0px)" });
      return { index: i, el: s.el, img: s.img };
    },
    activate: function (i) {
      this.current = i;
      var other = this.slot(i === 0 ? 1 : 0);
      gsap.set(other.el, { opacity: 0 });
    },
    active: function () { return this.current >= 0 ? this.slot(this.current) : null; },
    hideAll: function () {
      this.stopKenBurns();
      el.slots.forEach(function (s) { gsap.set(s, { opacity: 0 }); });
      this.current = -1;
    },
    startKenBurns: function () {
      this.stopKenBurns();
      var s = this.active();
      if (!s) return;
      var base = fx.baseScale();
      if (!SET.kenBurns || reducedMotion.matches) {
        gsap.to(s.img, { scale: base, duration: 1.2, ease: "power1.out" });
        return;
      }
      this.kb = gsap.fromTo(s.img, { scale: gsap.getProperty(s.img, "scale") }, {
        scale: base * SET.kenBurnsScale, duration: SET.kenBurnsDuration, ease: "sine.inOut", yoyo: true, repeat: -1
      });
    },
    stopKenBurns: function () {
      if (this.kb) { this.kb.kill(); this.kb = null; }
    }
  };

  /* ==========================================================================
     Контент слайда: шаблоны раскладки
     ========================================================================== */

  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function paragraphs(text) {
    if (!text) return [];
    if (Array.isArray(text)) return text;
    return String(text).split(/\n\s*\n/);
  }

  function imageItem(item) {
    if (item == null) return { src: "", caption: "" };
    if (typeof item === "string") return { src: item, caption: "" };
    return { src: item.src || "", caption: item.caption || "" };
  }

  function figure(item, caption) {
    var it = imageItem(item);
    var f = mk("figure", "media anim");
    if (it.src) {
      var img = mk("img");
      img.src = it.src; img.alt = it.caption || caption || ""; img.decoding = "async"; img.draggable = false;
      f.append(img);
    } else {
      f.append(mk("div", "ph"));
    }
    var cap = it.caption || caption;
    if (cap) f.append(mk("figcaption", null, cap));
    return f;
  }

  function renderSlide(slide) {
    var c = slide.content || {};
    var tpl = c.layout || "text";
    var root = mk("div", [
      "slide", "tpl-" + tpl, "pos-" + (slide.layout || "center"), "theme-" + (slide.theme || "dark"),
      c.side ? "side-" + c.side : "", slide.backdrop === "strong" ? "backdrop-strong" : ""
    ].join(" ").trim());
    var block = mk("div", "block");
    root.append(block);

    var col = block;
    if (tpl === "text-image") { col = mk("div", "col"); block.append(col); }

    if (c.kicker) col.append(mk("div", "kicker anim", c.kicker));
    if (c.title) col.append(mk(tpl === "title" ? "h1" : "h2", "title anim", c.title));
    if (c.subtitle) col.append(mk("p", "subtitle anim", c.subtitle));

    if (tpl === "quote" && c.quote) {
      col.append(mk("span", "quote-mark anim"));
      col.append(mk("blockquote", "quote anim", c.quote));
      if (c.author) col.append(mk("div", "quote-author anim", c.author));
    }

    var ps = paragraphs(c.text);
    if (ps.length) {
      var t = mk("div", "text");
      ps.forEach(function (p) { t.append(mk("p", "anim", p)); });
      col.append(t);
    }

    if (tpl === "text-image") {
      block.append(figure((c.images || [""])[0], c.caption));
    }

    if (tpl === "gallery") {
      var items = (c.images || []).slice(0, 6);
      var g = mk("div", "gallery");
      var cols = items.length <= 4 ? Math.max(items.length, 1) : 3;
      g.style.setProperty("--cols", cols);
      items.forEach(function (it) { g.append(figure(it)); });
      col.append(g);
    }

    if (tpl === "palette") {
      var pal = mk("div", "palette");
      (c.colors || []).forEach(function (cl) {
        var item = typeof cl === "string" ? { hex: cl } : cl;
        var sw = mk("div", "swatch anim");
        var chip = mk("div", "swatch-chip");
        chip.style.background = item.hex;
        sw.append(chip);
        if (item.name) sw.append(mk("div", "swatch-name", item.name));
        sw.append(mk("div", "swatch-hex", (item.hex || "").toUpperCase()));
        pal.append(sw);
      });
      col.append(pal);
    }

    if (tpl === "video") {
      var box = mk("div", "video-box anim");
      if (c.video) {
        var v = mk("video");
        v.src = c.video; v.preload = "metadata"; v.playsInline = true;
        if (c.poster) v.poster = c.poster;
        box.append(v);
      } else {
        box.append(mk("div", "ph"));
      }
      var play = mk("button", "play-btn");
      play.type = "button";
      play.setAttribute("aria-label", "Смотреть видео");
      play.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
      play.addEventListener("click", function (e) {
        e.stopPropagation();
        var vid = box.querySelector("video");
        if (!vid) { toast("Видео пока не добавлено"); return; }
        audio.duck(true);
        vid.controls = true;
        vid.play();
        box.classList.add("playing");
        vid.onpause = vid.onended = function () { audio.duck(false); };
        vid.onplay = function () { audio.duck(true); };
      });
      box.append(play);
      if (c.caption) box.append(mk("div", "caption", c.caption));
      col.append(box);
    }

    if (tpl !== "text-image" && tpl !== "video" && c.caption) col.append(mk("div", "caption anim", c.caption));
    return root;
  }

  var content = {
    current: null,
    show: function (slide, animate) {
      this.clear();
      if (!slide || !slide.content) return;
      var node = renderSlide(slide);
      el.content.append(node);
      this.current = node;
      var items = node.querySelectorAll(".anim");
      if (animate && !reducedMotion.matches) {
        gsap.fromTo(items, { opacity: 0, y: 16 }, {
          opacity: 1, y: 0, duration: 0.7, stagger: 0.08, ease: "power2.out", clearProps: "transform"
        });
      } else if (animate) {
        gsap.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.5 });
      }
    },
    clear: function () {
      var vids = el.content.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) vids[i].pause();
      el.content.textContent = "";
      this.current = null;
    },
    // добавить в таймлайн уход текста
    out: function (tl, at) {
      var node = this.current;
      if (!node) return;
      var vids = node.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) vids[i].pause();
      audio.duck(false);
      tl.to(node, { opacity: 0, y: -12, duration: 0.3, ease: "power1.in" }, at);
      tl.call(function () { if (node.parentNode) node.remove(); if (content.current === node) content.current = null; }, null, at + 0.3);
    },
    in: function (tl, slide, at) {
      tl.call(function () { content.show(slide, true); }, null, at);
    }
  };

  /* ==========================================================================
     Музыка
     ========================================================================== */

  var audio = {
    el: el.audio,
    want: false,       // музыка должна играть (дверь открыта)
    pending: false,    // play() отклонён — ждём жеста пользователя
    unlocked: false,
    muted: false,
    level: { v: 0 },
    fade: null,
    ducked: false,
    init: function () {
      var srcs = [].concat(CFG.assets.music || []);
      var types = { ogg: "audio/ogg; codecs=opus", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
      var a = this.el;
      srcs.forEach(function (s) {
        var ext = s.split(".").pop().toLowerCase();
        if (types[ext] && a.canPlayType(types[ext]) === "") return;
        var so = document.createElement("source");
        so.src = s;
        if (types[ext]) so.type = types[ext];
        a.append(so);
      });
      a.volume = 0;
      try { this.muted = localStorage.getItem("ny-muted") === "1"; } catch (e) {}
      el.mute.classList.toggle("muted", this.muted);
    },
    target: function () { return this.muted ? 0 : (this.ducked ? SET.musicVolume * 0.15 : SET.musicVolume); },
    apply: function () { this.el.volume = clamp(this.level.v, 0, 1); },
    fadeTo: function (v, dur, done) {
      var self = this;
      if (this.fade) this.fade.kill();
      this.fade = gsap.to(this.level, {
        v: v, duration: dur, ease: "sine.inOut",
        onUpdate: function () { self.apply(); },
        onComplete: done
      });
    },
    // «Разблокировка» по клику: play + сразу pause, чтобы потом старт без жеста прошёл
    unlock: function () {
      if (this.unlocked) return;
      var self = this, a = this.el;
      if (this.want) { this.tryPlay(); return; }
      var p = a.play();
      if (p && p.then) {
        p.then(function () {
          self.unlocked = true;
          if (!self.want) a.pause();
        }, function () {});
      }
    },
    tryPlay: function () {
      var self = this, a = this.el;
      var p = a.play();
      var ok = function () {
        self.unlocked = true;
        self.pending = false;
        self.fadeTo(self.target(), SET.musicFadeIn);
      };
      if (p && p.then) {
        p.then(ok, function () {
          self.pending = true;
          toast("Нажмите в любом месте, чтобы включить музыку", 4000);
        });
      } else ok();
    },
    start: function () {
      this.want = true;
      if (!this.el.paused) { this.fadeTo(this.target(), SET.musicFadeIn); return; }
      this.level.v = 0; this.apply();
      this.tryPlay();
    },
    stop: function () {
      var self = this;
      this.want = false;
      this.pending = false;
      this.fadeTo(0, 1.4, function () { if (!self.want) self.el.pause(); });
    },
    onGesture: function () {
      if (this.pending && this.want) this.tryPlay();
      else this.unlock();
    },
    toggleMute: function () {
      this.muted = !this.muted;
      el.mute.classList.toggle("muted", this.muted);
      el.mute.setAttribute("aria-label", this.muted ? "Включить звук" : "Выключить звук");
      try { localStorage.setItem("ny-muted", this.muted ? "1" : "0"); } catch (e) {}
      if (this.want) {
        if (this.muted) this.fadeTo(0, 0.6);
        else if (this.el.paused) this.tryPlay();
        else this.fadeTo(this.target(), 0.8);
      }
      toast(this.muted ? "Звук выключен" : "Звук включён", 1400);
    },
    duck: function (on) {
      if (this.ducked === on) return;
      this.ducked = on;
      if (this.want && !this.el.paused) this.fadeTo(this.target(), 0.6);
    }
  };

  var toastTimer = 0;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, ms || 2000);
  }

  /* ==========================================================================
     Эффекты: снег, мерцание тёплого света, параллакс за курсором.
     Включаются флагами slide.effects и выключаются settings.effects: false.
     ========================================================================== */

  var fx = (function () {
    var on = function () { return SET.effects !== false && !reducedMotion.matches; };
    var finePointer = window.matchMedia("(pointer: fine)");

    /* --- Снег --- */
    var snow = {
      canvas: el.snow, ctx: el.snow.getContext("2d"),
      flakes: [], running: false, sprite: null, last: 0, dpr: 1,
      makeSprite: function () {
        var c = document.createElement("canvas"), s = 32;
        c.width = c.height = s;
        var g = c.getContext("2d");
        var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        grd.addColorStop(0, "rgba(255,255,255,1)");
        grd.addColorStop(0.45, "rgba(255,255,255,0.75)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, s, s);
        this.sprite = c;
      },
      resize: function () {
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.canvas.width = Math.round(window.innerWidth * this.dpr);
        this.canvas.height = Math.round(window.innerHeight * this.dpr);
        var target = Math.round(Math.min(220, window.innerWidth * window.innerHeight / 9000));
        while (this.flakes.length < target) this.flakes.push(this.flake(true));
        this.flakes.length = target;
      },
      flake: function (anywhere) {
        var W = this.canvas.width, H = this.canvas.height, d = this.dpr;
        var depth = Math.random();                      // 0 — далеко, 1 — близко
        return {
          x: Math.random() * W,
          y: anywhere ? Math.random() * H : -10 * d,
          r: (1 + depth * 3.2) * d,
          vy: (18 + depth * 55) * d,
          sway: (6 + Math.random() * 18) * d,
          phase: Math.random() * Math.PI * 2,
          freq: 0.4 + Math.random() * 0.8,
          a: 0.35 + depth * 0.55
        };
      },
      tick: function () {
        var now = performance.now();
        var dt = Math.min((now - snow.last) / 1000, 0.05);
        snow.last = now;
        var ctx = snow.ctx, W = snow.canvas.width, H = snow.canvas.height;
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < snow.flakes.length; i++) {
          var f = snow.flakes[i];
          f.y += f.vy * dt;
          f.phase += f.freq * dt;
          var x = f.x + Math.sin(f.phase) * f.sway;
          if (f.y - f.r > H) { snow.flakes[i] = snow.flake(false); continue; }
          ctx.globalAlpha = f.a;
          ctx.drawImage(snow.sprite, x - f.r * 2, f.y - f.r * 2, f.r * 4, f.r * 4);
        }
        ctx.globalAlpha = 1;
      },
      start: function () {
        if (!this.sprite) this.makeSprite();
        if (!this.flakes.length) this.resize();
        if (!this.running) { this.running = true; this.last = performance.now(); gsap.ticker.add(this.tick); }
        gsap.to(this.canvas, { opacity: 1, duration: 1.2, ease: "power1.out", overwrite: true });
      },
      stop: function (tl) {
        var self = this;
        var t = gsap.to(this.canvas, {
          opacity: 0, duration: 0.5, ease: "power1.in", overwrite: true,
          onComplete: function () { gsap.ticker.remove(self.tick); self.running = false; }
        });
        if (tl) tl.add(t, 0);
      }
    };

    /* --- Мерцание тёплого света --- */
    var flicker = {
      tween: null,
      start: function (opt) {
        var o = typeof opt === "object" ? opt : {};
        el.flicker.style.setProperty("--fx", (o.x != null ? o.x : 50) + "%");
        el.flicker.style.setProperty("--fy", (o.y != null ? o.y : 85) + "%");
        this.stopNow();
        gsap.to(el.flicker, { opacity: 0.8, duration: 1, ease: "power1.out" });
        this.tween = gsap.to(el.flicker, {
          opacity: "random(0.45, 1)", duration: "random(0.09, 0.28)", ease: "sine.inOut",
          repeat: -1, repeatRefresh: true, delay: 1
        });
      },
      stopNow: function () { if (this.tween) { this.tween.kill(); this.tween = null; } },
      stop: function (tl) {
        this.stopNow();
        var t = gsap.to(el.flicker, { opacity: 0, duration: 0.4, overwrite: true });
        if (tl) tl.add(t, 0);
      }
    };

    /* --- Параллакс крупного плана за курсором (2–6 px) --- */
    var parallax = {
      img: null, qx: null, qy: null, amp: 5,
      bind: function (img) {
        this.img = img;
        this.qx = img ? gsap.quickTo(img, "x", { duration: 0.9, ease: "power3.out" }) : null;
        this.qy = img ? gsap.quickTo(img, "y", { duration: 0.9, ease: "power3.out" }) : null;
      },
      move: function (e) {
        if (!parallax.qx || nav.busy || !on() || !finePointer.matches) return;
        var nx = e.clientX / window.innerWidth - 0.5, ny = e.clientY / window.innerHeight - 0.5;
        parallax.qx(-nx * 2 * parallax.amp);
        parallax.qy(-ny * 2 * parallax.amp);
      }
    };
    window.addEventListener("pointermove", parallax.move, { passive: true });

    return {
      // Небольшой запас по масштабу, чтобы при сдвиге не открывались края картинки
      baseScale: function () { return on() && finePointer.matches ? 1.012 : 1; },
      arrive: function (s) {
        if (!on() || isCover(s)) return;
        var e = s.effects || {};
        if (e.snow) snow.start();
        if (e.flicker) flicker.start(e.flicker);
        var slot = s.bg ? closeups.active() : null;
        parallax.bind(slot ? slot.img : null);
      },
      leave: function (s, tl) {
        if (snow.running) snow.stop(tl);
        if (flicker.tween || +getComputedStyle(el.flicker).opacity > 0) flicker.stop(tl);
        parallax.bind(null);
      },
      resize: function () { snow.resize(); }
    };
  })();

  /* ==========================================================================
     Переходы
     ========================================================================== */

  var master, door;

  function isCover(s) { return s && s.type === "cover"; }
  // Вид мастера для остановки
  function camView(s) { return master.viewFor(s.camera || { x: 0, y: 0, w: 1, h: 1 }); }
  // Где стоит мастер, пока крупный план закрывает экран
  function anchorView(s) {
    var v = camView(s);
    if (!s.bg) return v;
    return s.transition === "glass" ? scaleView(v, 0.35) : scaleView(v, 0.88);
  }
  function anchorBlur(s) { return !s.bg ? 0 : (s.transition === "glass" ? 14 : 8); }

  // Псевдо-остановка: общий план сразу после входа в дверь (без текста и затемнения)
  var HALL = { id: "__hall", bg: null, camera: { x: 0, y: 0, w: 1, h: 1 }, content: null };

  function slideHasShade(s) { return !s.bg && !!s.content; }

  function buildMove(A, B) {
    var tl = gsap.timeline({ paused: true });
    var camA = camView(A), camB = camView(B);
    var flyStart;

    content.out(tl, 0);
    fx.leave(A, tl);

    // 1–2. Уход с A: крупный план растворяется в мастер, выставленный на камеру A
    if (A.bg) {
      var slotA = closeups.active();
      closeups.stopKenBurns();
      if (A.transition === "glass") {
        var deepA = scaleView(camA, 0.35);
        tl.call(function () { master.setView(deepA); master.setBlur(14); }, null, 0.05);
        tl.fromTo(slotA.el, { scale: 1, filter: "blur(0px)" },
          { opacity: 0, scale: 1.22, filter: "blur(10px)", duration: 0.95, ease: "power2.in" }, 0.15);
        tl.fromTo(el.frost, { opacity: 0 }, { opacity: 0.5, duration: 0.35, yoyo: true, repeat: 1, ease: "sine.inOut" }, 0.4);
        tl.add(master.tweenView(deepA, camA, 1.05, "power2.out"), 0.6);
        tl.add(master.tweenBlur(14, 0, 0.9, "power2.out"), 0.6);
        flyStart = 1.65;
      } else {
        tl.call(function () { master.setView(camA); master.setBlur(6); }, null, 0.05);
        tl.fromTo(slotA.el, { scale: 1, filter: "blur(0px)" },
          { opacity: 0, scale: 0.92, filter: "blur(3px)", duration: 0.75, ease: "power2.inOut" }, 0.2);
        tl.add(master.tweenBlur(6, 0, 0.65, "power2.out"), 0.3);
        flyStart = 0.6;
      }
    } else {
      if (slideHasShade(A)) tl.to(el.shade, { opacity: 0, duration: 0.6, ease: "power1.inOut" }, 0.1);
      flyStart = 0.3;
    }

    // 3. Перелёт по мастер-кадру
    var glassB = B.bg && B.transition === "glass";
    var target = B.bg && !glassB ? anchorView(B) : camB;
    var fly = master.fly(A.bg ? camA : camView(A), target);
    var flyDur = fly ? fly.duration : 0;
    if (fly) tl.add(fly.tween, flyStart);
    var flyEnd = flyStart + flyDur;

    // 4–5. Приход на B
    var textAt;
    if (B.bg) {
      var slotB = closeups.prepare(B.bg);
      tl.call(function () { el.slots[slotB.index].style.willChange = "transform, opacity, filter"; }, null, 0);
      if (glassB) {
        var deepB = scaleView(camB, 0.35);
        tl.add(master.tweenView(camB, deepB, 1.15, "power2.in"), flyEnd);
        tl.add(master.tweenBlur(0, 14, 1.0, "power2.in"), flyEnd + 0.15);
        tl.fromTo(el.frost, { opacity: 0 }, { opacity: 0.55, duration: 0.4, yoyo: true, repeat: 1, ease: "sine.inOut" }, flyEnd + 0.45);
        tl.fromTo(slotB.el, { opacity: 0, scale: 1.25, filter: "blur(12px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 1.15, ease: "power2.out" }, flyEnd + 0.6);
        textAt = flyEnd + 1.4;
      } else {
        var revealAt = flyStart + Math.max(flyDur * 0.66, 0.2);
        tl.add(master.tweenBlur(0, 8, Math.max(flyDur * 0.34, 0.4) + 0.2, "power1.in"), revealAt);
        tl.fromTo(slotB.el, { opacity: 0, scale: 0.92, filter: "blur(6px)" },
          { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.9, ease: "power2.out" }, revealAt);
        textAt = revealAt + 0.7;
      }
      tl.call(function () {
        closeups.activate(slotB.index);
        el.slots[slotB.index].style.willChange = "";
      });
    } else {
      if (slideHasShade(B)) tl.to(el.shade, { opacity: 1, duration: 0.8, ease: "power1.inOut" }, Math.max(flyEnd - 0.45, 0.2));
      tl.call(function () { closeups.hideAll(); }, null, flyEnd);
      textAt = Math.max(flyEnd - 0.1, 0.35);
    }
    content.in(tl, B, textAt);
    return tl;
  }

  // Обложка → комната. Назад — этот же таймлайн в обратную сторону.
  function buildDoor() {
    var tl = gsap.timeline({ paused: true });
    var dv = door.views();
    var mFull = master.fullView();
    var openAngle = door.cfg.hinge === "right" ? -100 : 100;

    tl.set(el.doorView, { visibility: "visible" }, 0);
    // 1. Текст на плакате уходит
    tl.to(el.poster, { opacity: 0, duration: 0.35, ease: "power1.in" }, 0);
    // 2. Камера отъезжает от плаката до полного вида двери
    tl.add(door.tweenView(dv.poster, dv.full, 0.85, "power2.inOut"), 0.2);
    tl.call(function () { master.setView(mFull); master.setBlur(2); closeups.hideAll(); }, null, 0.2);
    // 3. Дверь открывается внутрь, из-за неё льётся тёплый свет
    tl.call(function () { if (!tl.reversed()) audio.start(); }, null, 1.05);
    tl.to(el.leaf, { rotationY: openAngle, duration: 1.3, ease: "power2.inOut" }, 1.05);
    tl.to(el.glowIn, { opacity: 1, duration: 1.1, ease: "power1.out" }, 1.15);
    tl.to(el.glowOut, { opacity: 1, duration: 1.1, ease: "power1.out" }, 1.2);
    // 4. Камера проходит в проём: коридор растёт от центра проёма и растворяется
    var pass = 2.25;
    tl.add(door.tweenView(dv.full, dv.deep, 1.5, "power2.in"), pass);
    tl.to(el.doorWorld, { opacity: 0, duration: 0.55, ease: "power1.in" }, pass + 0.95);
    tl.to(el.glowIn, { opacity: 0, duration: 0.8, ease: "power1.in" }, pass + 0.5);
    tl.add(master.tweenBlur(2, 0, 1.3, "power1.out"), pass);
    tl.set(el.doorView, { visibility: "hidden" }, pass + 1.5);
    return tl;
  }

  function playForward(tl) {
    return new Promise(function (resolve) {
      tl.eventCallback("onComplete", resolve);
      APP.timeline = tl;
      tl.play(0);
    });
  }
  function playReverse(tl) {
    return new Promise(function (resolve) {
      tl.eventCallback("onReverseComplete", resolve);
      APP.timeline = tl;
      tl.progress(1, true).reverse();
    });
  }

  // Упрощённые переходы для prefers-reduced-motion: кроссфейды
  function buildCrossfade(A, B) {
    var tl = gsap.timeline({ paused: true });
    content.out(tl, 0);
    if (isCover(A)) {
      tl.call(function () { master.setView(camView(B)); master.setBlur(0); if (!tl.reversed()) audio.start(); }, null, 0.3);
      tl.to(el.doorView, { opacity: 0, duration: 0.6 }, 0.3);
      tl.set(el.doorView, { visibility: "hidden", opacity: 1 });
    } else if (isCover(B)) {
      tl.call(function () { door.reset(); door.setView(door.views().poster); audio.stop(); }, null, 0.3);
      tl.fromTo(el.doorView, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0.3);
      tl.to(el.shade, { opacity: 0, duration: 0.4 }, 0.3);
      tl.call(function () { closeups.hideAll(); });
      return tl;
    }
    var slotA = closeups.active();
    if (B.bg) {
      var slotB = closeups.prepare(B.bg);
      if (!A.bg) tl.call(function () { master.setView(camView(B)); }, null, 0.3);
      tl.to(slotB.el, { opacity: 1, duration: 0.7 }, 0.3);
      tl.call(function () { closeups.activate(slotB.index); });
    } else {
      tl.call(function () { master.setView(camView(B)); master.setBlur(0); }, null, 0.25);
      if (slotA) tl.to(slotA.el, { opacity: 0, duration: 0.7 }, 0.3);
      tl.call(function () { closeups.hideAll(); });
    }
    tl.to(el.shade, { opacity: slideHasShade(B) ? 1 : 0, duration: 0.6 }, 0.3);
    content.in(tl, B, 0.8);
    return tl;
  }

  // Мгновенно выставить сцену на слайд (старт по #hash, resize)
  function applyInstant(i, keepContent) {
    var s = SLIDES[i];
    gsap.killTweensOf([el.leaf, el.poster, el.glowIn, el.glowOut, el.doorWorld, el.shade, el.frost].concat(el.slots));
    el.frost.style.opacity = 0;
    fx.leave(s);
    if (isCover(s)) {
      door.reset();
      door.setView(door.views().poster);
      master.setView(master.fullView());
      master.setBlur(0);
      closeups.hideAll();
      gsap.set(el.shade, { opacity: 0 });
      content.clear();
      return;
    }
    el.doorView.style.visibility = "hidden";
    master.setView(anchorView(s));
    master.setBlur(anchorBlur(s));
    if (s.bg) {
      var slot = closeups.prepare(s.bg);
      gsap.set(slot.el, { opacity: 1 });
      closeups.activate(slot.index);
      closeups.startKenBurns();
    } else {
      closeups.hideAll();
    }
    gsap.set(el.shade, { opacity: slideHasShade(s) ? 1 : 0 });
    if (!keepContent) content.show(s, false);
    fx.arrive(s);
  }

  // Пересчёт видов после resize (без перерисовки контента)
  function refreshViews() {
    var s = SLIDES[nav.index];
    if (isCover(s)) { door.setView(door.views().poster); master.setView(master.fullView()); return; }
    master.setView(anchorView(s));
  }

  /* ==========================================================================
     Навигация
     ========================================================================== */

  var nav = {
    index: 0,
    busy: false,
    lockUntil: 0,
    inputEnabled: true,   // режим калибровки выключает ввод

    canNavigate: function () {
      return this.inputEnabled && !this.busy && performance.now() >= this.lockUntil;
    },
    next: function () { this.go(this.index + 1); },
    prev: function () { this.go(this.index - 1); },

    go: function (to) {
      to = clamp(to, 0, N - 1);
      if (to === this.index || !this.canNavigate()) return Promise.resolve(false);
      var self = this, from = this.index;
      var A = SLIDES[from], B = SLIDES[to];
      this.busy = true;
      master.setIdle(false);
      this.index = to;
      this.updateUI();
      this.writeHash();

      return prepareSlide(B)
        .then(function () { return runTransition(A, B); })
        .catch(function (err) { console.error(err); applyInstant(to); })
        .then(function () {
          self.busy = false;
          self.lockUntil = performance.now() + SET.cooldown;
          arrived(B, to);
          // прогрев тайлов — после того как текст проявился
          setTimeout(function () { if (!self.busy) master.setIdle(true); }, 700);
          return true;
        });
    },

    buildDots: function () {
      var self = this;
      el.dots.textContent = "";
      SLIDES.forEach(function (s, i) {
        var b = mk("button", "dot");
        b.type = "button";
        b.setAttribute("role", "tab");
        var label = isCover(s) ? (CFG.door.content && CFG.door.content.title) || "Обложка"
          : (s.content && (s.content.title || s.content.kicker)) || s.id;
        b.setAttribute("aria-label", (i + 1) + ". " + label);
        b.title = label;
        b.addEventListener("click", function (e) {
          if (e.detail) b.blur();
          audio.onGesture();
          self.go(i);
        });
        el.dots.append(b);
      });
      el.counterTotal.textContent = pad(N);
    },

    updateUI: function () {
      var i = this.index;
      el.prev.classList.toggle("hidden", i === 0);
      el.next.classList.toggle("hidden", i === N - 1);
      el.counterCur.textContent = pad(i + 1);
      var dots = el.dots.children;
      for (var d = 0; d < dots.length; d++) {
        dots[d].classList.toggle("active", d === i);
        dots[d].setAttribute("aria-selected", d === i ? "true" : "false");
      }
    },

    writeHash: function () {
      var hash = this.index === 0 ? "" : "#" + SLIDES[this.index].id;
      if (location.hash === hash) return;
      try {
        history.replaceState(null, "", location.pathname + location.search + hash);
      } catch (e) {
        // file:// в некоторых браузерах запрещает replaceState — меняем hash без записи в историю
        location.replace(hash || "#");
      }
    }
  };

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function indexOfId(id) {
    for (var i = 0; i < N; i++) if (SLIDES[i].id === id) return i;
    return -1;
  }

  function prepareSlide(s) {
    if (s.bg) return loadImage(closeupSrc(s.bg)).catch(function (e) { console.warn(e.message); });
    return Promise.resolve();
  }

  function runTransition(A, B) {
    if (reducedMotion.matches) return playForward(buildCrossfade(A, B));
    if (isCover(A)) {
      // Вход: дверь → общий план → (при необходимости) перелёт к B
      return playForward(buildDoor()).then(function () {
        return playForward(buildMove(HALL, B));
      });
    }
    if (isCover(B)) {
      // Выход: к общему плану → дверь закрывается, наезд на плакат
      audio.stop();
      return playForward(buildMove(A, HALL)).then(function () {
        door.reset();
        return playReverse(buildDoor());
      });
    }
    return playForward(buildMove(A, B));
  }

  function arrived(s, i) {
    if (s.bg) closeups.startKenBurns();
    fx.arrive(s);
    // Подгружаем то, что понадобится для соседних остановок
    [i - 1, i + 1, i + 2].forEach(function (j) {
      var n = SLIDES[j];
      if (!n || isCover(n)) return;
      if (n.bg) enqueue(closeupSrc(n.bg), 5);
      master.prefetch(camView(n));
      master.prefetch(anchorView(n));
    });
  }

  /* ---------- Ввод ---------------------------------------------------------- */

  var wheel = { acc: 0, timer: 0, latched: false };
  function onWheel(e) {
    e.preventDefault();
    if (!nav.inputEnabled) return;
    var unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);
    var d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    clearTimeout(wheel.timer);
    wheel.timer = setTimeout(function () { wheel.acc = 0; wheel.latched = false; }, SET.wheelReset);
    // После срабатывания ждём паузы в прокрутке — инерция тачпада не листает дальше
    if (wheel.latched || !nav.canNavigate()) { wheel.acc = 0; return; }
    wheel.acc += d;
    if (Math.abs(wheel.acc) >= SET.wheelThreshold) {
      var dir = wheel.acc > 0 ? 1 : -1;
      wheel.acc = 0;
      wheel.latched = true;
      if (dir > 0) nav.next(); else nav.prev();
    }
  }

  function onKey(e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    audio.onGesture();
    if (!nav.inputEnabled) return;
    var k = e.key;
    var handled = true;
    if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || (k === " " && !e.shiftKey)) {
      if (!e.repeat) nav.next();
    } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || (k === " " && e.shiftKey)) {
      if (!e.repeat) nav.prev();
    } else if (k === "Home") nav.go(0);
    else if (k === "End") nav.go(N - 1);
    else if (k === "f" || k === "F" || k === "а" || k === "А") toggleFullscreen();
    else if (k === "m" || k === "M" || k === "ь" || k === "Ь") audio.toggleMute();
    else handled = false;
    if (handled) e.preventDefault();
  }

  function toggleFullscreen() {
    var d = document, de = d.documentElement;
    var fsEl = d.fullscreenElement || d.webkitFullscreenElement;
    if (!fsEl) {
      var req = de.requestFullscreen || de.webkitRequestFullscreen;
      if (req) { var p = req.call(de); if (p && p.catch) p.catch(function () {}); }
      else toast("Полноэкранный режим недоступен");
    } else {
      var ex = d.exitFullscreen || d.webkitExitFullscreen;
      if (ex) ex.call(d);
    }
  }

  var touch = null;
  function onTouchStart(e) {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() };
  }
  function onTouchMove(e) {
    // Нативный скролл и pull-to-refresh подавлены; видео и кнопки работают как обычно
    if (e.cancelable) e.preventDefault();
  }
  function onTouchEnd(e) {
    if (!touch || !nav.inputEnabled) return;
    var tt = e.changedTouches[0];
    var dx = tt.clientX - touch.x, dy = tt.clientY - touch.y;
    var dt = performance.now() - touch.t;
    touch = null;
    var dist = Math.max(Math.abs(dx), Math.abs(dy));
    if (dist < 45 || dt > 900) return;
    var forward = Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
    if (forward) nav.next(); else nav.prev();
  }

  function bindInput() {
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", function () { audio.onGesture(); }, true);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    el.prev.addEventListener("click", function (e) { if (e.detail) el.prev.blur(); nav.prev(); });
    el.next.addEventListener("click", function (e) { if (e.detail) el.next.blur(); nav.next(); });
    el.mute.addEventListener("click", function (e) { if (e.detail) el.mute.blur(); audio.toggleMute(); });
    window.addEventListener("hashchange", function () {
      var i = indexOfId(location.hash.slice(1));
      if (i >= 0 && i !== nav.index) nav.go(i);
    });
    var rt = 0;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(onResize, 60);
    });
  }

  function onResize() {
    master.resize();
    fx.resize();
    if (!nav.busy) refreshViews();
    else {
      // Переход досчитается со старыми размерами — поправим по завершении
      var check = setInterval(function () { if (!nav.busy) { clearInterval(check); refreshViews(); } }, 100);
    }
  }

  /* ==========================================================================
     Старт: экран загрузки → первая сцена
     ========================================================================== */

  function boot() {
    master = new MasterRenderer(el.master, window.MASTER_TILES);
    door = new DoorScene(CFG.door);
    master.resize();
    audio.init();
    nav.buildDots();
    door.renderPoster();
    bindInput();

    var start = indexOfId(location.hash.slice(1));
    if (start < 0) start = 0;
    nav.index = start;

    var previewSrc = (window.MASTER_TILES && window.MASTER_TILES.preview) || CFG.assets.masterPreview || CFG.assets.master;
    var tasks = [
      loadImage(CFG.assets.door).then(function (img) { door.setAspect(img.naturalWidth / img.naturalHeight); }),
      loadImage(previewSrc).then(function (img) {
        master.preview = img;
        if (!window.MASTER_TILES) master.A = img.naturalWidth / img.naturalHeight;
        master.dirty = true;
      }),
      document.fonts && document.fonts.load
        ? Promise.all([
            document.fonts.load("600 40px 'Playfair Display'", "Новогодняя"),
            document.fonts.load("italic 400 20px 'Playfair Display'", "комната"),
            document.fonts.load("400 16px 'Nunito'", "Текст"),
            document.fonts.load("800 16px 'Nunito'", "СЦЕНА")
          ]).catch(function () {})
        : Promise.resolve()
    ];
    if (SLIDES[start].bg) tasks.push(prepareSlide(SLIDES[start]));

    var done = 0;
    tasks.forEach(function (p) {
      p.catch(function () {}).then(function () {
        done++;
        var pct = Math.round(done / tasks.length * 100);
        el.loaderFill.style.transform = "scaleX(" + (done / tasks.length) + ")";
        el.loaderPct.textContent = pct + "%";
      });
    });

    Promise.all(tasks.map(function (p) { return p.catch(function (e) { console.error(e); }); })).then(function () {
      try {
        applyInstant(start);
        nav.updateUI();
        master.draw();
        if (start !== 0) {
          audio.start(); // скорее всего будет отклонён браузером — стартуем по первому клику
          arrived(SLIDES[start], start);
        }
      } catch (e) { console.error(e); }
      setTimeout(function () {
        el.loader.classList.add("done");
        el.ui.classList.add("visible");
        el.mute.classList.add("visible");
      }, 250);
      backgroundLoad(start);
    });
  }

  // Фоновая подгрузка: крупные планы по удалённости от текущего слайда, затем тайлы
  function backgroundLoad(start) {
    var order = SLIDES.map(function (s, i) { return { s: s, d: Math.abs(i - start) }; })
      .sort(function (a, b) { return a.d - b.d; });
    order.forEach(function (o, n) { if (o.s.bg) enqueue(closeupSrc(o.s.bg), 3 - n * 0.01); });
    // Уровень ½ целиком (он нужен почти на любом перелёте), затем тайлы остановок
    // На телефонах (мало памяти) — только ближайшие остановки, остальные догрузятся по пути
    var stops = order.filter(function (o) { return !isCover(o.s); });
    if (TILE_BUDGET < 32) stops = stops.slice(0, 3);
    setTimeout(function () {
      master.requestLevel(0);
      stops.forEach(function (o) {
        master.prefetch(camView(o.s));
        master.prefetch(anchorView(o.s));
      });
    }, 1200);
  }

  // API для режима калибровки (debug.js)
  window.APP = {
    config: CFG,
    get master() { return master; },
    get door() { return door; },
    nav: nav,
    slides: SLIDES,
    applyInstant: applyInstant,
    refreshViews: refreshViews,
    camView: camView,
    content: content,
    closeups: closeups,
    audio: audio,
    loadImage: loadImage,
    closeupSrc: closeupSrc,
    toast: toast,
    rectToView: rectToView,
    clampView: clampView,
    zoomPath: zoomPath,
    applyCalibration: applyCalibration,
    mixView: mixView,
    buildMove: function (a, b) { return buildMove(SLIDES[a], SLIDES[b]); },
    buildDoor: function () { return buildDoor(); },
    timeline: null,
    flyDuration: flyDuration
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
