// Игровые данные: банды, оружие, транспорт, магазины
export const GANGS = {
  valera: { name: 'Пацаны Валеры', color: '#3aa0ff', hex: 0x3aa0ff },
  salt: { name: 'Солевые', color: '#74d84a', hex: 0x74d84a, shout: ['Дай на соль, братан...', 'Ты чё, мент?', 'Э-э, кинь тыщу!', 'Не гони, всё норм...'] },
  punk: { name: 'Панки и эмо', color: '#d24be0', hex: 0xd24be0, shout: ['Panks not dead!', 'Мир — фигня, всё — боль!', 'Вали отсюда, поц!', 'Анархия — мать порядка!'] },
  gop: { name: 'Гопники', color: '#f2a231', hex: 0xf2a231, shout: ['Э, слышь, есть чё?', 'Ты с какого района?', 'Пацан, дай позвонить!', 'По-о-огоди, братан!'] },
  rus: { name: 'Новые русские', color: '#e23a3a', hex: 0xe23a3a, shout: ['Ты кто такой, а?', 'Вопросы порешаем, брат.', 'Тут мой район, понял?', 'Малиновый пиджак не трогай.'] },
};
export const GANG_IDS = ['salt', 'punk', 'gop', 'rus'];

// slot — номер клавиши 1..9
export const WEAPONS = {
  fist: { name: 'Кулаки', slot: 1, melee: true, dmg: 14, rate: 0.42, range: 1.7, price: 0 },
  bat: { name: 'Бита', slot: 2, melee: true, dmg: 38, rate: 0.72, range: 2.3, price: 300 },
  knife: { name: 'Нож', slot: 2, melee: true, dmg: 50, rate: 0.45, range: 1.7, price: 400 },
  pm: { name: 'ПМ', slot: 3, mag: 8, dmg: 26, rate: 0.28, spread: 0.02, range: 90, price: 2500, ammoPack: 24, ammoPrice: 300, ammoType: 'pistol', snd: 'pistol' },
  obrez: { name: 'Обрез', slot: 4, mag: 2, dmg: 13, pellets: 9, rate: 0.85, spread: 0.11, range: 40, price: 4500, ammoPack: 8, ammoPrice: 300, ammoType: 'shell', snd: 'shotgun' },
  mr153: { name: 'МР-153', slot: 4, mag: 6, dmg: 14, pellets: 9, rate: 0.8, spread: 0.09, range: 50, price: 9000, ammoPack: 12, ammoPrice: 450, ammoType: 'shell', snd: 'shotgun' },
  kedr: { name: 'ПП «Кедр»', slot: 5, mag: 30, dmg: 15, rate: 0.075, spread: 0.05, range: 70, auto: true, price: 12000, ammoPack: 60, ammoPrice: 500, ammoType: 'smg', snd: 'smg' },
  akm: { name: 'АКМ', slot: 6, mag: 30, dmg: 28, rate: 0.1, spread: 0.035, range: 150, auto: true, price: 20000, ammoPack: 60, ammoPrice: 800, ammoType: 'rifle', snd: 'rifle' },
  grenade: { name: 'Граната Ф-1', slot: 7, thrown: 'grenade', price: 1200, ammoPack: 1, ammoPrice: 1200, ammoType: 'grenade' },
  molotov: { name: 'Коктейль Молотова', slot: 8, thrown: 'molotov', price: 500, ammoPack: 1, ammoPrice: 500, ammoType: 'molotov' },
};
export const AMMO_TYPES = ['pistol', 'shell', 'smg', 'rifle'];

// Транспорт. len/wid — габариты, профиль в долях длины (0 — задний бампер).
export const VEHICLES = {
  vaz2107: { name: 'Жигули 2107', kind: 'car', len: 4.15, wid: 1.62, wr: 0.31, top: 1.0, cabH: 0.5, c0: 0.22, c1: 0.7, t0: 0.3, t1: 0.6, hood: 0.86, max: 30, acc: 9, hp: 900, colors: ['#8a1f1f', '#d8d8c8', '#2a5a8a', '#3a6a3a', '#c8b060', '#6a4a2a', '#4a4a4a'] },
  vaz2109: { name: 'Лада 2109', kind: 'car', len: 4.0, wid: 1.6, wr: 0.3, top: 0.95, cabH: 0.5, c0: 0.16, c1: 0.7, t0: 0.2, t1: 0.6, hood: 0.8, max: 32, acc: 10, hp: 850, colors: ['#c02a2a', '#e8e8e8', '#4a7ac0', '#2a2a2a', '#d0a030'] },
  volga: { name: 'Волга ГАЗ-3110', kind: 'car', len: 4.85, wid: 1.8, wr: 0.34, top: 1.02, cabH: 0.5, c0: 0.2, c1: 0.7, t0: 0.28, t1: 0.62, hood: 0.88, max: 33, acc: 9, hp: 1100, colors: ['#1a1a1a', '#e8e8e8', '#4a4a5a', '#7a1a1a', '#1a3a2a'] },
  moskvich: { name: 'Москвич-2141', kind: 'car', len: 4.35, wid: 1.68, wr: 0.31, top: 1.0, cabH: 0.5, c0: 0.14, c1: 0.7, t0: 0.2, t1: 0.62, hood: 0.82, max: 30, acc: 8.5, hp: 850, colors: ['#5a7a9a', '#b8b8a8', '#8a5a2a', '#6a2a2a'] },
  uaz: { name: 'УАЗ-469', kind: 'car', len: 4.0, wid: 1.8, wr: 0.38, top: 1.5, cabH: 0.62, c0: 0.16, c1: 0.7, t0: 0.16, t1: 0.7, hood: 1.15, max: 27, acc: 8, hp: 1300, colors: ['#5a6a3a', '#7a7a3a', '#4a5a2a', '#aaaaaa'] },
  gazel: { name: 'ГАЗель', kind: 'van', len: 5.5, wid: 2.0, wr: 0.36, top: 1.75, cabH: 0.75, c0: 0.05, c1: 0.98, t0: 0.05, t1: 0.75, hood: 1.4, max: 27, acc: 7, hp: 1200, colors: ['#e8e8e8', '#c8c8b8', '#8ab0d0'] },
  bmw: { name: 'БМВ 525 (бумер)', kind: 'car', len: 4.75, wid: 1.78, wr: 0.34, top: 0.98, cabH: 0.48, c0: 0.2, c1: 0.72, t0: 0.3, t1: 0.62, hood: 0.84, max: 40, acc: 13, hp: 1100, colors: ['#0a0a0a', '#101a28'] },
  mers: { name: 'Мерседес 600 (W140)', kind: 'car', len: 5.15, wid: 1.9, wr: 0.36, top: 1.08, cabH: 0.5, c0: 0.18, c1: 0.74, t0: 0.26, t1: 0.66, hood: 0.92, max: 41, acc: 13, hp: 1400, colors: ['#0a0a0a', '#1a1a2a', '#3a3a3a'] },
  taxi: { name: 'Такси (Волга)', kind: 'car', len: 4.85, wid: 1.8, wr: 0.34, top: 1.02, cabH: 0.5, c0: 0.2, c1: 0.7, t0: 0.28, t1: 0.62, hood: 0.88, max: 32, acc: 9, hp: 1100, colors: ['#f2c400'], taxi: true },
  bus: { name: 'Автобус ЛиАЗ', kind: 'bus', len: 11.5, wid: 2.5, wr: 0.5, top: 3.0, cabH: 0.0, c0: 0.0, c1: 1.0, t0: 0.0, t1: 1.0, hood: 3.0, max: 20, acc: 4.2, hp: 3000, colors: ['#e8e2c8', '#d0d8e0'], bus: true },
  militsia: { name: 'Милицейская Лада', kind: 'car', len: 4.15, wid: 1.62, wr: 0.31, top: 1.0, cabH: 0.5, c0: 0.22, c1: 0.7, t0: 0.3, t1: 0.6, hood: 0.86, max: 38, acc: 12, hp: 1100, colors: ['#e8eef4'], police: true },
  militsia2: { name: 'Милицейский УАЗ', kind: 'car', len: 4.3, wid: 1.85, wr: 0.38, top: 1.6, cabH: 0.6, c0: 0.1, c1: 0.9, t0: 0.1, t1: 0.9, hood: 1.15, max: 34, acc: 11, hp: 1500, colors: ['#e8d060'], police: true },
  ambulance: { name: 'Скорая (УАЗ)', kind: 'van', len: 4.6, wid: 1.9, wr: 0.38, top: 1.9, cabH: 0.8, c0: 0.06, c1: 0.98, t0: 0.06, t1: 0.75, hood: 1.4, max: 32, acc: 9, hp: 1200, colors: ['#f4f4f4'], ambulance: true },
  bike: { name: 'Велосипед «Аист»', kind: 'bike', len: 1.75, wid: 0.5, wr: 0.34, max: 8.5, acc: 6, hp: 120, colors: ['#c0302a', '#2a6ac0', '#2a2a2a', '#3a9a3a', '#e0a020'] },
};
export const TRAFFIC_MIX = ['vaz2107', 'vaz2107', 'vaz2109', 'vaz2109', 'volga', 'moskvich', 'uaz', 'gazel', 'gazel', 'taxi', 'taxi', 'bmw', 'mers', 'bus', 'bus'];

export const SHOPS = {
  shop: { title: 'Продукты', items: [
    { name: 'Сосиска в тесте', desc: '+15 здоровья', price: 60, heal: 15 },
    { name: 'Пельмени «Сибирские»', desc: '+35 здоровья', price: 150, heal: 35 },
    { name: 'Энергетик', desc: 'Полная выносливость', price: 90, stamina: true },
    { name: 'Сигареты «Прима»', desc: 'Ничего не делает. Но стильно.', price: 40, junk: true },
  ] },
  pharm: { title: 'Аптека', items: [
    { name: 'Бинт', desc: '+25 здоровья', price: 100, heal: 25 },
    { name: 'Аптечка', desc: 'Полное здоровье', price: 350, heal: 999 },
    { name: 'Нашатырь', desc: '+10 здоровья, бодрит', price: 50, heal: 10, stamina: true },
  ] },
  food: { title: 'Общепит', items: [
    { name: 'Шашлык', desc: '+45 здоровья', price: 250, heal: 45 },
    { name: 'Пиво «Балтика 9»', desc: '+10 здоровья', price: 80, heal: 10 },
    { name: 'Квас', desc: '+10 здоровья', price: 40, heal: 10 },
  ] },
  weapon: { title: 'ЦУМ — отдел «Охотник»', items: [
    { name: 'Бита', desc: 'Ближний бой', weapon: 'bat', price: 300 },
    { name: 'Нож', desc: 'Ближний бой', weapon: 'knife', price: 400 },
    { name: 'ПМ (Макаров)', desc: 'Пистолет', weapon: 'pm', price: 2500 },
    { name: 'Патроны ПМ ×24', desc: '', ammo: 'pm', price: 300 },
    { name: 'МР-153', desc: 'Помповый дробовик', weapon: 'mr153', price: 9000 },
    { name: 'Патроны 12к ×12', desc: '', ammo: 'mr153', price: 450 },
    { name: 'Бронежилет', desc: '+100 брони', armor: 100, price: 3000 },
  ] },
  black: { title: 'Чёрный рынок «Гаражи»', items: [
    { name: 'Обрез', desc: 'Двустволка. Вблизи страшно.', weapon: 'obrez', price: 4500 },
    { name: 'ПП «Кедр»', desc: 'Автомат', weapon: 'kedr', price: 12000 },
    { name: 'АКМ', desc: 'Классика', weapon: 'akm', price: 20000 },
    { name: 'Патроны «Кедр» ×60', desc: '', ammo: 'kedr', price: 500 },
    { name: 'Патроны АКМ ×60', desc: '', ammo: 'akm', price: 800 },
    { name: 'Патроны для обреза ×8', desc: '', ammo: 'obrez', price: 300 },
    { name: 'Граната Ф-1', desc: 'Бабах', weapon: 'grenade', price: 1200 },
    { name: 'Коктейль Молотова', desc: 'Огонь', weapon: 'molotov', price: 500 },
    { name: 'Бронежилет', desc: '+100 брони', armor: 100, price: 3000 },
  ] },
  repair: { title: 'Ремонт 3000', items: [
    { name: 'Починить машину', desc: 'Полный ремонт транспорта', price: 500, repair: true },
    { name: 'Перекрасить и сменить номера', desc: 'Сбросить розыск (нужно быть на машине)', price: 1500, wanted: true },
  ] },
  gym: { title: 'Wellness Club', items: [
    { name: 'Тренировка', desc: '+10 к макс. здоровью (до 150)', price: 800, maxhp: 10 },
    { name: 'Кардио', desc: 'Полная выносливость', price: 100, stamina: true },
  ] },
  home: { title: 'Дом', items: [
    { name: 'Сохранить игру', desc: 'Сохранение в браузере', price: 0, save: true },
    { name: 'Поспать до утра', desc: 'Восстановить здоровье, 08:00', price: 0, sleep: true },
  ] },
};
