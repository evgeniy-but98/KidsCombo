// Тур, контент слайдов и параметры рёбер. Подключается обычным <script>, пишет в window.CONFIG.
// Видео, постеры и рёбра графа берутся из assets/manifest.js (его генерирует scripts/optimize.ps1).
window.CONFIG = {
  // Порядок слайдов: кнопки вперёд/назад, точки прогресса, location.hash.
  // id без файлов в манифесте показывается заглушкой «кадр в работе».
  // После scene10 (логотип) — разделы тритмента о режиссёрском решении, в 20 секунд ролика не входят.
  tour: ["intro", "master", "closeup", "globes", "empty", "scene06", "scene07", "scene08", "scene09", "scene10", "color", "world", "rhythm"],

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

  // Контент слайдов. layout: none | title | text | text-image | gallery | palette | quote | video | timeline
  // side: left | right | center | top | bottom — где в кадре свободное место под текст
  // theme: dark (светлый текст на тёмной подложке) | light (наоборот)
  // box: { x, y, w, max } — место плашки в процентах видеокадра (левый верхний угол и ширина; max — предел ширины в rem),
  //   без y — внизу над навигацией; на телефоне и узких окнах такая плашка сворачивается до заголовка, текст — по «Читать»
  // mobile: где свёрнутая плашка на телефоне — "top" (вверху слева, по умолчанию) | "bottom" (над навигацией) | "box" (там же, где box)
  // size: "compact" — плашка меньше | "strip" — компактная полоса: заголовок слева, текст справа
  // scrim: false — без затемнения кадра; more: { title, colors } — раскрываемая палитра
  //   (на экране — только образцы и названия, HEX остаются здесь как данные)
  // gallery: cols — число колонок, flow: true — стрелки между кадрами (последовательность), wide: true — шире плашка
  // timeline: [{ t, label, poster }] — хронометраж (ширина отрезка пропорциональна t); notes: [{ term, text }]; caption — строка или список
  // textDelay — своя пауза перед текстом (с), по умолчанию defaults.textDelay
  // stops.<id>.mobileFrame — на телефоне и узких окнах кадр целиком вместо обрезки cover:
  //   { fit: "contain", fill: "ambient" (размытое продолжение кадра) | "glow" (тёмная дымка, tint: "r g b"), frame: "card" (скругление) }
  // stops.<id>.frame — кадр целиком на любом экране: { fit: "contain", background } (логотип 2:1, поля цветом фона ролика)
  // stops.<id>.backdrop — фон раздела без своего видео: утверждённый кадр, размытый и затемнённый
  // stops.<id>.section — раздел тритмента после истории (другая точка в навигации)
  // Отсутствующие поля не рендерятся. Картинка без src — серый плейсхолдер.
  stops: {
    intro: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне название на дверях целиком
      content: { layout: "none", label: "Обложка" }, // label — подпись точки навигации, когда нет заголовка
    },

    master: {
      content: {
        layout: "title", side: "bottom", theme: "dark",
        box: { x: 6, w: 33 }, mobile: "bottom", // левее Комбика и шаров (они с 43% ширины кадра)
        kicker: "Сцена 02",
        title: "Войдём в историю",
        text: "Спасибо за подробный бриф. Предлагаем пройти вслед за камерой: от тихой комнаты Комбика к неожиданному адресату последнего подарка.",
      },
    },

    closeup: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне видны записки и подарки
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 74, y: 7, w: 23, avoid: "below" }, // справа над ёлкой: Комбик до 61% ширины, шары и записки ниже 53% высоты
        kicker: "Сцена 03",
        title: "Всё начинается за столом",
        text: "Медленно приближаемся к уснувшему Комбику. Свет лампы собирает внимание на нём, записках и подарках; комната остаётся мягким фоном.",
      },
    },

    globes: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне все три шара
      content: {
        layout: "text", theme: "dark", size: "strip", scrim: false,
        box: { x: 29, y: 2, w: 68, max: 80, avoid: "left" }, // полоса над шарами (их верх — 20% высоты), правее головы Комбика
        kicker: "Сцена 04",
        title: "Подарки для близких",
        text: "Проходим вдоль трёх шаров — маме, папе и брату. Фон успокаивается: фигурки и медленный снег внутри стекла удерживают взгляд.",
      },
    },

    empty: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне записка и пустое место
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 71, y: 8, w: 26, avoid: "below" }, // справа над столом: записка «Деду Морозу» и пустое место — 38–70% ширины
        kicker: "Сцена 05",
        title: "Четвёртая записка",
        text: "Продолжаем то же движение вправо. На месте последнего шара — только записка «Деду Морозу». Небольшая пауза меняет наше ожидание.",
      },
    },

    scene06: {
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 5, y: 7, w: 25 }, // свободный фон слева сверху: шар с 35% ширины, варежки ниже 40% высоты
        kicker: "Сцена 06",
        title: "Подарок нашёл адресата",
        text: "Смотрим на шар глазами Деда Мороза. В центре — стекло и тёплый свет, вокруг — глубокая синяя зимняя ночь.",
      },
    },

    scene07: {
      mobileFrame: { fit: "contain", fill: "ambient", frame: "card" }, // на телефоне одновременно шар и лицо
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 4, y: 3, w: 41 }, // над шаром (он с 25% высоты), левее шапки и бороды (с 45% ширины)
        kicker: "Сцена 07",
        title: "Один бережный жест",
        text: "Дед Мороз слегка встряхивает шар и задерживает на нём взгляд. Камера отступает, чтобы увидеть его реакцию.",
      },
    },

    scene08: {
      content: {
        layout: "text", theme: "dark", size: "compact", scrim: false,
        box: { x: 4, y: 10, w: 24 }, // синий фон слева от лица (лицо с 32% ширины кадра)
        kicker: "Сцена 08",
        title: "Ответ без слов",
        text: "Едва заметная улыбка завершает маленькую историю подарка. Эмоция возникает из паузы, без крупного жеста.",
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
        box: { x: 3.5, y: 27, w: 52, max: 52 }, mobile: "box", // под логотипами (до 25% высоты), над игрушками (с 49%), левее коробки (с 59%)
        kicker: "Сцена 09",
        title: "Финальный кадр",
        // замысел, а не готовая анимация: в текущем видео постановки шара ещё нет
        text: "В готовом ролике варежка Деда Мороза бережно поставит его шар рядом с остальными. Затем оставим ясный пэкшот: три игрушки, Кидз Комбо и логотипы.",
      },
    },

    // Логотип ВиТ (once__scene10.mp4, 1440×720, 1,48 с): играет один раз и остаётся на последнем кадре.
    // Формат 2:1 — кадр целиком, поля того же зелёного, что фон ролика. Без текстовой плашки.
    scene10: {
      frame: { fit: "contain", background: "#275234" }, // фон ролика в браузере (ролик размечен BT.709)
      content: { layout: "none", label: "Логотип" },
    },

    // ---------- разделы тритмента: после истории, в 20 секунд ролика не входят ----------
    color: {
      section: true, backdrop: "assets/poster/stop__scene06.first.webp",
      content: {
        layout: "gallery", side: "center", theme: "dark", scrim: false, wide: true, cols: 5, flow: true, textDelay: 0.3,
        kicker: "Режиссёрское решение",
        title: "Путь цвета",
        text: "Свет ведёт историю от тепла комнаты через синюю зимнюю ночь обратно к теплу. Герои и игрушки при этом сохраняют собственные цвета — без жёлтого или зелёного налёта.",
        images: [
          { src: "assets/poster/stop__master.first.webp", caption: "Тёплая комната и лампа" },
          { src: "assets/poster/stop__globes.first.webp", caption: "Спокойнее: крупный план шаров" },
          { src: "assets/poster/stop__scene06.first.webp", caption: "Насыщенная синяя зимняя ночь" },
          { src: "assets/poster/stop__scene08.first.webp", caption: "Тепло лица Деда Мороза" },
          { src: "assets/poster/stop__scene09.first.webp", caption: "Ясный продуктовый финал" },
        ],
      },
    },

    world: {
      section: true, backdrop: "assets/poster/stop__closeup.first.webp",
      content: {
        layout: "gallery", side: "center", theme: "dark", scrim: false, wide: true, cols: 4, textDelay: 0.3,
        kicker: "Режиссёрское решение",
        title: "Как устроен мир",
        text: "Одна комната и одно непрерывное движение камеры. Иллюстрации — утверждённые кадры ролика.",
        images: [
          { src: "assets/poster/stop__master.first.webp", caption: "Камера движется без склеек: из комнаты к столу и дальше вдоль шаров" },
          { src: "assets/poster/stop__closeup.first.webp", caption: "Передний план и герой читаются ясно, фон мягче" },
          { src: "assets/poster/stop__globes.first.webp", caption: "Новогодние детали и брендинг вписаны сдержанно" },
          { src: "assets/poster/stop__scene07.first.webp", caption: "Дед Мороз — в одном мире с Комбиком: русский костюм, без облика Санты и реалистичной бороды" },
        ],
      },
    },

    rhythm: {
      section: true, backdrop: "assets/poster/stop__scene09.first.webp",
      content: {
        layout: "timeline", side: "center", theme: "dark", scrim: false, wide: true, textDelay: 0.3,
        kicker: "Режиссёрское решение",
        title: "Ритм и звук",
        text: "Хронометраж 20-секундного ролика.",
        timeline: [
          { t: 3.5, label: "Дверь и комната", poster: "assets/poster/stop__master.first.webp" },
          { t: 4.5, label: "Шары и пустое место", poster: "assets/poster/stop__globes.first.webp" },
          { t: 2, label: "Шар в варежках", poster: "assets/poster/stop__scene06.first.webp" },
          { t: 2, label: "Дед Мороз встряхивает шар", poster: "assets/poster/stop__scene07.first.webp" },
          { t: 1, label: "Улыбка", poster: "assets/poster/stop__scene08.first.webp" },
          { t: 5, label: "Пэкшот и постановка шара", poster: "assets/poster/stop__scene09.first.webp" },
          { t: 2, label: "Логотип", poster: "assets/poster/once__scene10.last.webp" },
        ],
        notes: [
          { term: "Голос", text: "Детский голос рассказчика." },
          { term: "Музыка", text: "Мягкая зимняя тема с нарастанием к финалу." },
          { term: "Звуки", text: "Деликатные: дверь, снег, шар." },
        ],
        caption: [
          "Состав финальных материалов для ТВ и OLV сверяется с брифом.",
          "Интерактивные остановки сайта могут длиться дольше: это способ рассмотреть замысел, а не хронометраж рекламного ролика.",
        ],
      },
    },
  },
};
