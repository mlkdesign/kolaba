/* Мессенджер: список чатов и переписка */
import { show } from '../core/router.js';
import { UNIQUE_VERTICAL_VIDEO_LIBRARY, generatedProfilePhotos, normalizedAuthorPhotos } from '../data/catalog.js';
import { DEFAULT_AVATAR_URL, PHOTOS } from '../data/photos.js';
import { openExternalProfile } from '../screens/profile.js';
import { shuffled } from '../screens/start.js';
import { onPageScroll, pageScrollTop, scrollPageTo } from '../ui/page-scroll.js';

/* Messenger prototype: 20 in-memory chats, chat list interactions and conversation UI. */

const messagesScreen = document.getElementById('messagesScreen');
const messagesList = document.getElementById('messagesList');
const messagesHead = document.getElementById('messagesHead');
const messagesRefresh = document.getElementById('messagesRefresh');
const messagesMenu = document.getElementById('messagesMenu');
const messagesMenuSheet = document.getElementById('messagesMenuSheet');
const conversationView = document.getElementById('conversationView');
const conversationMessages = document.getElementById('conversationMessages');
const conversationName = document.getElementById('conversationName');
const conversationHandle = document.getElementById('conversationHandle');
const messageComposer = document.getElementById('messageComposer');
const messageInput = document.getElementById('messageInput');
const messageSend = document.getElementById('messageSend');
const chatImageViewer = document.getElementById('chatImageViewer');
const chatImageViewerImage = document.getElementById('chatImageViewerImage');

const CHAT_REPLY_TEXTS = [
  'Sounds great! I’ll send you the details in a moment.',
  'Yes, that works for me. Let’s discuss the dates 🙌',
  'Perfect, thank you! I’m excited to collaborate.',
  'Great idea — I’m available this week.',
  'I’ve checked the brief — everything looks clear.',
  'Amazing! Let’s stay in touch ✨'
];

const CHAT_MESSAGE_TEXTS = [
  'Hey! How are you?', 'Hi! I saw your project and really loved the idea.',
  'Are you available for a shoot next week?', 'Yes, let’s have a call this evening.',
  'I can send the moodboard today.', 'Perfect, I’ll wait for the details 🙌',
  'The location looks amazing!', 'Thank you! It really is a beautiful place.',
  'Could we move it to Friday?', 'Friday works perfectly for me.',
  'What do you think about the new script?', 'It’s much better now, everything is clear.',
  'I’ve uploaded the draft.', 'Got it, I’ll take a look.',
  'I’ll be there by ten.', 'Perfect, see you there!',
  'Can you share the brand guidelines?', 'Of course, I’ll send them a little later.',
  'Love this concept ✨', 'Me too! It feels very natural.'
];

const CHAT_PEOPLE = [
  ['Amara Santos / UGC Bali Content Creator', 'amara.creates', 'women/44', 'ID', 'Bali'],
  ['Theo Janssens', 'theo.janssens', 'men/32', 'BE', 'Antwerp'],
  ['Chloe Martin / Beauty UGC', 'chloe.glow', 'women/32', 'FR', 'Paris'],
  ['Maya Collins', 'maya.collins', 'women/68', 'US', 'Los Angeles'],
  ['Mateo Costa / Fitness Creator', 'mateo.moves', 'men/45', 'ES', 'Barcelona'],
  ['Ethan Brooks / Travel Filmmaker', 'ethan.frames', 'men/22', 'GB', 'London'],
  ['Leo Hartmann', 'leo.hartmann', 'men/52', 'DE', 'Berlin'],
  ['Rafael Silva / Lifestyle UGC', 'rafael.ugc', 'men/36', 'BR', 'Rio de Janeiro'],
  ['Sofia Laurent', 'sofia.laurent', 'women/47', 'FR', 'Nice'],
  ['Nina Kovacs / Food Content Creator', 'nina.tastes', 'women/57', 'HU', 'Budapest'],
  ['Elena Petrova / Travel Creator', 'elena.travels', 'women/65', 'BG', 'Sofia'],
  ['Noah Bennett', 'noah.bennett', 'men/51', 'GB', 'Manchester'],
  ['Ines Moretti / Fashion UGC', 'ines.moretti', 'women/23', 'IT', 'Milan'],
  ['Lucas Ferreira', 'lucas.ferreira', 'men/61', 'PT', 'Lisbon'],
  ['Hana Kim / K-Beauty Creator', 'hana.kbeauty', 'women/50', 'KR', 'Seoul'],
  ['Emma de Vries / Amsterdam Creator', 'emma.creates', 'women/28', 'NL', 'Amsterdam'],
  ['Oliver Chen / Hospitality UGC', 'oliver.hospitality', 'men/15', 'SG', 'Singapore'],
  ['Aya Tanaka', 'aya.tanaka', 'women/71', 'JP', 'Tokyo'],
  ['Zara Malik / Dubai Content Creator', 'zara.dubai', 'women/79', 'AE', 'Dubai'],
  ['Kenji Sato / Product Filmmaker', 'kenji.films', 'men/36', 'JP', 'Osaka']
];

const CHAT_ATTACHMENTS = {
  1: { type: 'link', image: 'https://images.pexels.com/photos/261102/pexels-photo-261102.jpeg?auto=compress&cs=tinysrgb&w=800', title: 'Creative villa shoot in Bali', domain: 'kolaba.app' },
  4: { type: 'image', image: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg?auto=compress&cs=tinysrgb&w=900' },
  9: { type: 'link', image: 'https://images.pexels.com/photos/994523/pexels-photo-994523.jpeg?auto=compress&cs=tinysrgb&w=800', title: 'Spring campaign moodboard', domain: 'figma.com' },
  13: { type: 'image', image: 'https://images.pexels.com/photos/1642125/pexels-photo-1642125.jpeg?auto=compress&cs=tinysrgb&w=900' }
};

let chats = [];
let currentChatId = null;
let messagesListScrollTop = 0;
let messagesPull = null;
let chatGesture = null;
let chatLongPressTimer;
let suppressChatClickUntil = 0;
let typingChatId = null;
let messageSequence = 0;
let conversationReturnProfile = null;
let conversationReturnScreen = 'messages';

function makeChatMessage(chatIndex, index, count, latestAt) {
  const minutesBeforeLatest = (count - index - 1) * (23 + (chatIndex * 7 + index * 11) % 96);
  return {
    id: `message-${chatIndex}-${messageSequence++}`,
    isMine: (chatIndex + index) % 3 === 0 || (chatIndex + index) % 7 === 0,
    text: CHAT_MESSAGE_TEXTS[(chatIndex * 3 + index) % CHAT_MESSAGE_TEXTS.length],
    sentAt: new Date(latestAt.getTime() - minutesBeforeLatest * 60000),
    attachment: index === Math.floor(count / 2) ? CHAT_ATTACHMENTS[chatIndex] || null : null,
    isRead: true
  };
}

function seedChats() {
  const unreadByIndex = new Map([[0, 3], [3, 1], [7, 5], [12, 2]]);
  const now = Date.now();
  chats = CHAT_PEOPLE.map(([name, username, portrait, countryCode, city], index) => {
    const avatarURL = `https://randomuser.me/api/portraits/${portrait}.jpg`;
    const latestAt = new Date(now - (index < 5 ? index * 3 + .4 : 20 + index * 13) * 3600000);
    const count = 8 + (index * 7) % 18;
    const messages = Array.from({ length: count }, (_, messageIndex) => makeChatMessage(index, messageIndex, count, latestAt));
    const unread = unreadByIndex.get(index) || 0;
    if (unread) messages[messages.length - 1].isMine = false;
    return {
      id: `chat-${index + 1}`,
      user: {
        name, username, avatarURL, countryCode, city,
        bio: `${name} creates thoughtful lifestyle and social-first content for brands.`,
        photos: generatedProfilePhotos(avatarURL, index + 12),
        videos: UNIQUE_VERTICAL_VIDEO_LIBRARY.slice(index, index + 5)
      },
      messages, unread,
      isOnline: [0, 2, 5, 9, 14].includes(index),
      isPinned: [1, 6].includes(index),
      isMuted: false,
      updatedAt: latestAt
    };
  });
}

function sortedChats() {
  return [...chats].sort((first, second) => {
    if (first.isPinned !== second.isPinned) return first.isPinned ? -1 : 1;
    return second.updatedAt - first.updatedAt;
  });
}

function messengerTime(date) {
  const now = new Date();
  const value = new Date(date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const difference = Math.round((today - messageDay) / 86400000);
  if (difference === 0) return value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (difference === 1) return 'Yesterday';
  return `${value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function chatLastMessage(chat) {
  return chat.messages[chat.messages.length - 1] || { isMine: false, text: 'No messages yet', sentAt: chat.updatedAt };
}

function escapeMessengerText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function chatRowMarkup(chat) {
  const last = chatLastMessage(chat);
  const unread = chat.unread > 99 ? '99+' : chat.unread;
  return `
    <article class="chat-row${chat.unread ? ' is-unread' : ''}" data-chat-id="${chat.id}">
      <div class="chat-row__actions">
        <button class="chat-row__action chat-row__action--mute" type="button" data-chat-swipe-action="mute"><span>♩</span><span>${chat.isMuted ? 'Unmute' : 'Mute'}</span></button>
        <button class="chat-row__action chat-row__action--delete" type="button" data-chat-swipe-action="delete"><span>×</span><span>Delete</span></button>
      </div>
      <button class="chat-row__main" type="button" aria-label="Open chat with ${escapeMessengerText(chat.user.name)}">
        <span class="chat-avatar-wrap"><img class="chat-avatar" src="${chat.user.avatarURL}" alt="" loading="lazy" decoding="async">${chat.isOnline ? '<i class="chat-online"></i>' : ''}</span>
        <span class="chat-copy"><b>${escapeMessengerText(chat.user.name)}</b><span class="chat-preview">${last.isMine ? 'You: ' : ''}${escapeMessengerText(last.text)}</span></span>
        <span class="chat-meta"><span class="chat-time-line">${chat.isPinned ? '<i class="chat-pin">⌖</i>' : ''}<time class="chat-time">${messengerTime(last.sentAt)}</time></span>${chat.unread ? `<span class="chat-unread">${unread}</span>` : ''}</span>
      </button>
    </article>`;
}

function unreadChatsTotal() {
  return chats.reduce((total, chat) => total + chat.unread, 0);
}

function syncChatBadges() {
  const unread = unreadChatsTotal();
  document.querySelectorAll('[data-chat-badge]').forEach(badge => {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;
    badge.closest('button')?.classList.toggle('has-badge', unread > 0);
  });
}

function renderChats(preserveScroll = true) {
  const scrollTop = preserveScroll ? pageScrollTop() : 0;
  const ordered = sortedChats();
  messagesList.innerHTML = ordered.length
    ? ordered.map(chatRowMarkup).join('')
    : '<div class="messages-empty"><img src="assets/icons/IconMail.svg" alt=""><span>No messages yet</span></div>';
  messagesList.querySelectorAll('.chat-avatar').forEach((image, index) => {
    image.addEventListener('error', () => { image.src = PHOTOS[index % PHOTOS.length]; }, { once: true });
  });
  scrollPageTo(scrollTop, 'auto');
  messagesHead.classList.toggle('is-scrolled', scrollTop > 0);
  syncChatBadges();
}

function findChat(id) {
  return chats.find(chat => chat.id === id);
}

function closeMessagesMenu() {
  messagesMenu.classList.remove('is-open');
  messagesMenu.setAttribute('aria-hidden', 'true');
}

function openMessagesMenu(markup) {
  messagesMenuSheet.innerHTML = markup;
  messagesMenu.classList.add('is-open');
  messagesMenu.setAttribute('aria-hidden', 'false');
}

function openChatContextMenu(chat) {
  if (!chat) return;
  messagesMenu.dataset.chatId = chat.id;
  messagesMenu.dataset.menuType = 'chat';
  openMessagesMenu(`
    <button type="button" data-chat-action="pin">${chat.isPinned ? 'Unpin' : 'Pin'}</button>
    <button type="button" data-chat-action="mute">${chat.isMuted ? 'Unmute' : 'Mute'}</button>
    <button type="button" data-chat-action="read">Mark as read</button>
    <button type="button" data-chat-action="delete">Delete</button>
    <button class="feed-menu__cancel" type="button" data-messages-menu-close>Cancel</button>`);
}

function markChatRead(chat) {
  chat.unread = 0;
  syncChatBadges();
}

function messageDateKey(date) {
  const value = new Date(date);
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function messageDateLabel(date) {
  const value = new Date(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const difference = Math.round((today - day) / 86400000);
  const prefix = difference === 0 ? 'Today' : difference === 1 ? 'Yesterday' : value.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${prefix} ${value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

function messageAttachmentMarkup(attachment) {
  if (!attachment) return '';
  if (attachment.type === 'image') return `<button class="message-bubble message-attachment-image" type="button" data-chat-image="${attachment.image}" aria-label="Open image"><img src="${attachment.image}" alt="Image attachment" loading="lazy"></button>`;
  return `<div class="message-bubble"><div class="message-link"><img src="${attachment.image}" alt="" loading="lazy"><b>${escapeMessengerText(attachment.title)}</b><span>${escapeMessengerText(attachment.domain)}</span></div></div>`;
}

function renderConversation(keepPosition = false) {
  const chat = findChat(currentChatId);
  if (!chat) return;
  conversationName.textContent = chat.user.name;
  conversationHandle.textContent = `@${chat.user.username}`;
  const previousScroll = conversationMessages.scrollTop;
  let previousDate = '';
  conversationMessages.innerHTML = chat.messages.map((message, index) => {
    const next = chat.messages[index + 1];
    const dateKey = messageDateKey(message.sentAt);
    const date = dateKey !== previousDate ? `<div class="message-date">${messageDateLabel(message.sentAt)}</div>` : '';
    const previous = chat.messages[index - 1];
    const isNewAuthor = !previous || previous.isMine !== message.isMine || messageDateKey(previous.sentAt) !== dateKey;
    const isLastInSeries = !next || next.isMine !== message.isMine || messageDateKey(next.sentAt) !== dateKey;
    const content = message.attachment ? messageAttachmentMarkup(message.attachment) : `<div class="message-bubble">${escapeMessengerText(message.text)}</div>`;
    const status = message.isMine && isLastInSeries ? `<div class="message-status">${message.isRead ? 'Read' : 'Sent'}</div>` : '';
    previousDate = dateKey;
    return `${date}<div class="message-line${message.isMine ? ' is-mine' : ''}${isNewAuthor ? ' is-new-author' : ''}${isLastInSeries ? ' is-last-in-series' : ''}">${content}</div>${status}`;
  }).join('');
  if (typingChatId === chat.id) conversationMessages.insertAdjacentHTML('beforeend', '<div class="message-line is-new-author is-last-in-series"><div class="message-bubble typing-bubble" aria-label="Typing"><i></i><i></i><i></i></div></div>');
  if (keepPosition) conversationMessages.scrollTop = previousScroll;
  else requestAnimationFrame(() => { conversationMessages.scrollTop = conversationMessages.scrollHeight; });
}

function openConversation(chat, options = {}) {
  messagesListScrollTop = pageScrollTop();
  currentChatId = chat.id;
  conversationReturnProfile = options.returnProfile || null;
  conversationReturnScreen = options.returnScreen || 'messages';
  markChatRead(chat);
  renderChats();
  renderConversation();
  messagesScreen.classList.add('is-conversation-open');
  // переписка привязана к окну — документ на это время не скроллится
  document.documentElement.classList.add('is-locked');
  conversationView.setAttribute('aria-hidden', 'false');
}

function messengerUsernameForProfile(profile) {
  const supplied = profile.username || profile.handle || '';
  const normalized = String(supplied).replace(/^@+/, '').trim();
  if (normalized) return normalized;
  return String(profile.name || 'creator').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'creator';
}

function findProfileChat(profile) {
  const username = messengerUsernameForProfile(profile).toLowerCase();
  const name = String(profile.name || '').toLowerCase();
  return chats.find(chat => chat.user.username.toLowerCase() === username)
    || chats.find(chat => chat.user.name.toLowerCase() === name);
}

function createProfileChat(profile) {
  const now = Date.now();
  const avatarURL = profile.avatarURL || profile.avatar || profile.photos?.[0] || DEFAULT_AVATAR_URL;
  const name = profile.name || 'Creator';
  const username = messengerUsernameForProfile(profile);
  const messages = [
    { isMine: false, text: 'Hi! Thanks for checking out my profile.', minutesAgo: 128 },
    { isMine: true, text: 'Hey! I’d love to discuss a possible collaboration.', minutesAgo: 121 },
    { isMine: false, text: 'Sounds great — tell me a little more about the project ✨', minutesAgo: 116 }
  ].map((message, index) => ({
    id: `message-profile-${messageSequence++}-${index}`,
    isMine: message.isMine,
    text: message.text,
    sentAt: new Date(now - message.minutesAgo * 60000),
    attachment: null,
    isRead: true
  }));
  const chat = {
    id: `chat-profile-${messageSequence++}`,
    user: {
      name,
      username,
      avatarURL,
      countryCode: profile.countryCode || '',
      city: profile.city || '',
      bio: profile.bio || `${name} creates thoughtful social-first content for brands.`,
      photos: normalizedAuthorPhotos({ ...profile, avatarURL }),
      videos: profile.videos || UNIQUE_VERTICAL_VIDEO_LIBRARY.slice(0, 5)
    },
    messages,
    unread: 0,
    isOnline: true,
    isPinned: false,
    isMuted: false,
    updatedAt: messages.at(-1).sentAt
  };
  chats.push(chat);
  renderChats();
  return chat;
}

window.openMessengerConversationWithProfile = (profile, returnScreen = 'feed') => {
  if (!profile) return;
  const chat = findProfileChat(profile) || createProfileChat(profile);
  show('messages');
  openConversation(chat, { returnProfile: profile, returnScreen });
};

function closeConversation() {
  if (!messagesScreen.classList.contains('is-conversation-open')) return;
  messagesScreen.classList.remove('is-conversation-open');
  document.documentElement.classList.remove('is-locked');
  conversationView.setAttribute('aria-hidden', 'true');
  conversationReturnProfile = null;
  conversationReturnScreen = 'messages';
  renderChats(false);
  requestAnimationFrame(() => scrollPageTo(messagesListScrollTop, 'auto'));
}

function leaveConversation() {
  const returnProfile = conversationReturnProfile;
  const returnScreen = conversationReturnScreen;
  closeConversation();
  if (returnProfile) openExternalProfile(returnProfile, returnScreen);
}

function updateComposerSize() {
  messageInput.style.height = '40px';
  messagesScreen.style.setProperty('--composer-height', '92px');
  const hasText = messageInput.value.trim().length > 0;
  messageSend.disabled = !hasText;
  messageSend.classList.toggle('is-active', hasText);
}

function scheduleChatReply(chat) {
  const typingDelay = 500 + Math.floor(Math.random() * 900);
  window.setTimeout(() => {
    if (!findChat(chat.id)) return;
    typingChatId = chat.id;
    if (currentChatId === chat.id && messagesScreen.classList.contains('is-conversation-open')) renderConversation();
    window.setTimeout(() => {
      if (!findChat(chat.id)) return;
      typingChatId = null;
      const isVisible = currentChatId === chat.id && messagesScreen.classList.contains('is-conversation-open');
      const reply = {
        id: `message-reply-${messageSequence++}`, isMine: false,
        text: CHAT_REPLY_TEXTS[Math.floor(Math.random() * CHAT_REPLY_TEXTS.length)],
        sentAt: new Date(), attachment: null, isRead: isVisible
      };
      const lastMine = [...chat.messages].reverse().find(message => message.isMine);
      if (lastMine) lastMine.isRead = true;
      chat.messages.push(reply);
      chat.updatedAt = reply.sentAt;
      if (!reply.isRead) chat.unread += 1;
      if (isVisible) renderConversation();
      renderChats();
    }, 1000);
  }, typingDelay);
}

document.getElementById('messagesMore').addEventListener('click', () => {
  messagesMenu.dataset.menuType = 'list';
  openMessagesMenu('<button type="button" data-messages-action="read-all">Mark all as read</button><button type="button" data-messages-action="archived">Archived</button><button type="button" data-messages-action="requests">Message requests</button><button type="button" data-messages-action="settings">Settings</button><button class="feed-menu__cancel" type="button" data-messages-menu-close>Cancel</button>');
});

messagesMenu.addEventListener('click', event => {
  if (event.target.closest('[data-messages-menu-close]')) return closeMessagesMenu();
  const listAction = event.target.closest('[data-messages-action]')?.dataset.messagesAction;
  if (listAction) {
    if (listAction === 'read-all') {
      chats.forEach(chat => { chat.unread = 0; });
      renderChats();
    }
    return closeMessagesMenu();
  }
  const chatAction = event.target.closest('[data-chat-action]')?.dataset.chatAction;
  if (chatAction) {
    const chat = findChat(messagesMenu.dataset.chatId);
    if (!chat) return closeMessagesMenu();
    if (chatAction === 'pin') chat.isPinned = !chat.isPinned;
    if (chatAction === 'mute') chat.isMuted = !chat.isMuted;
    if (chatAction === 'read') markChatRead(chat);
    if (chatAction === 'delete') chats = chats.filter(item => item.id !== chat.id);
    renderChats();
    return closeMessagesMenu();
  }
  const conversationAction = event.target.closest('[data-conversation-action]')?.dataset.conversationAction;
  if (!conversationAction) return;
  const chat = findChat(currentChatId);
  if (!chat) return closeMessagesMenu();
  if (conversationAction === 'profile') {
    closeMessagesMenu();
    return openExternalProfile(chat.user, 'messages');
  }
  if (conversationAction === 'mute') chat.isMuted = !chat.isMuted;
  if (conversationAction === 'clear') chat.messages = [];
  renderConversation();
  closeMessagesMenu();
});

messagesList.addEventListener('pointerdown', event => {
  const row = event.target.closest('.chat-row');
  if (!row || event.target.closest('.chat-row__action')) return;
  window.clearTimeout(chatLongPressTimer);
  chatGesture = { row, id: row.dataset.chatId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, axis: null };
  chatLongPressTimer = window.setTimeout(() => {
    if (!chatGesture || chatGesture.id !== row.dataset.chatId) return;
    suppressChatClickUntil = performance.now() + 500;
    openChatContextMenu(findChat(row.dataset.chatId));
    chatGesture = null;
  }, 560);
});

messagesList.addEventListener('pointermove', event => {
  if (!chatGesture || event.pointerId !== chatGesture.pointerId) return;
  const dx = event.clientX - chatGesture.x;
  const dy = event.clientY - chatGesture.y;
  if (!chatGesture.axis && Math.hypot(dx, dy) > 7) {
    chatGesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    window.clearTimeout(chatLongPressTimer);
  }
  if (chatGesture.axis !== 'x') return;
  event.preventDefault();
  chatGesture.dx = Math.max(-192, Math.min(0, dx + (chatGesture.row.classList.contains('is-revealed') ? -192 : 0)));
  chatGesture.row.querySelector('.chat-row__main').style.transform = `translateX(${chatGesture.dx}px)`;
});

function finishChatGesture(event) {
  if (!chatGesture || event.pointerId !== chatGesture.pointerId) return;
  window.clearTimeout(chatLongPressTimer);
  const { row, dx, axis } = chatGesture;
  chatGesture = null;
  row.classList.toggle('is-revealed', axis === 'x' && dx < -70);
  row.querySelector('.chat-row__main').style.transform = '';
  if (axis === 'x') suppressChatClickUntil = performance.now() + 300;
}

messagesList.addEventListener('pointerup', finishChatGesture);
messagesList.addEventListener('pointercancel', finishChatGesture);
messagesList.addEventListener('click', event => {
  const row = event.target.closest('.chat-row');
  if (!row) return;
  const chat = findChat(row.dataset.chatId);
  if (!chat) return;
  const action = event.target.closest('[data-chat-swipe-action]')?.dataset.chatSwipeAction;
  if (action === 'mute') {
    chat.isMuted = !chat.isMuted;
    return renderChats();
  }
  if (action === 'delete') {
    chats = chats.filter(item => item.id !== chat.id);
    return renderChats();
  }
  if (performance.now() < suppressChatClickUntil) return;
  if (row.classList.contains('is-revealed')) {
    row.classList.remove('is-revealed');
    return;
  }
  openConversation(chat);
});

onPageScroll(() => messagesHead.classList.toggle('is-scrolled', pageScrollTop() > 0));
messagesList.addEventListener('pointerdown', event => {
  if (pageScrollTop() > 0 || event.target.closest('.chat-row__action')) return;
  messagesPull = { y: event.clientY, distance: 0 };
});
messagesList.addEventListener('pointermove', event => {
  if (!messagesPull || chatGesture?.axis === 'x') return;
  messagesPull.distance = Math.max(0, event.clientY - messagesPull.y);
  if (messagesPull.distance > 14) {
    messagesRefresh.classList.add('is-visible');
    messagesRefresh.querySelector('span').textContent = messagesPull.distance > 62 ? 'Release to refresh' : 'Pull to refresh';
  }
});
messagesList.addEventListener('pointerup', () => {
  if (!messagesPull) return;
  const refresh = messagesPull.distance > 62;
  messagesPull = null;
  if (!refresh) return messagesRefresh.classList.remove('is-visible');
  messagesRefresh.classList.add('is-visible', 'is-loading');
  messagesRefresh.querySelector('span').textContent = 'Refreshing…';
  window.setTimeout(() => {
    const amount = 1 + Math.floor(Math.random() * 2);
    shuffled(chats).slice(0, amount).forEach((chat, index) => {
      const incoming = { id: `message-refresh-${messageSequence++}`, isMine: false, text: CHAT_REPLY_TEXTS[(messageSequence + index) % CHAT_REPLY_TEXTS.length], sentAt: new Date(Date.now() + index), attachment: null, isRead: false };
      chat.messages.push(incoming);
      chat.updatedAt = incoming.sentAt;
      chat.unread += 1;
    });
    renderChats(false);
    messagesRefresh.classList.remove('is-visible', 'is-loading');
  }, 550);
});
messagesList.addEventListener('pointercancel', () => {
  messagesPull = null;
  messagesRefresh.classList.remove('is-visible', 'is-loading');
});

document.getElementById('conversationBack').addEventListener('click', leaveConversation);
document.getElementById('conversationPerson').addEventListener('click', () => {
  const chat = findChat(currentChatId);
  if (chat) openExternalProfile(chat.user, 'messages');
});
document.getElementById('conversationMore').addEventListener('click', () => {
  const chat = findChat(currentChatId);
  if (!chat) return;
  messagesMenu.dataset.menuType = 'conversation';
  openMessagesMenu(`<button type="button" data-conversation-action="profile">Profile</button><button type="button" data-conversation-action="mute">${chat.isMuted ? 'Unmute' : 'Mute'}</button><button type="button" data-conversation-action="block">Block</button><button type="button" data-conversation-action="clear">Clear chat</button><button class="feed-menu__cancel" type="button" data-messages-menu-close>Cancel</button>`);
});

messageInput.addEventListener('input', updateComposerSize);
messageInput.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (messageInput.value.trim()) messageComposer.requestSubmit();
});
messageComposer.addEventListener('submit', event => {
  event.preventDefault();
  const text = messageInput.value.trim();
  const chat = findChat(currentChatId);
  if (!text || !chat) return;
  const message = { id: `message-sent-${messageSequence++}`, isMine: true, text, sentAt: new Date(), attachment: null, isRead: false };
  chat.messages.push(message);
  chat.updatedAt = message.sentAt;
  messageInput.value = '';
  updateComposerSize();
  renderConversation();
  renderChats();
  scheduleChatReply(chat);
  // клавиатура должна остаться открытой, а лента — прижатой к последнему сообщению
  messageInput.focus({ preventScroll: true });
  requestAnimationFrame(() => {
    conversationMessages.scrollTo({ top: conversationMessages.scrollHeight, behavior: 'auto' });
  });
});

conversationMessages.addEventListener('click', event => {
  const image = event.target.closest('[data-chat-image]');
  if (!image) return;
  chatImageViewerImage.src = image.dataset.chatImage;
  chatImageViewer.classList.add('is-open');
  chatImageViewer.setAttribute('aria-hidden', 'false');
});
document.getElementById('chatImageViewerBack').addEventListener('click', () => {
  chatImageViewer.classList.remove('is-open');
  chatImageViewer.setAttribute('aria-hidden', 'true');
  window.setTimeout(() => { chatImageViewerImage.src = ''; }, 220);
});

let conversationEdgeGesture = null;
conversationView.addEventListener('pointerdown', event => {
  const rect = messagesScreen.getBoundingClientRect();
  if (event.clientX - rect.left <= 24) conversationEdgeGesture = { x: event.clientX, y: event.clientY };
});
conversationView.addEventListener('pointerup', event => {
  if (!conversationEdgeGesture) return;
  const dx = event.clientX - conversationEdgeGesture.x;
  const dy = event.clientY - conversationEdgeGesture.y;
  conversationEdgeGesture = null;
  if (dx > 70 && Math.abs(dx) > Math.abs(dy)) leaveConversation();
});
conversationView.addEventListener('pointercancel', () => { conversationEdgeGesture = null; });
window.visualViewport?.addEventListener('resize', () => {
  if (messagesScreen.classList.contains('is-conversation-open')) requestAnimationFrame(() => { conversationMessages.scrollTop = conversationMessages.scrollHeight; });
});

seedChats();
renderChats(false);
updateComposerSize();

// Random User supplies live portraits; the bundled JSON keeps the prototype usable offline.
fetch('https://randomuser.me/api/?results=20&inc=picture')
  .then(response => response.ok ? response.json() : Promise.reject(new Error('Random User unavailable')))
  .then(data => data.results.map(result => result.picture.large))
  .catch(() => fetch('assets/data/authors.json').then(response => response.json()).then(data => data.map(author => author.avatar)))
  .then(avatars => {
    if (!Array.isArray(avatars)) return;
    chats.forEach((chat, index) => {
      const avatarURL = avatars[index];
      if (!avatarURL) return;
      chat.user.avatarURL = avatarURL;
      chat.user.photos = generatedProfilePhotos(avatarURL, index + 12);
    });
    renderChats();
  })
  .catch(() => {});
