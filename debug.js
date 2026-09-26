/*
  Режим калибровки: разметка рамок камеры на мастер-кадре и координат двери.
  Включается по ?debug=1 или клавише D. Для автора, не для зрителя.

  Мышь: нарисовать рамку (на мастере — строго 16:9); тянуть внутри рамки — сдвинуть;
  колесо над рамкой — масштаб; стрелки — сдвиг (Shift — крупнее); +/− — масштаб.
  Черновик хранится в браузере (localStorage), в config.js — через «Скопировать конфиг».
*/
(function () {
  "use strict";

  var APP = window.APP;
  if (!APP) return;
  var CFG = APP.config;
  var SLIDES = APP.slides;
  var STORE = "ny-calibration";
  var params = new URLSearchParams(location.search);
  var enabled = params.get("debug") === "1";

  var state = {
    active: false,
    mode: "master",       // master | door
    sel: firstStop(),     // индекс слайда
    doorKey: "rect",      // rect | posterRect | paperRect
    overlay: 0.45,        // прозрачность крупного плана в превью
    drag: null
  };

  var DOOR_KEYS = {
    rect: { label: "Полотно двери (door.rect)", ratio: false, color: "#7fd1ff" },
    posterRect: { label: "Кадр обложки (door.posterRect, 16:9)", ratio: true, color: "#ffcf6e" },
    paperRect: { label: "Лист плаката — область текста (door.paperRect)", ratio: false, color: "#b6ff8a" }
  };

  function firstStop() {
    for (var i = 0; i < SLIDES.length; i++) if (SLIDES[i].type !== "cover" && SLIDES[i].bg) return i;
    return 1;
  }

  /* ---------- Черновик ------------------------------------------------------ */

  function snapshot() {
    var cams = {};
    SLIDES.forEach(function (s) { if (s.type !== "cover" && s.camera) cams[s.id] = round(s.camera); });
    return {
      cameras: cams,
      door: {
        hinge: CFG.door.hinge,
        rect: round(CFG.door.rect),
        posterRect: round(CFG.door.posterRect),
        paperRect: CFG.door.paperRect ? round(CFG.door.paperRect) : undefined
      }
    };
  }
  function round(r) {
    var f = function (v) { return Math.round(v * 10000) / 10000; };
    return { x: f(r.x), y: f(r.y), w: f(r.w), h: f(r.h) };
  }
  function saveDraft() {
    try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) {}
    setStatus("Черновик сохранён в браузере");
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE) || "null");
      if (d) { APP.applyCalibration(d); return true; }
    } catch (e) {}
    return false;
  }

  // В режиме калибровки черновик применяется сразу, до старта движка
  if (enabled) loadDraft();

  /* ---------- Интерфейс ----------------------------------------------------- */

  var root, cv, ctx, side, list, preview, pctx, status, info, doorBox, masterBox, keySel, hingeSel, ta;
  var images = { master: null, door: null, closeups: {} };
  var fit = { x: 0, y: 0, s: 1, A: 16 / 9, W: 1, H: 1 };

  function css() {
    var s = document.createElement("style");
    s.textContent = [
      "#dbg{position:fixed;inset:0;z-index:40;display:flex;background:#0d0907f2;color:#f3e6d6;font:13px/1.45 'Nunito',system-ui,sans-serif;user-select:none}",
      "#dbg .dbg-main{flex:1;position:relative;min-width:0}",
      "#dbg canvas.dbg-cv{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none}",
      "#dbg .dbg-side{width:330px;flex:none;padding:16px 16px 20px;overflow-y:auto;border-left:1px solid #ffffff1f;background:#150f0b;display:flex;flex-direction:column;gap:12px}",
      "#dbg h2{font:600 18px 'Playfair Display',Georgia,serif;margin:0}",
      "#dbg .dbg-tabs{display:flex;gap:6px}",
      "#dbg button,#dbg select{font:inherit;color:inherit;background:#2a1f18;border:1px solid #ffffff2a;border-radius:8px;padding:7px 10px;cursor:pointer}",
      "#dbg button:hover{background:#3a2b21}",
      "#dbg button.on{background:#f4c47c;color:#2b1a10;border-color:#f4c47c;font-weight:700}",
      "#dbg .dbg-row{display:flex;gap:6px;flex-wrap:wrap}",
      "#dbg .dbg-list{display:flex;flex-direction:column;gap:2px;max-height:260px;overflow:auto;border:1px solid #ffffff1a;border-radius:8px;padding:4px}",
      "#dbg .dbg-item{display:flex;justify-content:space-between;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;font-variant-numeric:tabular-nums}",
      "#dbg .dbg-item:hover{background:#ffffff10}",
      "#dbg .dbg-item.on{background:#f4c47c26;outline:1px solid #f4c47c80}",
      "#dbg .dbg-item small{opacity:.6;font-family:ui-monospace,Consolas,monospace;font-size:11px}",
      "#dbg canvas.dbg-prev{width:100%;border-radius:8px;background:#000;display:block}",
      "#dbg .dbg-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;opacity:.85;word-break:break-all}",
      "#dbg .dbg-status{font-size:12px;color:#b6ff8a;min-height:18px}",
      "#dbg .dbg-help{font-size:12px;opacity:.65;line-height:1.5}",
      "#dbg label{display:flex;align-items:center;gap:8px;font-size:12px}",
      "#dbg input[type=range]{flex:1}",
      "#dbg textarea{width:100%;height:120px;background:#0d0907;color:#f3e6d6;border:1px solid #ffffff2a;border-radius:8px;font:11px ui-monospace,Consolas,monospace;display:none}",
      "@media (max-width: 900px){#dbg{flex-direction:column}#dbg .dbg-side{width:auto;height:48%;border-left:0;border-top:1px solid #ffffff1f}#dbg .dbg-list{max-height:140px}}",
      "#dbg .dbg-badge{position:absolute;left:14px;top:12px;padding:4px 10px;border-radius:99px;background:#f4c47c;color:#2b1a10;font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;pointer-events:none}"
    ].join("\n");
    document.head.append(s);
  }

  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.append(c); });
    return n;
  }

  function build() {
    css();
    cv = h("canvas", { class: "dbg-cv" });
    ctx = cv.getContext("2d");
    preview = h("canvas", { class: "dbg-prev" });
    pctx = preview.getContext("2d");
    list = h("div", { class: "dbg-list" });
    status = h("div", { class: "dbg-status" });
    info = h("div", { class: "dbg-mono" });
    ta = h("textarea", { readonly: "readonly" });

    keySel = h("div", { class: "dbg-list" });
    Object.keys(DOOR_KEYS).forEach(function (k) {
      var it = h("div", { class: "dbg-item", "data-key": k, onclick: function () { state.doorKey = k; refresh(); } },
        [h("span", { text: DOOR_KEYS[k].label })]);
      keySel.append(it);
    });
    hingeSel = h("select", {
      onchange: function () { CFG.door.hinge = hingeSel.value; APP.door.layout(); saveDraft(); }
    }, [h("option", { value: "left", text: "Петли слева" }), h("option", { value: "right", text: "Петли справа" })]);

    masterBox = h("div", { style: "display:flex;flex-direction:column;gap:10px" }, [
      h("div", { class: "dbg-help", text: "Остановки на мастер-кадре. Рамка строго 16:9." }),
      list,
      h("label", {}, [h("span", { text: "Крупный план поверх" }),
        h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(state.overlay),
          oninput: function (e) { state.overlay = +e.target.value; drawPreview(); } })])
    ]);
    doorBox = h("div", { style: "display:flex;flex-direction:column;gap:10px;display:none" }, [
      h("div", { class: "dbg-help", text: "Разметка на door.webp. Полотно и лист — произвольные прямоугольники, кадр обложки — 16:9." }),
      keySel,
      hingeSel
    ]);

    side = h("div", { class: "dbg-side" }, [
      h("h2", { text: "Калибровка" }),
      h("div", { class: "dbg-tabs" }, [
        h("button", { "data-mode": "master", text: "Мастер-кадр", onclick: function () { setMode("master"); } }),
        h("button", { "data-mode": "door", text: "Дверь", onclick: function () { setMode("door"); } })
      ]),
      masterBox,
      doorBox,
      h("div", { class: "dbg-help", text: "Превью остановки в пропорциях окна:" }),
      preview,
      info,
      h("div", { class: "dbg-row" }, [
        h("button", { text: "Показать остановку", onclick: showStop }),
        h("button", { text: "Скопировать конфиг", onclick: copyConfig })
      ]),
      h("div", { class: "dbg-row" }, [
        h("button", { text: "Сбросить черновик", onclick: resetDraft }),
        h("button", { text: "Закрыть (D)", onclick: function () { toggle(false); } })
      ]),
      status,
      ta,
      h("div", { class: "dbg-help", text:
        "Мышь — нарисовать рамку · тянуть внутри — сдвинуть · колесо — масштаб · стрелки — сдвиг (Shift ×5) · +/− — масштаб · Tab — следующая остановка · D — закрыть" })
    ]);

    root = h("div", { id: "dbg" }, [
      h("div", { class: "dbg-main" }, [cv, h("div", { class: "dbg-badge", text: "debug" })]),
      side
    ]);
    root.style.display = "none";
    document.body.append(root);

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });
    window.addEventListener("resize", function () { if (state.active) { layout(); refresh(); } });
  }

  function setMode(m) {
    state.mode = m;
    masterBox.style.display = m === "master" ? "flex" : "none";
    doorBox.style.display = m === "door" ? "flex" : "none";
    layout();
    refresh();
  }

  function renderList() {
    list.textContent = "";
    SLIDES.forEach(function (s, i) {
      if (s.type === "cover" || !s.camera) return;
      var r = s.camera;
      var it = h("div", { class: "dbg-item" + (i === state.sel ? " on" : ""), onclick: function () { state.sel = i; refresh(); } }, [
        h("span", { text: pad(i + 1) + " · " + s.id }),
        h("small", { text: r.x.toFixed(3) + " " + r.y.toFixed(3) + " " + r.w.toFixed(3) })
      ]);
      list.append(it);
    });
    var items = keySel.children;
    for (var k = 0; k < items.length; k++) items[k].classList.toggle("on", items[k].getAttribute("data-key") === state.doorKey);
    hingeSel.value = CFG.door.hinge || "left";
    var tabs = side.querySelectorAll("[data-mode]");
    for (var t = 0; t < tabs.length; t++) tabs[t].classList.toggle("on", tabs[t].getAttribute("data-mode") === state.mode);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function setStatus(msg) { if (status) status.textContent = msg; }

  /* ---------- Геометрия ----------------------------------------------------- */

  function currentImage() { return state.mode === "master" ? images.master : images.door; }

  function layout() {
    var img = currentImage();
    var rect = cv.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    if (!img) return;
    var W = img.naturalWidth, H = img.naturalHeight, pad = 24 * dpr;
    var s = Math.min((cv.width - pad * 2) / W, (cv.height - pad * 2) / H);
    fit = { s: s, x: (cv.width - W * s) / 2, y: (cv.height - H * s) / 2, W: W, H: H, A: W / H, dpr: dpr };
    var V = window.innerWidth / window.innerHeight;
    var pw = side.clientWidth - 32;
    preview.width = Math.round(pw * dpr);
    preview.height = Math.round(pw / V * dpr);
  }

  // Прямоугольник (доли) ↔ пиксели холста
  function toCanvas(r) { return { x: fit.x + r.x * fit.W * fit.s, y: fit.y + r.y * fit.H * fit.s, w: r.w * fit.W * fit.s, h: r.h * fit.H * fit.s }; }
  function toNorm(px, py) {
    return { x: (px - fit.x) / (fit.W * fit.s), y: (py - fit.y) / (fit.H * fit.s) };
  }

  function selectedRect() {
    if (state.mode === "master") return SLIDES[state.sel] && SLIDES[state.sel].camera;
    return CFG.door[state.doorKey];
  }
  function setSelectedRect(r) {
    r = clampRect(r);
    if (state.mode === "master") SLIDES[state.sel].camera = r;
    else {
      CFG.door[state.doorKey] = r;
      APP.door.layout();
    }
  }
  function ratioLocked() { return state.mode === "master" || DOOR_KEYS[state.doorKey].ratio; }
  // Для 16:9 в пикселях картинки: h(доли) = w(доли) · A · 9/16
  function kRatio() { return fit.A * 9 / 16; }

  function clampRect(r) {
    var x = r.x, y = r.y, w = Math.max(0.01, r.w), hh = Math.max(0.01, r.h);
    if (ratioLocked()) {
      hh = w * kRatio();
      if (hh > 1) { hh = 1; w = hh / kRatio(); }
      if (w > 1) { w = 1; hh = w * kRatio(); }
    }
    w = Math.min(w, 1); hh = Math.min(hh, 1);
    x = Math.min(Math.max(x, 0), 1 - w);
    y = Math.min(Math.max(y, 0), 1 - hh);
    return { x: x, y: y, w: w, h: hh };
  }

  /* ---------- Рисование ----------------------------------------------------- */

  function refresh() {
    if (!state.active) return;
    renderList();
    draw();
    drawPreview();
    var r = selectedRect();
    info.textContent = r ? "{ x: " + r.x.toFixed(4) + ", y: " + r.y.toFixed(4) + ", w: " + r.w.toFixed(4) + ", h: " + r.h.toFixed(4) + " }" : "";
  }

  function draw() {
    var img = currentImage();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0d0907";
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!img) return;
    ctx.drawImage(img, fit.x, fit.y, fit.W * fit.s, fit.H * fit.s);
    var dpr = fit.dpr;
    ctx.font = (12 * dpr) + "px Nunito, sans-serif";
    ctx.textBaseline = "top";

    if (state.mode === "master") {
      SLIDES.forEach(function (s, i) {
        if (s.type === "cover" || !s.camera || s.id === "intro") return;
        drawRect(s.camera, i === state.sel ? "#f4c47c" : "rgba(255,255,255,0.7)", pad(i + 1) + " " + s.id, i === state.sel);
      });
      // Видимая область на текущем экране (cover-кадрирование)
      var sel = SLIDES[state.sel];
      if (sel && sel.camera) {
        var v = APP.camView(sel);
        var A = APP.master.A, V = window.innerWidth / window.innerHeight;
        var vis = { x: (v.cx - v.w / 2) / A, y: v.cy - v.w / V / 2, w: v.w / A, h: v.w / V };
        var c = toCanvas(vis);
        ctx.setLineDash([6 * dpr, 5 * dpr]);
        ctx.strokeStyle = "rgba(244,196,124,0.8)";
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(c.x, c.y, c.w, c.h);
        ctx.setLineDash([]);
      }
    } else {
      Object.keys(DOOR_KEYS).forEach(function (k) {
        var r = CFG.door[k];
        if (!r) return;
        drawRect(r, k === state.doorKey ? "#f4c47c" : DOOR_KEYS[k].color, k, k === state.doorKey);
      });
    }
  }

  function drawRect(r, color, label, selected) {
    var c = toCanvas(r), dpr = fit.dpr;
    ctx.lineWidth = (selected ? 2.5 : 1.25) * dpr;
    ctx.strokeStyle = color;
    ctx.fillStyle = selected ? "rgba(244,196,124,0.12)" : "rgba(255,255,255,0.04)";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    var tw = ctx.measureText(label).width + 10 * dpr;
    ctx.fillStyle = selected ? "#f4c47c" : "rgba(0,0,0,0.65)";
    ctx.fillRect(c.x, c.y - 18 * dpr, tw, 18 * dpr);
    ctx.fillStyle = selected ? "#2b1a10" : "#fff";
    ctx.fillText(label, c.x + 5 * dpr, c.y - 15 * dpr);
  }

  function drawPreview() {
    var img = currentImage();
    pctx.fillStyle = "#000";
    pctx.fillRect(0, 0, preview.width, preview.height);
    if (!img) return;
    var V = preview.width / preview.height;
    var r = state.mode === "master" ? selectedRect() : CFG.door.posterRect;
    if (!r) return;
    var A = img.naturalWidth / img.naturalHeight;
    var v = APP.clampView(APP.rectToView(r, A, V), A, V);
    var hh = v.w / V;
    var sx = (v.cx - v.w / 2) / A * img.naturalWidth, sy = (v.cy - hh / 2) * img.naturalHeight;
    var sw = v.w / A * img.naturalWidth, sh = hh * img.naturalHeight;
    pctx.drawImage(img, sx, sy, sw, sh, 0, 0, preview.width, preview.height);

    if (state.mode === "master" && state.overlay > 0) {
      var s = SLIDES[state.sel];
      var ci = s && s.bg && images.closeups[s.bg];
      if (s && s.bg && !ci) {
        APP.loadImage(APP.closeupSrc(s.bg)).then(function (im) { images.closeups[s.bg] = im; drawPreview(); }, function () {});
      }
      if (ci) {
        var ca = ci.naturalWidth / ci.naturalHeight;
        var dw = preview.width, dh = preview.height, cw, ch;
        if (ca > V) { ch = dh; cw = dh * ca; } else { cw = dw; ch = dw / ca; }
        pctx.globalAlpha = state.overlay;
        pctx.drawImage(ci, (dw - cw) / 2, (dh - ch) / 2, cw, ch);
        pctx.globalAlpha = 1;
      }
    }
  }

  /* ---------- Мышь и клавиатура -------------------------------------------- */

  function point(e) {
    var rect = cv.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * fit.dpr, y: (e.clientY - rect.top) * fit.dpr };
  }
  function inside(p, r) {
    var c = toCanvas(r);
    return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
  }

  function onDown(e) {
    if (!currentImage()) return;
    cv.setPointerCapture(e.pointerId);
    var p = point(e), r = selectedRect();
    // Клик по чужой рамке на мастере — выбрать её
    if (state.mode === "master" && !(r && inside(p, r))) {
      for (var i = SLIDES.length - 1; i >= 0; i--) {
        var s = SLIDES[i];
        if (i !== state.sel && s.camera && s.type !== "cover" && s.id !== "intro" && inside(p, s.camera) && !e.shiftKey) {
          state.sel = i;
          refresh();
          r = s.camera;
          break;
        }
      }
    }
    if (r && inside(p, r) && !e.shiftKey) {
      state.drag = { type: "move", start: toNorm(p.x, p.y), orig: { x: r.x, y: r.y, w: r.w, h: r.h } };
    } else {
      state.drag = { type: "draw", start: toNorm(p.x, p.y) };
    }
  }

  function onMove(e) {
    var d = state.drag;
    if (!d) return;
    var p = point(e), n = toNorm(p.x, p.y);
    if (d.type === "move") {
      setSelectedRect({ x: d.orig.x + n.x - d.start.x, y: d.orig.y + n.y - d.start.y, w: d.orig.w, h: d.orig.h });
    } else {
      var dx = n.x - d.start.x, dy = n.y - d.start.y;
      var w = Math.abs(dx), hh = Math.abs(dy);
      if (ratioLocked()) {
        var k = kRatio();
        if (hh / k > w) w = hh / k;
        hh = w * k;
      }
      if (w < 0.004 && hh < 0.004) return;
      setSelectedRect({ x: dx < 0 ? d.start.x - w : d.start.x, y: dy < 0 ? d.start.y - hh : d.start.y, w: w, h: hh });
    }
    refresh();
  }

  function onUp() {
    if (state.drag) { state.drag = null; saveDraft(); refresh(); }
  }

  function scaleSelected(f) {
    var r = selectedRect();
    if (!r) return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2, w = r.w * f, hh = r.h * f;
    setSelectedRect({ x: cx - w / 2, y: cy - hh / 2, w: w, h: hh });
    refresh();
  }

  var wheelSave = 0;
  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    scaleSelected(e.deltaY > 0 ? 1.04 : 1 / 1.04);
    clearTimeout(wheelSave);
    wheelSave = setTimeout(saveDraft, 300);
  }

  function onKey(e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if ((e.key === "d" || e.key === "D" || e.key === "в" || e.key === "В") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle(!state.active);
      return;
    }
    if (!state.active) return;
    e.stopImmediatePropagation();
    var r = selectedRect(), step = e.shiftKey ? 0.01 : 0.002;
    var handled = true;
    if (e.key === "Escape") toggle(false);
    else if (e.key === "ArrowLeft" && r) setSelectedRect({ x: r.x - step, y: r.y, w: r.w, h: r.h });
    else if (e.key === "ArrowRight" && r) setSelectedRect({ x: r.x + step, y: r.y, w: r.w, h: r.h });
    else if (e.key === "ArrowUp" && r) setSelectedRect({ x: r.x, y: r.y - step, w: r.w, h: r.h });
    else if (e.key === "ArrowDown" && r) setSelectedRect({ x: r.x, y: r.y + step, w: r.w, h: r.h });
    else if (e.key === "+" || e.key === "=") scaleSelected(1 / 1.03);
    else if (e.key === "-" || e.key === "_") scaleSelected(1.03);
    else if (e.key === "Tab") {
      if (state.mode === "master") {
        var dir = e.shiftKey ? -1 : 1, i = state.sel;
        do { i = (i + dir + SLIDES.length) % SLIDES.length; } while (SLIDES[i].type === "cover" || SLIDES[i].id === "intro" || !SLIDES[i].camera);
        state.sel = i;
      } else {
        var keys = Object.keys(DOOR_KEYS);
        state.doorKey = keys[(keys.indexOf(state.doorKey) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
      }
    } else handled = false;
    if (handled) {
      e.preventDefault();
      refresh();
      if (e.key.indexOf("Arrow") === 0 || e.key === "+" || e.key === "-" || e.key === "=") {
        clearTimeout(wheelSave);
        wheelSave = setTimeout(saveDraft, 300);
      }
    }
  }

  /* ---------- Действия ------------------------------------------------------ */

  function configText() {
    var d = snapshot();
    var lines = ["window.CONFIG.calibration = {", "  cameras: {"];
    var ids = Object.keys(d.cameras);
    ids.forEach(function (id, i) {
      var r = d.cameras[id];
      lines.push("    " + JSON.stringify(id) + ": " + rectText(r) + (i < ids.length - 1 ? "," : ""));
    });
    lines.push("  },");
    lines.push("  door: {");
    lines.push("    hinge: " + JSON.stringify(d.door.hinge) + ",");
    lines.push("    rect: " + rectText(d.door.rect) + ",");
    lines.push("    posterRect: " + rectText(d.door.posterRect) + (d.door.paperRect ? "," : ""));
    if (d.door.paperRect) lines.push("    paperRect: " + rectText(d.door.paperRect));
    lines.push("  }");
    lines.push("};");
    return lines.join("\n");
  }
  function rectText(r) {
    var f = function (v) { return v.toFixed(4); };
    return "{ x: " + f(r.x) + ", y: " + f(r.y) + ", w: " + f(r.w) + ", h: " + f(r.h) + " }";
  }

  function copyConfig() {
    var text = configText();
    ta.value = text;
    var fallback = function () {
      ta.style.display = "block";
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) {}
      setStatus(ok ? "Скопировано. Замените блок calibration в config.js" : "Выделите текст ниже и скопируйте вручную (Ctrl+C)");
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        ta.style.display = "block";
        setStatus("Скопировано. Замените блок calibration в config.js");
      }, fallback);
    } else fallback();
  }

  function resetDraft() {
    try { localStorage.removeItem(STORE); } catch (e) {}
    setStatus("Черновик удалён — перезагружаю страницу…");
    setTimeout(function () { location.reload(); }, 600);
  }

  function showStop() {
    var i = state.mode === "master" ? state.sel : 0;
    toggle(false);
    APP.nav.index = i;
    APP.nav.updateUI();
    APP.nav.writeHash();
    APP.applyInstant(i);
    APP.toast("D — вернуться в калибровку", 2500);
  }

  function toggle(on) {
    if (on === state.active) return;
    if (on) {
      if (!root) build();
      enabled = true;
      state.active = true;
      APP.nav.inputEnabled = false;
      root.style.display = "flex";
      images.master = APP.master.preview;
      APP.loadImage(CFG.assets.door).then(function (img) { images.door = img; layout(); refresh(); });
      var cur = APP.nav.index;
      if (SLIDES[cur] && SLIDES[cur].type !== "cover" && SLIDES[cur].id !== "intro" && SLIDES[cur].camera) state.sel = cur;
      setMode(state.mode);
    } else {
      state.active = false;
      APP.nav.inputEnabled = true;
      if (root) root.style.display = "none";
      // Применить изменения к текущей остановке
      if (!APP.nav.busy) APP.applyInstant(APP.nav.index);
    }
  }

  window.addEventListener("keydown", onKey, true);

  // ?debug=1 — открыть калибровку сразу после загрузки
  if (enabled) {
    var wait = setInterval(function () {
      if (APP.master && APP.master.preview && document.getElementById("loader").classList.contains("done")) {
        clearInterval(wait);
        toggle(true);
      }
    }, 150);
  }
})();
