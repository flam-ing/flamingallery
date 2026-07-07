# 데패뉴 3D 뉴스룸

오늘의 데패뉴 뉴스가 걸리는 WebXR 가상 갤러리. `dfn-products`에서 분리된 독립 프로젝트.

three.js r160(로컬 벤더드, CDN 없음) + 프레임워크 없는 순수 HTML/CSS/JS. `shared/data/news.json`이 바뀌면 전시도 매일 바뀝니다.

## 실행

```bash
python3 -m http.server 4174
# → http://localhost:4174/
```

## 조작

- 데스크톱: 드래그로 시점 회전, WASD/화살표로 이동, 휠로 전후진
- 모바일: 원핑거 회전, 하단 스틱/투핑거로 이동
- 액자 클릭 → 다가가서 상세 패널, ESC/닫기로 복귀
- VR 헤드셋 있으면 하단 버튼으로 WebXR 입장

## 사진 채워넣기 (예정)

지금은 사진 없이 캔버스 타이포 카드로만 액자를 그립니다. 사진을 채워 넣을 때는 [photos/README.md](photos/README.md) 참고.

## 데이터 갱신

```bash
python3 shared/fetch_notion.py
```

`shared/data/news.json`을 노션에서 다시 스냅샷 — 토큰은 `~/.openclaw/openclaw.json` 재사용.

## 구조

```
index.html / main.js / style.css   전시장 본체
photos/                            (예정) 실사진 채워 넣을 자리
shared/
  brand.css                        데패뉴 디자인 토큰
  assets/fonts, assets/brand       Pretendard/Poppins, 로고 워드마크
  vendor/                          three.js r160 (로컬 벤더드)
  data/news.json                   노션 스냅샷
  fetch_notion.py                  데이터 리프레시 스크립트
```

원래 `dfn-products` 모노레포의 일부였으나 이미지 작업을 위해 별도 저장소로 분리됨. 자매 프로젝트: [dfn-products](https://github.com/minwoo19930301/dfn-products) (콕핏 대시보드 · 프라이스 배틀 게임).
