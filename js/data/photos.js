/* Каталог фотографий Pexels для стены, профиля и ленты */

/* Прототип kolaba: экраны приложения внутри мокапа iPhone. */

const DEFAULT_AVATAR_URL = 'https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=480&h=480';
const PHOTOS = [415829, 994523, 1884584, 2983464, 3762879].map(id =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=480&h=480`
);

const THEMED_PHOTO_IDS = {
  model: [415829, 994523, 1884584, 2983464, 3762879],
  restaurant: [302899, 70497, 262978],
  villa: [261102, 259588, 1642125, 1732414],
  girlBeach: [11836504, 1755428, 1391498],
  girlDog: [1108099, 1805164],
  stylishMan: [1043474, 1681010, 2379004]
};
const WALL_PHOTO_IDS = Object.values(THEMED_PHOTO_IDS).flat();

const WALL_PHOTOS = WALL_PHOTO_IDS.map(id =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=320&h=568`
);

export { DEFAULT_AVATAR_URL, PHOTOS, THEMED_PHOTO_IDS, WALL_PHOTOS };
