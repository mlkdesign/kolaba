/* Экранная клавиатура.

   Высоту клавиатуры считаем по visualViewport и кладём в переменную --kb
   (в пикселях, без единиц) — её использует композер мессенджера. После
   каждого изменения высоты прижимаем переписку к последнему сообщению
   и держим сфокусированное поле в видимой части экрана. */

const kbRoot = document.documentElement;
let keyboardHeight = 0;

function measure() {
  const view = window.visualViewport;
  if (!view) return 0;
  // Часть окна, закрытая клавиатурой снизу
  const hidden = window.innerHeight - view.height - view.offsetTop;
  return Math.max(0, Math.round(hidden));
}

function focusedField() {
  const el = document.activeElement;
  if (!el) return null;
  const tag = el.tagName;
  return (tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable) ? el : null;
}

function scrollConversationToEnd() {
  const messages = document.getElementById('conversationMessages');
  if (!messages) return;
  const screen = document.getElementById('messagesScreen');
  if (!screen?.classList.contains('is-conversation-open')) return;
  messages.scrollTo({ top: messages.scrollHeight, behavior: 'auto' });
}

function apply() {
  const next = measure();
  if (next === keyboardHeight) return;
  keyboardHeight = next;
  kbRoot.style.setProperty('--kb', String(next));
  kbRoot.classList.toggle('is-keyboard-open', next > 0);

  window.requestAnimationFrame(() => {
    scrollConversationToEnd();
    if (next > 0) {
      const field = focusedField();
      // Композер мессенджера поднимается через --kb, его двигать не нужно
      if (field && !field.closest('.message-composer')) {
        field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });
}

function startKeyboard() {
  const view = window.visualViewport;
  if (view) {
    view.addEventListener('resize', apply);
    view.addEventListener('scroll', apply);
  }
  // Поле могло получить фокус до того, как клавиатура изменила visualViewport
  document.addEventListener('focusin', () => window.setTimeout(apply, 150), true);
  document.addEventListener('focusout', () => window.setTimeout(apply, 150), true);
  apply();
}

export { keyboardHeight, startKeyboard };
