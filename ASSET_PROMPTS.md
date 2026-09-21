# Текстуры и модели: как улучшить графику с помощью ChatGPT

Сейчас все текстуры и 3D-модели **генерируются кодом** (`js/assets.js`, `js/models.js`): это не требует внешних файлов, игра грузится мгновенно и идёт на слабых компьютерах. Когда захотите красивее — любую текстуру можно заменить картинкой.

## Как подменить текстуру

1. Сгенерируйте PNG (промпты ниже), сохраните в `assets/textures/`.
2. Впишите файл в `assets/textures/manifest.json`:
   ```json
   { "textures": { "roadStreet": "asphalt_street.png", "facade": "facade_panel.png", "faces": "faces_atlas.png" } }
   ```
3. Обновите страницу. Файлы, которых нет в манифесте, остаются процедурными.

Доступные ключи: `roadLane`, `roadStreet`, `roadMajor`, `sidewalk`, `grass`, `dirt`, `water`, `facade`, `facadeMask`, `faces`.

## Промпты для ChatGPT (генерация изображений)

Общее: «бесшовная (tileable) текстура, вид строго сверху/спереди, без перспективы, без теней, без текста, PNG, квадрат».

**Асфальт (`roadStreet`, 256×256 → лучше 1024×1024)**
> Seamless tileable top-down texture of worn Russian city asphalt, dark grey with fine cracks and patches. A single white dashed center line runs vertically through the middle of the image, thin solid white edge lines at 3% from left and right borders. No perspective, no shadows, flat lighting, 1024x1024.

**Панельный дом (`facade`, один пролёт × один этаж, 1024×1024)**
> Seamless tileable facade tile of a Soviet-era prefabricated panel apartment building (khrushchyovka), one window bay per tile: pale concrete panel with subtle seams along bottom and left edge, one white PVC double window with a grey sill in the center, front view, flat lighting, no perspective. Window glass should be plain dark blue.
Для `facadeMask` — та же картинка, где стекла окна залиты белым, всё остальное чёрное.

**Лица персонажей (`faces`, атлас 512×512, сетка 4×4, ячейки по 128 px)**
> A 4x4 sprite sheet of 16 stylized low-poly-game character faces, front view, flat cartoon shading, each face in its own 128x128 cell. Cell 1 (top row, second): a young man with light freckled skin, gray-blue eyes, a thin ginger goatee, neutral serious expression. Other cells: generic men, a punk with eyeliner and piercing, an emo boy with a black side fringe, a tough gopnik, a pale salt-addict with dark circles, a stern rich businessman, two women, an old man, a police officer. Cell 0 (top-left) must be a plain flat skin-tone square.
Порядок ячеек: 0 нейтральная, 1 Валера, 2–5 мужчины, 6 суровый, 7 панк, 8 эмо, 9 гопник, 10 солевой, 11 «новый русский», 12–13 женщины, 14 старик, 15 милиционер.

**Фото Валеры → лицо.** Загрузите фото в ChatGPT и попросите: «Сделай стилизованное лицо этого человека для ячейки 128×128 игры в стиле low-poly: вид спереди, плоская заливка, без фона, сохрани веснушки, серо-голубые глаза и рыжую бородку». Вставьте результат во вторую ячейку атласа.

## 3D-модели (когда дойдёте до этого)

Формат — **glTF/GLB**. Рабочий процесс:
1. Генерация базы: ChatGPT (картинка-референс «car, orthographic side/front/back views, low poly») → сервис image-to-3D (Meshy, Tripo, Hunyuan3D) → GLB.
2. В Blender: снизить полигоны до 1–3 тыс. (Decimate), выровнять ось «вперёд» на +Z, начало координат — в центре под колёсами, колёса отдельными объектами (`wheel_fl` … `wheel_rr`), экспорт GLB.
3. Подключение: подключить `GLTFLoader` (лежит в `three/examples/jsm/loaders`) и заменить вызов `buildVehicle()` в `js/models.js` на загрузку модели — интерфейс `{ group, parts:{fAxle, rAxle, head, tail, siren} }` менять не нужно.

Персонажи: сейчас скелет из блоков с раскраской по вершинам; для замены — Mixamo-риг + `SkinnedMesh`. Это самый трудоёмкий шаг, поэтому его разумно делать после миссий и расширения карты.
