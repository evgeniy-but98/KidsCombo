// Тур, контент слайдов и параметры рёбер. Подключается обычным <script>, пишет в window.CONFIG.
// Видео, постеры и рёбра графа берутся из assets/manifest.js (его генерирует scripts/optimize.ps1).
window.CONFIG = {
  // Порядок слайдов: кнопки вперёд/назад, точки прогресса, location.hash.
  // id без файлов в манифесте показывается заглушкой «кадр в работе».
  tour: ["intro", "master", "closeup", "globes", "empty", "scene06", "scene07", "scene08", "scene09"],

  defaults: {
    join: "crossfade",   // как пролёт переходит в цикл: cut | crossfade | push
    joinDuration: 0.5,   // с
    loopExitFade: 0.3,   // кроссфейд из текущего кадра цикла в первый кадр пролёта, с
    waitLoopEnd: false,  // true: дождаться конца итерации цикла перед пролётом…
    maxWait: 2,          // …но не дольше, с
    transitSpeed: 1.25,  // ускорение промежуточных сегментов длинного пути
    loopMode: "loop",    // loop: атрибут loop | pingpong: два элемента по очереди (если на стыке рывок)
    push: { outScale: 1.15, outBlur: 6, inScale: 0.94, inBlur: 8 }, // параметры склейки push
    stub: "fade",        // заглушка для ребра без видео: fade | push | doors
    stubDuration: 1.2,   // с
    textLead: 0.3,       // текст уходит за столько секунд до начала пролёта
    textDelay: 1.5,      // сначала чистый кадр, текст проявляется через столько секунд после прихода на остановку
  },

  // Настройки рёбер "from>to" поверх defaults: join, joinDuration, loopExitFade, waitLoopEnd, maxWait, push.
  // Авто-реверс (обратный пролёт без своего файла) наследует склейку зеркально — на старте.
  // Пример: "a>b": { join: "push", joinDuration: 0.9 } — если конец пролёта не совпадает с циклом цели.
  edges: {},

  // Заглушки для рёбер, у которых ещё нет видео. Обратное направление — зеркально.
  // Как только появится tr__<from>__<to>.mp4 и манифест пересобран, вместо заглушки играет видео.
  stubs: {
    "intro>master": { type: "doors", duration: 2 },
    "closeup>globes": { type: "push", duration: 1 }, // наезд со стола на шары, пока нет своего пролёта
  },

  music: { volume: 0.5, fadeIn: 2.5, fadeOut: 1.2 },

  // Контент слайдов. layout: none | title | text | text-image | gallery | palette | quote | video
  // side: left | right | center | top | bottom — где в кадре свободное место под текст
  // theme: dark (светлый текст на тёмной подложке) | light (наоборот)
  // box: { x, y, w } — место плашки в процентах видеокадра (левый верхний угол и ширина), без y — внизу над навигацией;
  //   на телефоне и узких окнах такая плашка сворачивается до заголовка, текст — по кнопке «Читать»
  // mobile: где свёрнутая плашка на телефоне — "top" (вверху слева, по умолчанию) | "bottom" (над навигацией) | "box" (там же, где box)
  // size: "compact" — плашка меньше; scrim: false — без затемнения кадра; more: { title, colors } — раскрываемая палитра
  //   (на экране — только образцы и названия, HEX остаются здесь как данные)
  // stops.<id>.mobileFrame — на телефоне и узких окнах кадр целиком вместо обрезки cover:
  //   { fit: "contain", fill: "ambient" (размытое продолжение кадра) | "glow" (тёмная дымка, tint: "r g b"), frame: "card" (скругление) }
  // Отсутствующие поля не рендерятся. Картинка без src — серый плейсхолдер.
  stops: {
    intro: { content: { layout: "none" } },

    master: {
      content: {
        layout: "title", side: "bottom", theme: "dark",
        box: { x: 6, w: 33 }, mobile: "bottom", // левее Комбика и шаров (они с 43% ширины кадра)
        kicker: "Сцена 02",
        title: "Войдём в историю",
        text: "Спасибо за подробный бриф. Предлагаем пройти эту историю вместе с камерой — от подарков Комбика до улыбки Деда Мороза.",
      },
    },

    closeup: {
      content: {
        layout: "text", side: "top", theme: "dark",
        kicker: "Сцена 03",
        title: "Сцена 03 — closeup",
        text: "Крупный план: Комбик дремлет за столом среди бумажных снежинок и снежных шаров.",
      },
    },

    globes: {
      content: {
        layout: "text-image", side: "left", theme: "dark",
        kicker: "Сцена 04",
        title: "Сцена 04 — globes",
        text: "Лорем ипсум долор сит амет, консектетур адиписцинг элит. Три снежных шара с табличками: маме, папе, брату.",
        images: [{ caption: "Референс: шар со снеговиком" }],
      },
    },

    empty: {
      content: {
        layout: "title", side: "right", theme: "dark",
        kicker: "Сцена 05",
        title: "Сцена 05 — empty",
        text: "Табличка «Деду Морозу» уже стоит, а шара для него пока нет.",
      },
    },

    scene06: {
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 5, y: 7, w: 25 }, // свободный фон слева сверху: шар с 35% ширины, варежки ниже 40% высоты
        kicker: "Сцена 06",
        title: "Подарок нашёл адресата",
        text: "Теперь мы смотрим на шар глазами Деда Мороза. Снаружи тихо падает снег, внутри кружатся снежинки.",
      },
    },

    scene07: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне одновременно шар и лицо
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 4, y: 3, w: 41 }, // над шаром (он с 25% высоты), левее шапки и бороды (с 45% ширины)
        kicker: "Сцена 07",
        title: "Мгновение тишины",
        text: "Дед Мороз бережно встряхивает шар и следит, как снежинки опускаются вокруг маленькой фигурки.",
      },
    },

    scene08: {
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 4, y: 10, w: 24 }, // синий фон слева от лица (лицо с 32% ширины кадра)
        kicker: "Сцена 08",
        title: "Ответ без слов",
        text: "Лёгкая улыбка вместо большого жеста. Так мы понимаем, что подарок Комбика тронул Деда Мороза.",
        more: {
          title: "Свет и цвет",
          colors: [
            { hex: "#E8612C", name: "Оранжевый Комбо" },
            { hex: "#1F5A3D", name: "Ёлочный зелёный" },
            { hex: "#7A3E1D", name: "Тёплое дерево" },
            { hex: "#F6B04A", name: "Янтарный свет" },
            { hex: "#F4EAD8", name: "Снежный крем" },
            { hex: "#1D3264", name: "Ночное окно" },
          ],
        },
      },
    },

    scene09: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне все игрушки, коробка и оба логотипа
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 3.5, y: 27, w: 44 }, mobile: "box", // под логотипами (до 25% высоты), над игрушками (с 49%)
        kicker: "Сцена 09",
        title: "Финальный кадр",
        text: "Игрушки и Кидз Комбо собираются в одном ясном продуктовом кадре. Ёлка остаётся мягким светом на фоне.",
      },
    },

    scene10: {
      content: {
        layout: "video", side: "center", theme: "dark",
        kicker: "Сцена 10",
        title: "Сцена 10 — scene10",
        video: "assets/video/tr__master__closeup.mp4",
        poster: "assets/poster/tr__master__closeup.first.webp",
        caption: "Аниматик (пример: пролёт к столу)",
      },
    },
  },
};
