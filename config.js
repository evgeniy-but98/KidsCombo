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
  // Отсутствующие поля не рендерятся. Картинка без src — серый плейсхолдер.
  stops: {
    intro: { content: { layout: "none" } },

    master: {
      content: {
        layout: "title", side: "bottom", theme: "dark",
        kicker: "Сцена 02",
        title: "Сцена 02 — master",
        text: "Общий план комнаты: вечер, снег за окном, ёлка и стол, за которым Комбик готовит подарки.",
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
        layout: "text", side: "left", theme: "dark",
        kicker: "Сцена 06",
        title: "Сцена 06 — scene06",
        text: [
          "Лорем ипсум долор сит амет, консектетур адиписцинг элит, сед до эиусмод темпор инцидидунт ут лаборе эт долоре магна аликуа.",
          "Ут эним ад миним вениам, квис ноструд экзерцитатион улламко лаборис ниси ут аликвип экс эа коммодо консекват.",
        ],
      },
    },

    scene07: {
      content: {
        layout: "gallery", side: "center", theme: "dark",
        kicker: "Сцена 07",
        title: "Сцена 07 — scene07",
      },
    },

    scene08: {
      content: {
        layout: "palette", side: "right", theme: "light",
        kicker: "Сцена 08",
        title: "Сцена 08 — scene08",
        text: "Палитра сцены.",
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

    scene09: {
      content: {
        layout: "quote", side: "center", theme: "dark",
        kicker: "Сцена 09",
        text: "Лорем ипсум долор сит амет — крупная фраза, ради которой всё затевалось.",
        caption: "Сцена 09 — scene09",
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
