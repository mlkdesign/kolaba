// The whole phone is scaled by one transform (shell.css): pointer distances measured in window pixels are divided
// by this to get the app's own CSS pixels (402 × 874 screen).
export const uiScale = () => Number(document.documentElement.style.getPropertyValue('--ui-scale')) || 1;
