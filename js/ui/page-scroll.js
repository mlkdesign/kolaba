/* Кто именно скроллит длинные экраны.

   В вебе это сам документ — только когда двигается корневой скроллер, Safari
   сворачивает свою нижнюю панель. Внутри мокапа айфона документ скроллиться не
   может: приложение лежит в коробке фиксированного размера, а шапки и нижнее
   меню там не могут быть position: fixed (это привязало бы их к окну браузера,
   а не к экрану телефона). Поэтому в мокапе скроллером снова становится
   контейнер контента внутри экрана.

   Разметка в обоих режимах одна и та же — меняется только элемент, у которого
   спрашивают позицию. Режим включает класс is-mockup на <html>. */

const inMockup = () => document.documentElement.classList.contains('is-mockup');

/* Контейнеры, которые скроллятся внутри мокапа. Порядок важен: экран проекта
   лежит поверх ленты проектов, поэтому проверяется первым. */
const MOCKUP_SCROLLERS = [
  '.project-detail.is-mounted .project-detail__scroll',
  '.profile-scroll',
  '.settings-scroll',
  '.notifications-list',
  '.messages-list-view .messages-list',
  '.projects-page.is-active'
];

function mockupScroller() {
  const screen = document.querySelector('.screen-page.is-active');
  if (!screen) return null;
  for (const selector of MOCKUP_SCROLLERS) {
    const el = screen.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/** Текущая позиция прокрутки экрана. */
function pageScrollTop() {
  if (!inMockup()) return window.scrollY;
  return mockupScroller()?.scrollTop || 0;
}

function scrollPageTo(top, behavior = 'auto') {
  if (!inMockup()) {
    window.scrollTo({ top, behavior });
    return;
  }
  mockupScroller()?.scrollTo({ top, behavior });
}

/* Слушаем в фазе перехвата на документе: событие scroll не всплывает, но
   перехватывается — так один и тот же вызов работает и для документа,
   и для контейнера внутри мокапа. */
function onPageScroll(handler) {
  document.addEventListener('scroll', handler, { capture: true, passive: true });
}

/** Верхняя граница видимой области — от неё считаются липкие элементы. */
function pageViewportTop() {
  if (!inMockup()) return 0;
  const el = mockupScroller();
  return el ? el.getBoundingClientRect().top : 0;
}

export { inMockup, onPageScroll, pageScrollTop, pageViewportTop, scrollPageTo };
