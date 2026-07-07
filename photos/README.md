# 여기에 사진을 넣으세요

나중에 뉴스 액자에 쓸 실사진을 이 폴더에 채워 넣을 예정입니다.

현재 `main.js`의 `drawCardCanvas()`는 사진 없이 캔버스 타이포 카드만 그립니다.
사진을 붙일 때는:

1. 이 폴더에 이미지 파일을 넣는다 (예: `photos/01-levis.jpg`)
2. `shared/data/news.json` 각 아이템에 `photo` 필드 추가 고려 (예: `"photo": "./photos/01-levis.jpg"`)
3. `main.js`의 `drawCardCanvas()`에서 `loadImage()`로 로드해 캔버스 상단에 그리고, 그 아래 타이포를 배치하도록 확장

지금은 빈 폴더입니다 — 나중에 채우기 전까지는 기존 타이포 카드 그대로 유지됩니다.
