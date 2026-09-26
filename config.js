 /*
  Конфигурация тритмента «Новогодняя комната».
  Порядок слайдов = порядок в массиве slides. Движок от него не зависит.

  Координаты — доли размера картинки (0…1): { x, y, w, h }, где x/y — левый верхний угол.
  camera   — рамка остановки на мастер-кадре (16:9). Удобнее всего размечать в режиме
             калибровки: откройте index.html?debug=1 (или нажмите D).
  theme    — "light" (тёмный текст на светлом фоне) | "dark" (светлый текст на тёмном)
  layout   — где на фоне свободное место под текст: "center" | "left" | "right"
  backdrop — "strong", если фон пёстрый и тексту нужна подложка плотнее (необязательно)
  content  — содержимое слайда, шаблон задаётся полем content.layout:
             title | text | text-image | gallery | palette | quote | video
             (примеры каждого шаблона — в README.md, раздел «Как добавить контент»)
*/
window.CONFIG = {
  title: "Новогодняя комната",

  assets: {
    master: "assets/master.webp",          // мастер-кадр в полном разрешении
    masterPreview: "assets/master-2k.webp", // лёгкая копия для быстрого старта
    door: "assets/door.webp",
    closeups: "assets/{bg}.webp",          // шаблон пути к крупному плану по slug
    music: ["assets/music.ogg", "assets/music.mp3"]
  },

  settings: {
    kenBurns: true,        // медленный дрейф крупного плана на остановке
    kenBurnsScale: 1.03,
    kenBurnsDuration: 20,  // секунды
    musicVolume: 0.5,
    musicFadeIn: 2.5,      // секунды
    wheelThreshold: 60,
    wheelReset: 200,       // мс тишины, после которых накопленный deltaY сбрасывается
    cooldown: 400,         // мс блокировки ввода после перехода
    effects: true          // снег, мерцание, параллакс (этап 6)
  },

  // Обложка: дверь из коридора
  door: {
    hinge: "left",                                          // сторона петель: "left" | "right"
    rect:       { x: 0.375, y: 0.051, w: 0.252, h: 0.840 }, // полотно двери на door.webp
    posterRect: { x: 0.293, y: 0.118, w: 0.420, h: 0.420 }, // кадр камеры на обложке (16:9)
    paperRect:  { x: 0.418, y: 0.153, w: 0.170, h: 0.352 }, // лист плаката — область под текст
    content: {
      kicker: "Режиссёрский тритмент",
      title: "Новогодняя комната",
      subtitle: "анимационный проект",
      button: "Открыть"
    }
  },

  slides: [
    {
      id: "cover",
      type: "cover"
    },
    {
      id: "intro",
      bg: null, // без крупного плана — общий план комнаты
      camera: { x: 0, y: 0, w: 1, h: 1 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "title",
        kicker: "Сцена 01",
        title: "Общий план",
        subtitle: "Лорем ипсум долор сит амет, консектетур адиписцинг элит — тёплая комната в новогоднюю ночь."
      },
      effects: { flicker: { x: 54, y: 52 } } // мерцание камина (x, y — центр пятна в % экрана)
    },
    {
      id: "window",
      bg: "window",
      camera: { x: 0.120, y: 0.000, w: 0.240, h: 0.240 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "text",
        kicker: "Сцена 02",
        title: "Окно",
        text: [
          "Лорем ипсум долор сит амет, консектетур адиписцинг элит. Сед до эиусмод темпор инцидидунт ут лаборе эт долоре магна аликва.",
          "Ут эним ад миним вениам, квис ноструд экзерцитатион улламко лаборис ниси ут аликвип экс эа коммодо консекват."
        ]
      },
      effects: { snow: true }
    },
    {
      id: "snowglobe",
      bg: "snowglobe",
      camera: { x: 0.083, y: 0.375, w: 0.160, h: 0.160 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "quote",
        kicker: "Сцена 03 — Снежный шар",
        quote: "Лорем ипсум долор сит амет — целый город помещается в ладони.",
        author: "Ключевая фраза"
      },
      effects: { snow: true }
    },
    {
      id: "milk",
      bg: "milk",
      camera: { x: 0.170, y: 0.426, w: 0.120, h: 0.120 },
      theme: "light",
      layout: "center",
      content: {
        layout: "text",
        kicker: "Сцена 04",
        title: "Стакан молока",
        text: "Лорем ипсум долор сит амет, консектетур адиписцинг элит. Дуис ауте ируре долор ин репрехендерит ин волуптате велит эссе."
      }
    },
    {
      id: "letter",
      bg: "letter",
      camera: { x: 0.106, y: 0.477, w: 0.240, h: 0.240 },
      theme: "light",
      layout: "center",
      content: {
        layout: "text-image",
        side: "right", // картинка справа, текст слева
        kicker: "Сцена 05",
        title: "Письмо Деду Морозу",
        text: "Лорем ипсум долор сит амет, консектетур адиписцинг элит. Экзерцитатион улламко лаборис ниси ут аликвип.",
        images: [""], // пустой путь = серый плейсхолдер
        caption: "Референс: детский рисунок"
      }
    },
    {
      id: "tangerines",
      bg: "tangerines",
      camera: { x: 0.226, y: 0.416, w: 0.120, h: 0.120 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "palette",
        kicker: "Сцена 06 — Мандарины",
        title: "Цветовое решение",
        text: "Лорем ипсум долор сит амет: тёплый свет против холодной ночи за окном.",
        colors: [
          { hex: "#16213F", name: "Ночное небо" },
          { hex: "#F2A33A", name: "Свет камина" },
          { hex: "#E8742A", name: "Мандарин" },
          { hex: "#B3202A", name: "Гирлянда" },
          { hex: "#2F5D3A", name: "Хвоя" },
          { hex: "#F4E6CC", name: "Молоко" }
        ]
      }
    },
    {
      id: "frame",
      bg: "frame",
      camera: { x: 0.578, y: 0.101, w: 0.160, h: 0.160 },
      theme: "light",
      layout: "center",
      content: {
        layout: "gallery",
        kicker: "Сцена 07 — Рамка",
        title: "Мудборд",
        images: [
          { src: "", caption: "Настроение" },
          { src: "", caption: "Свет" },
          { src: "", caption: "Фактуры" },
          { src: "", caption: "Персонаж" }
        ]
      }
    },
    {
      id: "clock",
      bg: "clock",
      camera: { x: 0.410, y: 0.021, w: 0.220, h: 0.220 },
      theme: "light",
      layout: "right",
      content: {
        layout: "title",
        kicker: "Сцена 08",
        title: "Часы",
        subtitle: "Без пяти двенадцать. Лорем ипсум долор сит амет."
      }
    },
    {
      id: "fireplace",
      bg: "fireplace",
      camera: { x: 0.367, y: 0.266, w: 0.360, h: 0.360 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "video",
        kicker: "Сцена 09",
        title: "Камин",
        video: "", // например "assets/content/animatic.mp4"; пустой путь = плейсхолдер
        poster: "",
        caption: "Аниматик сцены"
      },
      effects: { flicker: true }
    },
    {
      id: "ornament",
      bg: "ornament",
      camera: { x: 0.768, y: 0.229, w: 0.120, h: 0.120 },
      theme: "dark",
      layout: "center",
      content: {
        layout: "text-image",
        side: "left",
        kicker: "Сцена 10",
        title: "Ёлочная игрушка",
        text: "Лорем ипсум долор сит амет, консектетур адиписцинг элит. В отражении шара — вся комната.",
        images: [""],
        caption: "Референс: отражение"
      }
    },
    {
      id: "train",
      bg: "train",
      camera: { x: 0.628, y: 0.488, w: 0.140, h: 0.140 },
      theme: "dark",
      layout: "right",
      content: {
        layout: "text",
        kicker: "Сцена 11",
        title: "Железная дорога",
        text: "Лорем ипсум долор сит амет, консектетур адиписцинг элит. Сед до эиусмод темпор инцидидунт."
      }
    },
    {
      id: "gift",
      bg: "gift",
      camera: { x: 0.697, y: 0.447, w: 0.200, h: 0.200 },
      theme: "light",
      layout: "left",
      content: {
        layout: "gallery",
        kicker: "Сцена 12 — Подарок",
        title: "Раскадровка",
        images: [
          { src: "", caption: "Кадр 1" },
          { src: "", caption: "Кадр 2" },
          { src: "", caption: "Кадр 3" }
        ]
      }
    },
    {
      id: "teddy",
      bg: "teddy",
      camera: { x: 0.840, y: 0.528, w: 0.160, h: 0.160 },
      theme: "light",
      layout: "left",
      backdrop: "strong", // пёстрый фон — подложка под текстом плотнее
      content: {
        layout: "text",
        kicker: "Сцена 13",
        title: "Мишка",
        text: [
          "Лорем ипсум долор сит амет, консектетур адиписцинг элит.",
          "Ут эним ад миним вениам, квис ноструд экзерцитатион."
        ]
      }
    },
    {
      id: "sky",
      bg: "sky",
      camera: { x: 0.130, y: 0.020, w: 0.180, h: 0.180 }, // наезд на окно на мастер-кадре
      transition: "glass", // переход «сквозь стекло»
      theme: "dark",
      layout: "center",
      content: {
        layout: "title",
        kicker: "Финал",
        title: "С Новым годом!",
        subtitle: "Лорем ипсум долор сит амет — спасибо за внимание."
      },
      effects: { snow: true }
    }
  ]
};

/*
  Результат калибровки. Откройте index.html?debug=1, разметьте рамки и нажмите
  «Скопировать конфиг» — затем замените этот блок целиком тем, что в буфере обмена.
  Значения отсюда перекрывают camera у слайдов и координаты двери выше.
*/
window.CONFIG.calibration = null;
