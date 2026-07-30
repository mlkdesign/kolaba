/* Projects: лента заказов, вкладки, экран проекта */
import { show } from '../core/router.js';
import { state } from '../core/state.js';
import { PROFILE_PHOTOS, THEMATIC_VIDEO_LIBRARY, UNIQUE_VERTICAL_VIDEO_LIBRARY, compactMetric, generatedProfilePhotos } from '../data/catalog.js';
import { DEFAULT_AVATAR_URL, THEMED_PHOTO_IDS } from '../data/photos.js';
import { openExternalProfile } from '../screens/profile.js';
import { shuffled } from '../screens/start.js';
import { swipeToDismiss } from '../ui/dismiss.js';
import { pageScrollTop, scrollPageTo } from '../ui/page-scroll.js';
import { flagFor } from '../ui/picker.js';
import { play as playVideo } from '../ui/video.js';

/* ── Projects: локальная лента вымышленных заказов ── */
const freeLimit = 7;
const catalogSize = 104;
const projectPlans = [
  { id: 'yearly', title: 'Yearly', price: '2.99 / month', isDefault: true },
  { id: 'monthly', title: 'Monthly', price: '3.99 / month', isDefault: false }
];
const PROJECT_AUTHORS = [
  ['Amelia Carter', 'amelia.creates', 'Lisbon, Portugal', 'women/44'],
  ['Noah Williams', 'noahvisuals', 'London, United Kingdom', 'men/32'],
  ['Sofia Laurent', 'sofiaugc', 'Paris, France', 'women/65'],
  ['Luca Moretti', 'luca.frames', 'Milan, Italy', 'men/52'],
  ['Maya Thompson', 'mayamakes', 'New York, USA', 'women/26'],
  ['Elias Becker', 'elias.studio', 'Berlin, Germany', 'men/41'],
  ['Nora Jensen', 'nordicnora', 'Copenhagen, Denmark', 'women/12'],
  ['Leo van Dijk', 'leovandijk', 'Amsterdam, Netherlands', 'men/75'],
  ['Ines Martins', 'inesonfilm', 'Porto, Portugal', 'women/29'],
  ['Adam Kowalski', 'adam.social', 'Warsaw, Poland', 'men/22'],
  ['Lina Haddad', 'linacreates', 'Dubai, UAE', 'women/79'],
  ['Mateo Silva', 'mateo.content', 'Barcelona, Spain', 'men/11'],
  ['Hana Kim', 'hanamotion', 'Seoul, South Korea', 'women/49'],
  ['Oscar Lind', 'oscarugc', 'Stockholm, Sweden', 'men/85'],
  ['Emma Wilson', 'emmadebrief', 'Sydney, Australia', 'women/33'],
  ['Samira Noor', 'samira.noor', 'Marrakesh, Morocco', 'women/8']
];
const PROJECT_COUNTRY_CODES = {
  Portugal: 'PT', 'United Kingdom': 'GB', France: 'FR', Italy: 'IT', USA: 'US',
  Germany: 'DE', Denmark: 'DK', Netherlands: 'NL', Poland: 'PL', UAE: 'AE',
  Spain: 'ES', 'South Korea': 'KR', Sweden: 'SE', Australia: 'AU', Morocco: 'MA'
};
const PROJECT_AUTHOR_PROFILES = PROJECT_AUTHORS.map(([name, handle, location, portrait]) => ({
  name, handle: `@${handle}`, location,
  countryCode: PROJECT_COUNTRY_CODES[location.split(', ').at(-1)] || '',
  avatar: `https://randomuser.me/api/portraits/${portrait}.jpg`
}));

const PROJECT_TEMPLATES = [
  { category: 'villa', title: 'UGC creator for a tropical villa campaign', text: 'Looking for a UGC model for a fun and creative shoot at our villa 🌴☀️\nWe’re creating content for social media campaigns, so you should feel natural in front of the camera.\n📅 Flexible dates\n💵 Paid opportunity' },
  { category: 'model', title: 'Morning skincare routine for social media', text: 'Skincare creator wanted for a clean morning-routine video ✨🧴\nWe will send the full product set and a simple brief. Natural light and an authentic voice are a must.\n🎬 3 short vertical videos' },
  { category: 'restaurant', title: 'Cozy creator campaign for a matcha brand', text: 'Launching a new matcha brand and looking for creators who love cozy lifestyle content 🍵💚\nShow us your favorite slow-morning ritual. Paid collaboration plus a product box.' },
  { category: 'model', title: 'Street-style creators for a fashion campaign', text: 'Fashion label seeking two creators for a street-style campaign in the city 🧥📸\nConfident movement, bold styling and a playful personality. Styling and moodboard provided.' },
  { category: 'villa', title: 'Boutique hotel weekend content package', text: 'Need a travel creator to capture a boutique hotel weekend 🌊🏨\nDeliverables: room tour, breakfast reel and 5 lifestyle photos. Stay and travel budget included.' },
  { category: 'stylishMan', title: 'On-camera talent for a fitness app launch', text: 'We’re filming a playful fitness app launch and need energetic on-camera talent 🏃‍♀️⚡️\nOne half-day studio shoot. No professional sports background required.' },
  { category: 'restaurant', title: 'Tell the story of our neighborhood coffee shop', text: 'Coffee shop looking for a local creator to tell our story ☕️🤎\nWe want warm, candid content featuring the people, pastries and atmosphere of our space.' },
  { category: 'girlDog', title: 'Pet creator for sustainable accessories', text: 'Seeking a pet creator for a new sustainable accessories collection 🐕🌿\nYour dog should be comfortable outdoors and around a small production team.' },
  { category: 'villa', title: 'Minimal homeware styling transformation', text: 'Minimal homeware campaign — looking for creators with bright, calm interiors 🕯️🏡\nFilm a natural unboxing and one styling transformation. Products are yours to keep.' },
  { category: 'model', title: 'Soft-glam beauty tutorial collaboration', text: 'Beauty studio needs a model and creator for a soft-glam tutorial 💄✨\nWe provide the artist, studio and full creative direction. Paid usage for three months.' },
  { category: 'restaurant', title: 'Food creator for our seasonal menu', text: 'Looking for a foodie creator to cover our new seasonal menu 🍝🍋\nBring your own point of view — honest reactions and charming detail shots are welcome.' },
  { category: 'stylishMan', title: 'Summer eyewear launch on a city rooftop', text: 'Join our summer eyewear launch in a rooftop studio 🕶️🌇\nWe’re after relaxed, premium-looking reels with a little humor. Half-day paid shoot.' }
];

const PROJECT_MEDIA_BY_CATEGORY = Object.fromEntries(
  Object.entries(THEMED_PHOTO_IDS).map(([category, photoIds]) => [
    category,
    photoIds.map(id => ({
      category,
      preview: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=240&h=430`,
      isVideo: false
    }))
  ])
);

THEMATIC_VIDEO_LIBRARY.forEach((video, index) => {
  PROJECT_MEDIA_BY_CATEGORY[video.category].push({
    category: video.category,
    preview: video.posterURL,
    videoURL: video.videoURL,
    isVideo: true,
    duration: ['0:15', '0:22', '0:09', '0:18'][index % 4]
  });
});

function projectMediaFor(category, count) {
  const availableMedia = PROJECT_MEDIA_BY_CATEGORY[category] || PROJECT_MEDIA_BY_CATEGORY.model;
  return shuffled(availableMedia).slice(0, Math.min(count, availableMedia.length));
}

let projectSequence = 0;
const PROPOSAL_BIOS = [
  'UGC creator crafting authentic, high-converting content for modern brands ✨ Open to collaborations worldwide 🌍',
  'Lifestyle storyteller focused on natural product demos, travel and hospitality content.',
  'I create warm, relatable short-form videos that help brands feel human and memorable.',
  'Fashion and beauty creator with a clean visual style and an eye for small details.',
  'Travel filmmaker producing social-first reels for hotels, restaurants and destinations.'
];

function makeProjectProposals(projectIndex, postedAt, count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, proposalIndex) => {
    const author = PROJECT_AUTHOR_PROFILES[(projectIndex + proposalIndex * 3 + 1) % PROJECT_AUTHOR_PROFILES.length];
    const clipSeed = Math.abs(projectIndex * 7 + proposalIndex * 11);
    const clips = Array.from({ length: 5 }, (_, clipIndex) => {
      const source = UNIQUE_VERTICAL_VIDEO_LIBRARY[(clipSeed + clipIndex) % UNIQUE_VERTICAL_VIDEO_LIBRARY.length];
      return {
        ...source,
        views: 10000 + (clipSeed * 317 + clipIndex * 1211) % 10001,
        likes: 1000 + (clipSeed * 71 + clipIndex * 313) % 2001
      };
    });
    const sentAt = new Date(Math.min(now, postedAt.getTime() + (proposalIndex + 1) * 13 * 3600000));
    return {
      id: `proposal-${projectSequence}-${projectIndex}-${proposalIndex}`,
      author,
      bio: PROPOSAL_BIOS[(projectIndex + proposalIndex) % PROPOSAL_BIOS.length],
      clips,
      sentAt
    };
  });
}

function makeProject(index, options = {}) {
  const template = PROJECT_TEMPLATES[index % PROJECT_TEMPLATES.length];
  const author = options.isMine
    ? { name: 'Milka Lisa', handle: '_devochka228', location: ['Bali, Indonesia', 'Jakarta, Indonesia', 'Ubud, Indonesia'][index % 3], countryCode: 'ID', avatar: PROFILE_PHOTOS[(index + 3) % PROFILE_PHOTOS.length].image }
    : PROJECT_AUTHOR_PROFILES[index % PROJECT_AUTHOR_PROFILES.length];
  const posted = new Date(Date.now() - (Math.floor(Math.random() * 14 * 24 * 60) * 60000));
  const date = posted.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = posted.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const proposalCount = index % 11 === 0 ? 0 : Math.abs(index * 5 + 3) % 9;
  const proposals = makeProjectProposals(index, posted, proposalCount);
  return {
    id: `project-${Date.now()}-${projectSequence++}`,
    author,
    postedAt: `${date}, ${time}`,
    postedDate: posted,
    location: author.location,
    title: template.title,
    text: template.text,
    category: template.category,
    media: projectMediaFor(template.category, 3 + Math.floor(Math.random() * 4)),
    proposals,
    responses: proposals.length,
    views: Math.floor(Math.random() * 4991) + 10,
    saves: Math.floor(Math.random() * 181),
    applied: false,
    isSaved: Boolean(options.isSaved),
    isMine: Boolean(options.isMine),
    authorFollowing: false
  };
}

const projectAuthorOrder = shuffled([...Array(PROJECT_AUTHOR_PROFILES.length).keys()]);
let projects = [...Array(catalogSize)].map((_, index) => makeProject(projectAuthorOrder[index % projectAuthorOrder.length] + index, {
  isMine: [0, 1, 2, 18, 37].includes(index),
  isSaved: [1, 4, 8, 12, 26, 54].includes(index)
}));

const projectsScreen = document.querySelector('[data-screen="projects"]');
const projectsTabs = document.getElementById('projectsTabs');
const projectsTabsLine = document.getElementById('projectsTabsLine');
const projectsPager = document.getElementById('projectsPager');

/* Ширина страницы вкладок — фактическая ширина пейджера, пересчёт по ResizeObserver */
let projectsPagerWidthValue = projectsPager.clientWidth || window.innerWidth;
const projectsPagerWidth = () => projectsPagerWidthValue || projectsPager.clientWidth || window.innerWidth;
let observedProjectsWidth = Math.round(projectsPager.clientWidth);
new ResizeObserver(entries => {
  const width = Math.round(entries[entries.length - 1].contentRect.width);
  if (width === observedProjectsWidth) return;
  observedProjectsWidth = width;
  projectsPagerWidthValue = width;
}).observe(projectsPager);
const projectsSearch = document.getElementById('projectsSearch');
const projectsSearchInput = document.getElementById('projectsSearchInput');
const projectsOverlay = document.getElementById('projectsOverlay');
const projectsSheet = document.getElementById('projectsSheet');
const projectDetail = document.getElementById('projectDetail');
const projectsRefresh = document.getElementById('projectsRefresh');
const projectTabNames = ['all', 'mine', 'saved'];
const projectScrollPositions = { all: 0, mine: 0, saved: 0 };
let activeProjectTab = 'all';

let selectedProjectPlan = projectPlans.find(plan => plan.isDefault)?.id || projectPlans[0].id;

function layoutProjectsTabs(progress = projectTabNames.indexOf(activeProjectTab)) {
  if (!projectsTabs || !projectsTabsLine) return;
  const buttons = [...projectsTabs.querySelectorAll('[data-project-tab]')];
  const lowerIndex = Math.max(0, Math.min(buttons.length - 1, Math.floor(progress)));
  const upperIndex = Math.max(0, Math.min(buttons.length - 1, Math.ceil(progress)));
  const amount = Math.max(0, Math.min(1, progress - lowerIndex));
  const lower = buttons[lowerIndex];
  const upper = buttons[upperIndex];
  const left = lower.offsetLeft + (upper.offsetLeft - lower.offsetLeft) * amount;
  const width = lower.offsetWidth + (upper.offsetWidth - lower.offsetWidth) * amount;
  projectsTabsLine.style.width = `${width}px`;
  projectsTabsLine.style.transform = `translateX(${left}px)`;
}

/* Высота пейджера равна высоте видимой страницы — вкладки разной длины,
   а скроллит их сам документ. */
const projectPages = () => [...projectsPager.querySelectorAll('[data-project-page]')];

function setProjectsPagerHeight(height, animated) {
  // box-sizing: border-box, а у пейджера есть верхний отступ под шапку —
  // без его учёта высота съедала низ страницы ровно на этот отступ
  const styles = getComputedStyle(projectsPager);
  const padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  projectsPager.style.transition = animated ? '' : 'none';
  projectsPager.style.height = `${height + padding}px`;
  if (!animated) window.requestAnimationFrame(() => { projectsPager.style.transition = ''; });
}

/* Пока палец ведёт страницу, высоту отдаём флексу — он держит её по самой длинной
   вкладке и не отстаёт от догружающихся картинок. Иначе соседняя страница
   обрезается и кажется, что вкладки наезжают друг на друга. */
function expandProjectsPagerForSwipe() {
  projectsPager.style.transition = 'none';
  projectsPager.style.height = 'auto';
}

function layoutProjectPages(progress = projectTabNames.indexOf(activeProjectTab), animated = true) {
  const pages = projectPages();
  const index = Math.max(0, Math.min(pages.length - 1, Math.round(progress)));
  const page = pages[index];
  if (!page) return;
  setProjectsPagerHeight(page.scrollHeight, animated);
}

/* Программная прокрутка не должна выглядеть как жест — иначе высота сначала
   раскрывается до максимума, а потом схлопывается. */
let projectsProgrammaticUntil = 0;

function scrollToProjectTab(index, behavior = 'smooth') {
  // ширину берём живую: кэш может отстать и страница встанет не по сетке
  const width = projectsPager.clientWidth || projectsPagerWidth();
  projectsProgrammaticUntil = performance.now() + (behavior === 'smooth' ? 420 : 80);
  projectsPager.scrollTo({ left: index * width, behavior });
}

function projectCardMarkup(project, tab, isLocked = false) {
  const attachments = project.media.map((media, mediaIndex) => `
    <button class="project-attachment" type="button" data-project-media-index="${mediaIndex}" aria-label="Open ${media.isVideo ? 'video' : 'photo'} attachment">
      <img src="${media.preview}" alt="" loading="lazy" decoding="async">
      ${media.isVideo ? `<span class="project-video-play"><img src="assets/icons/ProjectPlay.svg" alt=""></span><span class="project-duration">${media.duration}</span>` : ''}
    </button>`).join('');
  return `
    <article class="project-card${isLocked ? ' is-paywall-locked' : ''}" data-project-id="${project.id}" tabindex="0" aria-label="Open project by ${project.author.name}"${isLocked ? ' aria-disabled="true"' : ''}>
      <div class="project-card-actions">
        <button class="project-more" type="button" data-project-menu aria-label="Project actions"><img src="assets/icons/ThreeDots.svg" alt=""></button>
        <button class="project-save${project.isSaved ? ' is-saved' : ''}" type="button" aria-label="${project.isSaved ? 'Remove from saved' : 'Save project'}">
          <img src="assets/icons/${project.isSaved ? 'ProjectBookmarkFilled' : 'ProjectBookmark'}.svg" alt="">
        </button>
      </div>
      <div class="project-author">
        <button class="project-author__avatar-button" type="button" data-project-author aria-label="Open ${project.author.name} profile"><img class="project-author__avatar" src="${project.author.avatar}" alt="${project.author.name}" loading="lazy"></button>
        <div class="project-author__identity"><button class="project-author__name" type="button" data-project-author>${project.author.name}</button><span class="project-author__location"><i aria-hidden="true">${flagFor(project.author.countryCode) || '🌍'}</i><span class="project-author__location-text">${project.location}</span></span></div>
      </div>
      <p class="project-description">${project.text}</p>
      <div class="project-media">${attachments}</div>
      <div class="project-footer">
        <div class="project-metrics">
          <span class="project-metric"><img src="assets/icons/ProjectUser.svg" alt=""><span>${project.responses}</span></span>
          <span class="project-metric"><img src="assets/icons/ProjectEye.svg" alt=""><span>${compactMetric(project.views)}</span></span>
          ${tab === 'mine' ? `<span class="project-metric"><img src="assets/icons/ProjectBookmark.svg" alt=""><span>${compactMetric(project.saves)}</span></span>` : ''}
        </div>
        <time class="project-author__date">${project.postedAt}</time>
      </div>
    </article>`;
}

function projectPaywallMarkup() {
  const plans = projectPlans.map(plan => `
    <button class="project-plan${selectedProjectPlan === plan.id ? ' is-selected' : ''}" type="button" data-project-plan="${plan.id}" aria-pressed="${selectedProjectPlan === plan.id}">
      <span><span class="project-plan__title"><b>${plan.title}</b>${plan.id === 'yearly' ? '<small>Save 25 %</small>' : ''}</span><em>${plan.price}</em></span>
      <i aria-hidden="true"></i>
    </button>`).join('');
  return `
    <section class="project-paywall" data-project-paywall>
      <div class="project-paywall__content">
        <img class="project-paywall__lock" src="assets/icons/ProLock.svg" alt="">
        <h3>kolaba<span>.pro</span></h3>
        <div class="project-paywall__count"><i></i><span>${catalogSize} active projects</span></div>
        <p class="project-paywall__copy">You're seeing ${freeLimit} of ${catalogSize} active projects. Upgrade to kolaba.pro to access all projects and apply for any collaborations</p>
        <div class="project-plans">${plans}</div>
        <button class="project-paywall__unlock" type="button" data-project-unlock><span>Unlock with Kolaba Pro</span><img src="assets/icons/ProUnlock.svg" alt=""></button>
        <p class="project-paywall__post-label">Looking for UGC creators? Post a project for free:</p>
        <button class="project-paywall__post" type="button" data-project-post><span>Post your project for free</span><img src="assets/icons/ProPlus.svg" alt=""></button>
        <div class="project-paywall__legal"><button type="button">Privacy Policy</button><i></i><button type="button">Terms and Conditions</button></div>
      </div>
    </section>`;
}

function projectsCaughtUpMarkup() {
  return '<p class="projects-caught-up">You\'re all caught up</p>';
}

function matchingProjects(tab) {
  const query = projectsSearchInput.value.trim().toLocaleLowerCase();
  const accessibleIds = new Set(projects.slice(0, freeLimit).map(project => project.id));
  return projects.filter(project => {
    if (tab === 'mine' && !project.isMine) return false;
    if (tab === 'saved' && !project.isSaved) return false;
    if (!state.isProjectsPro && tab !== 'mine' && !accessibleIds.has(project.id)) return false;
    return !query || `${project.text} ${project.location} ${project.author.name} ${project.author.handle}`.toLocaleLowerCase().includes(query);
  });
}

function renderProjects() {
  projectTabNames.forEach(tab => {
    const list = document.getElementById(`projects${tab[0].toUpperCase()}${tab.slice(1)}`);
    const filtered = matchingProjects(tab);
    const hasPaywall = !state.isProjectsPro && tab !== 'mine';
    list.classList.toggle('has-paywall', hasPaywall);
    if (!filtered.length && !hasPaywall) {
      const label = tab === 'saved' && !projectsSearchInput.value ? 'Nothing saved yet' : 'No projects found';
      list.innerHTML = `<div class="projects-empty"><img src="assets/icons/ProjectBookmark.svg" alt=""><span>${label}</span></div>`;
    } else {
      const cards = filtered.map((project, index) => projectCardMarkup(project, tab, hasPaywall && index === filtered.length - 1)).join('');
      const empty = !filtered.length ? '<div class="projects-empty"><img src="assets/icons/ProjectBookmark.svg" alt=""><span>No accessible saved projects</span></div>' : '';
      const ending = hasPaywall ? projectPaywallMarkup() : (tab !== 'mine' ? projectsCaughtUpMarkup() : '');
      list.innerHTML = `${cards}${empty}${ending}`;
      list.querySelectorAll('.project-author__avatar').forEach((image, index) => image.addEventListener('error', () => {
        const fallback = PROFILE_PHOTOS[(index + 7) % PROFILE_PHOTOS.length].image;
        const project = projects.find(item => item.id === image.closest('.project-card')?.dataset.projectId);
        if (project) project.author.avatar = fallback;
        image.src = fallback;
      }, { once: true }));
      list.querySelectorAll('.project-card.is-paywall-locked button').forEach(button => {
        button.disabled = true;
        button.tabIndex = -1;
      });
    }
  });
}

function setProjectsTab(tab, { scroll = true } = {}) {
  if (!projectTabNames.includes(tab)) return;
  projectScrollPositions[activeProjectTab] = pageScrollTop();
  activeProjectTab = tab;
  const index = projectTabNames.indexOf(tab);
  projectsTabs.querySelectorAll('[data-project-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.projectTab === tab));
  projectsPager.querySelectorAll('[data-project-page]').forEach(page => page.classList.toggle('is-active', page.dataset.projectPage === tab));
  projectsTabsLine.style.transition = '';
  if (scroll) scrollToProjectTab(index);
  layoutProjectPages(index, true);
  layoutProjectsTabs(index);
  scrollPageTo(projectScrollPositions[tab] || 0, 'auto');
}

/* Полоска вкладок едет за пальцем, активная вкладка — по позиции прилипания */
let projectsSettleTimer = 0;
let projectsSwiping = false;

function settleProjectsPager() {
  window.clearTimeout(projectsSettleTimer);
  projectsSwiping = false;
  const progress = projectsPager.scrollLeft / (projectsPager.clientWidth || 1);
  const index = Math.max(0, Math.min(projectTabNames.length - 1, Math.round(progress)));
  projectsTabsLine.style.transition = '';
  if (projectTabNames[index] !== activeProjectTab) setProjectsTab(projectTabNames[index], { scroll: false });
  else layoutProjectPages(index, true);
}

projectsPager.addEventListener('scroll', () => {
  const progress = projectsPager.scrollLeft / (projectsPager.clientWidth || 1);
  if (!projectsSwiping && performance.now() > projectsProgrammaticUntil) {
    projectsSwiping = true;
    expandProjectsPagerForSwipe();
  }
  projectsTabsLine.style.transition = 'none';
  layoutProjectsTabs(progress);
  window.clearTimeout(projectsSettleTimer);
  projectsSettleTimer = window.setTimeout(settleProjectsPager, 70);
}, { passive: true });

if ('onscrollend' in window) projectsPager.addEventListener('scrollend', settleProjectsPager);

projectsTabs.addEventListener('click', event => {
  const button = event.target.closest('[data-project-tab]');
  if (button) setProjectsTab(button.dataset.projectTab);
});

function openProjectsSheet(content) {
  projectsSheet.innerHTML = content;
  projectsOverlay.classList.add('is-open');
  projectsOverlay.setAttribute('aria-hidden', 'false');
}
function closeProjectsSheet() {
  projectsOverlay.classList.remove('is-open');
  projectsOverlay.setAttribute('aria-hidden', 'true');
}
projectsOverlay.addEventListener('click', event => {
  const action = event.target.closest('[data-project-action]')?.dataset.projectAction;
  if (action === 'reset-pro') {
    state.isProjectsPro = false;
    selectedProjectPlan = projectPlans.find(plan => plan.isDefault)?.id || projectPlans[0].id;
    renderProjects();
  }
  if (event.target.closest('[data-project-overlay-close], .projects-sheet__close, [data-project-action]')) closeProjectsSheet();
});

function openNewProjectSheet() {
  openProjectsSheet(`
    <h3 class="projects-sheet__title">New project</h3>
    <p class="projects-sheet__copy">Coming soon</p>
    <button class="projects-sheet__close" type="button">Close</button>`);
}

document.getElementById('newProjectButton').addEventListener('click', openNewProjectSheet);

document.getElementById('projectsSearchButton').addEventListener('click', () => {
  projectsSearch.hidden = false;
  projectsScreen.classList.add('is-searching');
  projectsSearchInput.focus();
});
document.getElementById('projectsSearchClose').addEventListener('click', () => {
  projectsSearchInput.value = '';
  projectsSearch.hidden = true;
  projectsScreen.classList.remove('is-searching');
  renderProjects();
});
projectsSearchInput.addEventListener('input', renderProjects);

let suppressProjectCardClick = false;
let pendingProjectCardOpen = null;
let lastProjectCardTap = { id: '', time: 0 };

function cancelPendingProjectOpen() {
  window.clearTimeout(pendingProjectCardOpen);
  pendingProjectCardOpen = null;
}

function setProjectSaved(project, isSaved) {
  const changed = project.isSaved !== isSaved;
  project.isSaved = isSaved;
  if (changed) project.saves = Math.max(0, project.saves + (isSaved ? 1 : -1));
  renderProjects();
  if (activeProjectDetailId === project.id) updateProjectDetailSave(project);
  window.requestAnimationFrame(() => {
    projectsPager.querySelectorAll(`[data-project-id="${project.id}"] .project-save`).forEach(button => {
      button.classList.add('is-bouncing');
    });
  });
}

const projectDetailScroll = document.getElementById('projectDetailScroll');
const projectDetailContent = document.getElementById('projectDetailContent');
const projectDetailSave = document.getElementById('projectDetailSave');
const projectDetailApply = document.getElementById('projectDetailApply');
let activeProjectDetailId = null;
let projectProposalsNewestFirst = true;
let activeProposalMenuId = null;

function projectDetailDate(value) {
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }).replace(' at ', ', ');
}

function projectDetailMediaMarkup(project) {
  return project.media.map((media, mediaIndex) => `
    <button class="project-detail__attachment" type="button" data-detail-media-index="${mediaIndex}" aria-label="Open ${media.isVideo ? 'video' : 'photo'} attachment">
      <img src="${media.preview}" alt="" loading="lazy" decoding="async">
      ${media.isVideo ? `<span class="project-duration">${media.duration}</span><span class="project-video-play"><img src="assets/icons/ProjectPlay.svg" alt=""></span>` : ''}
    </button>`).join('');
}

function proposalProfile(proposal) {
  const seed = [...proposal.author.name].reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    name: proposal.author.name,
    avatarURL: proposal.author.avatar,
    countryCode: proposal.author.countryCode,
    city: proposal.author.location.split(',')[0]?.trim() || proposal.author.location,
    bio: proposal.bio,
    photos: generatedProfilePhotos(proposal.author.avatar, seed),
    videos: proposal.clips
  };
}

function proposalCardMarkup(proposal, project) {
  const clips = proposal.clips.slice(0, 5).map((clip, clipIndex) => `
    <button class="proposal-clip" type="button" data-proposal-clip="${clipIndex}" data-proposal-id="${proposal.id}" aria-label="Open ${proposal.author.name} video">
      <img src="${clip.posterURL}" alt="" loading="lazy" decoding="async">
      <span class="proposal-clip__stats">
        <span><img src="assets/icons/FeedEye.svg" alt="">${compactMetric(clip.views)}</span>
        <span><img src="assets/icons/FeedHeart.svg" alt="">${compactMetric(clip.likes)}</span>
      </span>
    </button>`).join('');
  return `
    <article class="proposal-card" data-proposal-id="${proposal.id}">
      <div class="proposal-author">
        <button class="proposal-author__avatar" type="button" data-proposal-author aria-label="Open ${proposal.author.name} profile"><img src="${proposal.author.avatar}" alt="" loading="lazy" decoding="async"></button>
        <div class="proposal-author__copy"><button class="proposal-author__name" type="button" data-proposal-author>${proposal.author.name}</button><div class="proposal-author__location"><i aria-hidden="true">${flagFor(proposal.author.countryCode)}</i><span>${proposal.author.location}</span></div></div>
        <div class="proposal-author__side"><time class="proposal-author__date">${projectDetailDate(proposal.sentAt)}</time><button class="proposal-author__more" type="button" data-proposal-menu aria-label="Proposal actions"><img src="assets/icons/ThreeDots.svg" alt=""></button></div>
      </div>
      <button class="proposal-bio" type="button" data-proposal-bio>${proposal.bio}</button>
      <div class="proposal-clips">${clips}</div>
    </article>`;
}

function sortedProjectProposals(project) {
  return [...project.proposals].sort((first, second) => projectProposalsNewestFirst
    ? second.sentAt - first.sentAt
    : first.sentAt - second.sentAt);
}

function renderProjectProposals(project, animate = false) {
  const list = document.getElementById('projectProposalsList');
  if (!list) return;
  list.innerHTML = project.proposals.length
    ? sortedProjectProposals(project).map(proposal => proposalCardMarkup(proposal, project)).join('')
    : '<div class="project-proposals__empty"><img src="assets/icons/ProjectUser.svg" alt=""><span>No proposals yet</span></div>';
  if (animate && project.proposals.length) {
    list.classList.remove('is-sorting');
    void list.offsetWidth;
    list.classList.add('is-sorting');
  }
  list.querySelectorAll('.proposal-author__avatar img').forEach((image, index) => image.addEventListener('error', () => {
    const fallback = PROFILE_PHOTOS[(index + 9) % PROFILE_PHOTOS.length].image;
    const proposal = project.proposals.find(item => item.id === image.closest('.proposal-card')?.dataset.proposalId);
    if (proposal) proposal.author.avatar = fallback;
    image.src = fallback;
  }, { once: true }));
}

function updateProjectDetailSave(project) {
  projectDetailSave.classList.toggle('is-saved', project.isSaved);
  projectDetailSave.setAttribute('aria-label', project.isSaved ? 'Remove from saved' : 'Save project');
  projectDetailSave.querySelector('img').src = `assets/icons/${project.isSaved ? 'ProjectBookmarkFilled' : 'ProjectBookmark'}.svg`;
}

function renderProjectDetail(project) {
  const followMarkup = project.isMine
    ? ''
    : `<button class="project-detail__follow${project.authorFollowing ? ' is-following' : ''}" type="button" data-project-follow><span>${project.authorFollowing ? 'Following' : 'Follow'}</span>${project.authorFollowing ? '' : '<img src="assets/icons/FeedPlus.svg" alt="">'}</button>`;
  projectDetailContent.innerHTML = `
    <section class="project-detail__hero">
      <div class="project-detail__author">
        <button class="project-detail__author-button" type="button" data-detail-author aria-label="Open ${project.author.name} profile"><img src="${project.author.avatar}" alt="" loading="lazy"></button>
        <div class="project-detail__author-copy"><button class="project-detail__author-name" type="button" data-detail-author>${project.author.name}</button><div class="project-detail__author-location">${flagFor(project.author.countryCode)} ${project.location}</div></div>
        ${followMarkup}
      </div>
      <p class="project-detail__description">${project.text}</p>
      <div class="project-detail__media">${projectDetailMediaMarkup(project)}</div>
      <div class="project-detail__metadata"><span class="project-detail__views"><img src="assets/icons/ProjectEye.svg" alt=""><span>${project.views.toLocaleString('en-US')}</span></span><time class="project-detail__date">${project.postedAt}</time></div>
      <div class="project-detail__divider"></div>
    </section>
    <section class="project-proposals">
      <div class="project-proposals__head">
        <div class="project-proposals__title"><img src="assets/icons/ProjectUser.svg" alt=""><b>Proposals</b><span class="project-proposals__count">${project.proposals.length}</span></div>
        <button class="project-proposals__sort${projectProposalsNewestFirst ? '' : ' is-oldest'}" type="button" data-project-proposals-sort><img src="assets/icons/IconChevron.svg" alt=""><span>By date</span></button>
      </div>
      <div class="project-proposals__list" id="projectProposalsList"></div>
    </section>`;
  projectDetail.classList.toggle('is-mine', project.isMine);
  projectDetailApply.textContent = project.applied ? 'Application sent' : 'Apply to project';
  projectDetailApply.setAttribute('aria-label', project.applied ? 'Application sent' : 'Apply to this project');
  const detailAvatar = projectDetailContent.querySelector('.project-detail__author-button img');
  detailAvatar?.addEventListener('error', () => {
    project.author.avatar = DEFAULT_AVATAR_URL;
    detailAvatar.src = DEFAULT_AVATAR_URL;
  }, { once: true });
  updateProjectDetailSave(project);
  renderProjectProposals(project);
}

function openProjectDetail(project) {
  activeProjectDetailId = project.id;
  projectProposalsNewestFirst = true;
  renderProjectDetail(project);
  scrollPageTo(0, 'auto');
  // сначала показываем блок, и только следующим кадром запускаем выезд
  projectDetail.classList.add('is-mounted');
  projectsScreen.classList.add('is-detail-open');
  projectDetail.setAttribute('aria-hidden', 'false');
  window.requestAnimationFrame(() => projectDetail.classList.add('is-open'));
}

function closeProjectDetail() {
  projectDetail.classList.remove('is-open');
  projectsScreen.classList.remove('is-detail-open');
  projectDetail.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => {
    if (projectDetail.classList.contains('is-open')) return;
    projectDetail.classList.remove('is-mounted');
    activeProjectDetailId = null;
    layoutProjectPages(projectTabNames.indexOf(activeProjectTab), false);
  }, 280);
}

const projectMediaViewer = document.getElementById('projectMediaViewer');
const projectMediaViewerImage = document.getElementById('projectMediaViewerImage');
const projectMediaViewerVideo = document.getElementById('projectMediaViewerVideo');
const projectMediaViewerStage = projectMediaViewer.querySelector('.project-media-viewer__stage');
const projectMediaViewerBackdrop = document.getElementById('projectMediaViewerBackdrop');
let projectMediaViewerClearTimer;

function projectAuthorProfile(project) {
  const seed = [...project.author.name].reduce((total, character) => total + character.charCodeAt(0), 0);
  const videos = Array.from({ length: 5 }, (_, index) =>
    UNIQUE_VERTICAL_VIDEO_LIBRARY[(seed + index) % UNIQUE_VERTICAL_VIDEO_LIBRARY.length]
  );
  return {
    name: project.author.name,
    avatarURL: project.author.avatar,
    countryCode: project.author.countryCode,
    city: project.location.split(',')[0]?.trim() || project.location,
    bio: `${project.author.name} creates authentic UGC and social-first campaigns for lifestyle brands.`,
    photos: generatedProfilePhotos(project.author.avatar, seed),
    videos
  };
}

function projectPhotoFullSource(source) {
  return source.replace('&fit=crop&w=240&h=430', '&w=1200');
}

function openProjectMediaItem(media) {
  if (!media) return;
  const preview = media.preview || media.posterURL || '';
  const isVideo = Boolean(media.isVideo || media.videoURL);
  window.clearTimeout(projectMediaViewerClearTimer);
  projectMediaViewerImage.hidden = isVideo;
  projectMediaViewerVideo.hidden = !isVideo;
  projectMediaViewer.classList.toggle('is-loading', isVideo);
  if (isVideo) {
    projectMediaViewerVideo.poster = preview;
    projectMediaViewerVideo.src = media.videoURL;
    projectMediaViewerVideo.load();
    playVideo(projectMediaViewerVideo);
  } else {
    projectMediaViewerImage.src = projectPhotoFullSource(preview);
  }
  projectMediaViewer.classList.add('is-open');
  projectMediaViewer.setAttribute('aria-hidden', 'false');
}

function openProjectMedia(project, mediaIndex) {
  openProjectMediaItem(project.media[mediaIndex]);
}

/* Фото и видео из карточки проекта тоже закрываются смахиванием */
swipeToDismiss(projectMediaViewer, {
  stage: projectMediaViewerStage,
  backdrop: projectMediaViewerBackdrop,
  onClose: () => closeProjectMedia(),
  isOpen: () => projectMediaViewer.classList.contains('is-open')
});

function closeProjectMedia() {
  if (!projectMediaViewer.classList.contains('is-open')) return;
  projectMediaViewerVideo.pause();
  projectMediaViewer.classList.remove('is-open', 'is-loading');
  projectMediaViewer.setAttribute('aria-hidden', 'true');
  projectMediaViewerClearTimer = window.setTimeout(() => {
    projectMediaViewerImage.src = '';
    projectMediaViewerVideo.removeAttribute('src');
    projectMediaViewerVideo.removeAttribute('poster');
    projectMediaViewerVideo.load();
  }, 220);
}

projectMediaViewerVideo.addEventListener('canplay', () => projectMediaViewer.classList.remove('is-loading'));
projectMediaViewerVideo.addEventListener('playing', () => projectMediaViewer.classList.remove('is-loading'));
projectMediaViewerVideo.addEventListener('waiting', () => projectMediaViewer.classList.add('is-loading'));
projectMediaViewerVideo.addEventListener('click', () => {
  if (projectMediaViewerVideo.paused) playVideo(projectMediaViewerVideo);
  else projectMediaViewerVideo.pause();
});
projectMediaViewerBackdrop.addEventListener('click', closeProjectMedia);
document.getElementById('projectMediaViewerBack').addEventListener('click', closeProjectMedia);

projectsPager.addEventListener('click', event => {
  const card = event.target.closest('.project-card');
  if (!card) return;
  if (card.classList.contains('is-paywall-locked')) return;
  if (suppressProjectCardClick) return;
  const project = projects.find(item => item.id === card.dataset.projectId);
  if (!project) return;
  if (event.target.closest('[data-project-author]')) {
    cancelPendingProjectOpen();
    openExternalProfile(projectAuthorProfile(project), 'projects');
    return;
  }
  const attachment = event.target.closest('[data-project-media-index]');
  if (attachment) {
    cancelPendingProjectOpen();
    openProjectMedia(project, Number(attachment.dataset.projectMediaIndex));
    return;
  }
  const save = event.target.closest('.project-save');
  if (save) {
    cancelPendingProjectOpen();
    setProjectSaved(project, !project.isSaved);
    return;
  }
  if (event.target.closest('[data-project-menu]')) {
    cancelPendingProjectOpen();
    openProjectsSheet(`
      <button type="button" data-project-action="share">Share</button>
      <button type="button" data-project-action="report">Report</button>
      <button type="button" data-project-action="hide">Hide</button>
      <button class="projects-sheet__close" type="button">Cancel</button>`);
    return;
  }
  const now = performance.now();
  const isDoubleTap = lastProjectCardTap.id === project.id && now - lastProjectCardTap.time <= 320;
  if (isDoubleTap) {
    cancelPendingProjectOpen();
    lastProjectCardTap = { id: '', time: 0 };
    setProjectSaved(project, true);
    return;
  }
  cancelPendingProjectOpen();
  lastProjectCardTap = { id: project.id, time: now };
  pendingProjectCardOpen = window.setTimeout(() => {
    pendingProjectCardOpen = null;
    lastProjectCardTap = { id: '', time: 0 };
    openProjectDetail(project);
  }, 330);
});
projectsPager.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
  const card = event.target.closest('.project-card');
  if (!card) return;
  if (card.classList.contains('is-paywall-locked')) return;
  const project = projects.find(item => item.id === card.dataset.projectId);
  if (!project) return;
  event.preventDefault();
  openProjectDetail(project);
});

projectsPager.addEventListener('click', event => {
  const plan = event.target.closest('[data-project-plan]');
  if (plan) {
    selectedProjectPlan = plan.dataset.projectPlan;
    projectsPager.querySelectorAll('[data-project-plan]').forEach(button => {
      const selected = button.dataset.projectPlan === selectedProjectPlan;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    return;
  }
  if (event.target.closest('[data-project-post]')) {
    openNewProjectSheet();
    return;
  }
  if (event.target.closest('[data-project-unlock]')) {
    const paywall = event.target.closest('[data-project-paywall]');
    paywall?.classList.add('is-unlocking');
    window.setTimeout(() => {
      state.isProjectsPro = true;
      renderProjects();
      window.requestAnimationFrame(() => {
        projectsPager.querySelectorAll('.project-card').forEach((card, index) => {
          if (index >= freeLimit) card.classList.add('is-pro-revealed');
        });
      });
    }, 280);
  }
});
function activeProjectDetail() {
  return projects.find(project => project.id === activeProjectDetailId);
}

document.getElementById('projectDetailBack').addEventListener('click', closeProjectDetail);
projectDetailSave.addEventListener('click', () => {
  const project = activeProjectDetail();
  if (project) setProjectSaved(project, !project.isSaved);
});
projectDetailApply.addEventListener('click', () => {
  const project = activeProjectDetail();
  if (!project || project.isMine || project.applied) return;
  project.applied = true;
  projectDetailApply.textContent = 'Application sent';
  projectDetailApply.setAttribute('aria-label', 'Application sent');
});
document.getElementById('projectDetailMore').addEventListener('click', () => {
  if (!activeProjectDetail()) return;
  openProjectsSheet(`
    <button type="button" data-project-action="share">Share</button>
    <button type="button" data-project-action="report">Report</button>
    <button type="button" data-project-action="hide">Hide</button>
    <button class="projects-sheet__close" type="button">Cancel</button>`);
});

projectDetailContent.addEventListener('click', event => {
  const project = activeProjectDetail();
  if (!project) return;
  if (event.target.closest('[data-detail-author]')) {
    openExternalProfile(projectAuthorProfile(project), 'projects');
    return;
  }
  const detailMedia = event.target.closest('[data-detail-media-index]');
  if (detailMedia) {
    openProjectMedia(project, Number(detailMedia.dataset.detailMediaIndex));
    return;
  }
  const proposalCard = event.target.closest('.proposal-card');
  const proposal = proposalCard ? project.proposals.find(item => item.id === proposalCard.dataset.proposalId) : null;
  const proposalClip = event.target.closest('[data-proposal-clip]');
  if (proposal && proposalClip) {
    openProjectMediaItem(proposal.clips[Number(proposalClip.dataset.proposalClip)]);
    return;
  }
  if (proposal && event.target.closest('[data-proposal-author]')) {
    openExternalProfile(proposalProfile(proposal), 'projects');
    return;
  }
  const bio = event.target.closest('[data-proposal-bio]');
  if (proposal && bio) {
    if (!bio.classList.contains('is-expanded')) bio.classList.add('is-expanded');
    else openExternalProfile(proposalProfile(proposal), 'projects');
    return;
  }
  if (proposal && event.target.closest('[data-proposal-menu]')) {
    activeProposalMenuId = proposal.id;
    openProjectsSheet(`
      <button type="button" data-proposal-action="message">Message</button>
      <button type="button" data-proposal-action="profile">View profile</button>
      <button type="button" data-proposal-action="hide">Hide</button>
      <button class="projects-sheet__close" type="button">Cancel</button>`);
    return;
  }
  const sort = event.target.closest('[data-project-proposals-sort]');
  if (sort) {
    projectProposalsNewestFirst = !projectProposalsNewestFirst;
    sort.classList.toggle('is-oldest', !projectProposalsNewestFirst);
    renderProjectProposals(project, true);
    return;
  }
  const follow = event.target.closest('[data-project-follow]');
  if (follow) {
    project.authorFollowing = !project.authorFollowing;
    follow.classList.toggle('is-following', project.authorFollowing);
    follow.innerHTML = `<span>${project.authorFollowing ? 'Following' : 'Follow'}</span>${project.authorFollowing ? '' : '<img src="assets/icons/FeedPlus.svg" alt="">'}`;
    return;
  }
});

projectsOverlay.addEventListener('click', event => {
  const action = event.target.closest('[data-proposal-action]')?.dataset.proposalAction;
  if (!action) return;
  const project = activeProjectDetail();
  const proposal = project?.proposals.find(item => item.id === activeProposalMenuId);
  closeProjectsSheet();
  if (!project || !proposal) return;
  if (action === 'profile') openExternalProfile(proposalProfile(proposal), 'projects');
  if (action === 'message') show('messages');
  if (action === 'hide') {
    const scrollTop = pageScrollTop();
    project.proposals = project.proposals.filter(item => item.id !== proposal.id);
    project.responses = project.proposals.length;
    renderProjects();
    renderProjectDetail(project);
    scrollPageTo(scrollTop, 'auto');
  }
});

let projectDetailEdgeGesture = null;
projectDetail.addEventListener('pointerdown', event => {
  const rect = projectDetail.getBoundingClientRect();
  if (event.clientX - rect.left > 24 || event.target.closest('button')) return;
  projectDetailEdgeGesture = { x: event.clientX, y: event.clientY };
});
projectDetail.addEventListener('pointerup', event => {
  if (!projectDetailEdgeGesture) return;
  const dx = event.clientX - projectDetailEdgeGesture.x;
  const dy = event.clientY - projectDetailEdgeGesture.y;
  projectDetailEdgeGesture = null;
  if (dx > 70 && Math.abs(dx) > Math.abs(dy)) closeProjectDetail();
});
projectDetail.addEventListener('pointercancel', () => { projectDetailEdgeGesture = null; });

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (projectMediaViewer.classList.contains('is-open')) closeProjectMedia();
  else if (projectDetail.classList.contains('is-open')) closeProjectDetail();
});

/* Горизонталь листает сам пейджер со scroll-snap; от указателя остаётся
   потягивание вниз для обновления ленты и подавление клика после свайпа. */
let projectGesture = null;
projectsPager.addEventListener('pointerdown', event => {
  if (event.target.closest('.project-media, button, input')) return;
  cancelPendingProjectOpen();
  suppressProjectCardClick = false;
  projectGesture = { x: event.clientX, y: event.clientY, pulling: pageScrollTop() <= 0 };
}, { passive: true });

projectsPager.addEventListener('pointermove', event => {
  if (!projectGesture) return;
  const dx = event.clientX - projectGesture.x;
  const dy = event.clientY - projectGesture.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) > 8) suppressProjectCardClick = true;
  if (projectGesture.pulling && dy > 14 && Math.abs(dy) > Math.abs(dx)) {
    projectsRefresh.classList.add('is-visible');
    projectsRefresh.querySelector('span').textContent = dy > 62 ? 'Release to refresh' : 'Pull to refresh';
  }
}, { passive: true });

projectsPager.addEventListener('pointerup', event => {
  if (!projectGesture) return;
  const dx = event.clientX - projectGesture.x;
  const dy = event.clientY - projectGesture.y;
  if (projectGesture.pulling && dy > 62 && Math.abs(dy) > Math.abs(dx)) {
    projectsRefresh.classList.add('is-loading', 'is-visible');
    projectsRefresh.querySelector('span').textContent = 'Refreshing…';
    window.setTimeout(() => {
      const extraCount = 3 + Math.floor(Math.random() * 3);
      const extras = [...Array(extraCount)].map((_, index) => makeProject(Math.floor(Math.random() * PROJECT_AUTHOR_PROFILES.length) + index));
      projects = [...extras, ...projects].slice(0, catalogSize);
      renderProjects();
      projectsRefresh.classList.remove('is-loading', 'is-visible');
    }, 650);
  } else {
    projectsRefresh.classList.remove('is-visible');
  }
  projectGesture = null;
  window.setTimeout(() => { suppressProjectCardClick = false; }, 0);
}, { passive: true });

projectsPager.addEventListener('pointercancel', () => {
  projectGesture = null;
  suppressProjectCardClick = false;
  projectsRefresh.classList.remove('is-visible');
}, { passive: true });

window.addEventListener('resize', () => layoutProjectsTabs());
renderProjects();

export { PROJECT_AUTHOR_PROFILES, closeProjectDetail, layoutProjectsTabs, openProjectDetail, projects, setProjectsTab };
