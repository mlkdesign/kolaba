/* Sign Up / Log In: переключатель режима и показ пароля */

/* ── Sign Up / Log In ── */
const authSwitch = document.getElementById('authSwitch');

authSwitch.addEventListener('click', event => {
  const item = event.target.closest('.segmented__item');
  if (!item) return;

  authSwitch.querySelectorAll('.segmented__item').forEach(button => {
    button.classList.toggle('is-active', button === item);
  });
  authSwitch.classList.toggle('is-second', item.dataset.mode === 'Log In');
  document.querySelectorAll('.js-mode').forEach(node => node.textContent = item.dataset.mode);
});

/* ── Показать пароль ── */
const password = document.getElementById('pwd');
const toggle = document.getElementById('pwdToggle');

toggle.addEventListener('click', () => {
  const shown = password.type === 'text';
  password.type = shown ? 'password' : 'text';
  toggle.firstElementChild.src = shown ? 'assets/icons/IconEyeOff.svg' : 'assets/icons/IconEye.svg';
});
