/* Профиль: вкладки Video / Photos.

   Листание страниц — нативный горизонтальный скролл со scroll-snap. Пальцем это
   работает плавно и с прилипанием без самописного drag; розовая полоска под
   вкладками едет по событию scroll контейнера. */
import { onPageScroll, pageScrollTop, pageViewportTop } from '../ui/page-scroll.js';

const tabs = document.getElementById('tabs');
const tabsLine = document.getElementById('tabsLine');
const pager = document.getElementById('pager');
const profileScroll = document.getElementById('profileScroll');
const profileTabNames = ['video', 'photos'];
let activeProfileTab = 'video';

/* Ширина страницы = фактическая ширина пейджера, а не макетные 402px.
   Держим её в переменной и пересчитываем по ResizeObserver. */
let pagerWidthValue = pager.clientWidth || window.innerWidth;
const pagerWidth = () => pagerWidthValue || pager.clientWidth || window.innerWidth;

function updateProfileTabsMask() {
  const tabsRect = tabs.getBoundingClientRect();
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
  const reachedStickyPosition = tabsRect.top <= pageViewportTop() + safeTop + 2;
  tabs.classList.toggle('is-stuck', pageScrollTop() > 0 && reachedStickyPosition);
}

onPageScroll(updateProfileTabsMask);

function layoutTabs(progress = profileTabNames.indexOf(activeProfileTab)) {
  const buttons = [...tabs.querySelectorAll('.tabs__item')];
  const lowerIndex = Math.max(0, Math.min(buttons.length - 1, Math.floor(progress)));
  const upperIndex = Math.max(0, Math.min(buttons.length - 1, Math.ceil(progress)));
  const amount = Math.max(0, Math.min(1, progress - lowerIndex));
  const lower = buttons[lowerIndex];
  const upper = buttons[upperIndex];
  if (!lower || !upper) return;
  tabsLine.style.width = `${lower.offsetWidth + (upper.offsetWidth - lower.offsetWidth) * amount}px`;
  tabsLine.style.transform = `translateX(${lower.offsetLeft + (upper.offsetLeft - lower.offsetLeft) * amount}px)`;
}

/* Высота пейджера равна высоте видимой страницы: страницы разной длины,
   а вокруг них вертикальный скролл профиля. */
function layoutProfilePages(progress = profileTabNames.indexOf(activeProfileTab), animated = true) {
  const pages = [...pager.querySelectorAll('.pager__page')];
  const targetIndex = Math.max(0, Math.min(pages.length - 1, Math.round(progress)));
  const targetPage = pages[targetIndex];
  if (!targetPage) return;
  pager.style.transition = animated ? '' : 'none';
  pager.style.height = `${targetPage.scrollHeight}px`;
  if (!animated) {
    // сбрасываем подавление анимации на следующем кадре
    window.requestAnimationFrame(() => { pager.style.transition = ''; });
  }
}

function scrollToTab(index, behavior = 'smooth') {
  pager.scrollTo({ left: index * pagerWidth(), behavior });
}

function setProfileTab(tab, { scroll = true } = {}) {
  if (!profileTabNames.includes(tab)) return;
  activeProfileTab = tab;
  const index = profileTabNames.indexOf(tab);
  pager.querySelectorAll('.pager__page').forEach(page => {
    page.classList.toggle('is-active', page.dataset.page === tab);
  });
  tabs.querySelectorAll('.tabs__item').forEach(button => button.classList.toggle('is-active', button.dataset.tab === tab));
  tabsLine.style.transition = '';
  if (scroll) scrollToTab(index);
  layoutProfilePages(index, true);
  layoutTabs(index);
}

tabs.addEventListener('click', event => {
  const item = event.target.closest('.tabs__item');
  if (item) setProfileTab(item.dataset.tab);
});

/* Полоска и активная вкладка едут за пальцем — по событию scroll пейджера. */
let scrollSettleTimer = 0;
pager.addEventListener('scroll', () => {
  const progress = pager.scrollLeft / (pagerWidth() || 1);
  tabsLine.style.transition = 'none';
  layoutTabs(progress);

  window.clearTimeout(scrollSettleTimer);
  scrollSettleTimer = window.setTimeout(() => {
    const index = Math.max(0, Math.min(profileTabNames.length - 1, Math.round(progress)));
    const tab = profileTabNames[index];
    tabsLine.style.transition = '';
    if (tab !== activeProfileTab) setProfileTab(tab, { scroll: false });
    else layoutProfilePages(index, true);
  }, 90);
}, { passive: true });

new ResizeObserver(entries => {
  for (const entry of entries) pagerWidthValue = entry.contentRect.width;
  // после смены ширины страница должна остаться той же
  scrollToTab(profileTabNames.indexOf(activeProfileTab), 'auto');
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
}).observe(pager);

window.addEventListener('resize', () => {
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
  updateProfileTabsMask();
});
window.addEventListener('load', () => {
  layoutTabs();
  layoutProfilePages(profileTabNames.indexOf(activeProfileTab), false);
  updateProfileTabsMask();
});
window.requestAnimationFrame(() => {
  layoutProfilePages(0, false);
  layoutTabs(0);
  updateProfileTabsMask();
});

export { activeProfileTab, layoutProfilePages, layoutTabs, profileTabNames, updateProfileTabsMask };
