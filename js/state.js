// Общее состояние игры (чтобы модули не зависели друг от друга циклически)
// uniform'ы, общие для шейдеров зданий: ночь 0..1
export const UNI = { night: { value: 0 } };

export const G = {
  THREE: null,
  scene: null, camera: null, renderer: null,
  tex: null,           // процедурные текстуры
  env: null,           // небо, время, погода
  player: null,
  peds: [], vehicles: [], projectiles: [], effects: [],
  graph: null,         // дорожный граф
  roads: [],
  districts: [],
  quality: 'high',
  paused: true,
  started: false,
  time: 0,             // игровое время в секундах реального времени
  input: { keys: {}, mouseDX: 0, mouseDY: 0, buttons: {}, wheel: 0, pressed: {} },
  money: 1500,
  stats: { kills: 0, cars: 0, districts: 0, days: 0 },
};
