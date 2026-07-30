/* Состояние, которое меняют сразу несколько экранов */

export const state = {
  /* звук в ленте видео: общий для ленты, роликов и уведомлений */
  videoSoundEnabled: false,
  /* оформлена ли подписка kolaba.pro */
  isProjectsPro: false,
  /* гражданство и текущее местоположение: их меняют и шторка выбора, и настройки */
  selectedCountryCode: 'ID',
  selectedLocation: { label: 'Bali, Indonesia', code: 'ID' }
};
