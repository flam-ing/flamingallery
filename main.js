/* ═══════════════════════════════════════════════════════════════
   2D Art Gallery — WebXR 가상 전시장
   news.json 항목이 매일 벽에 걸리는 크림 화이트 갤러리
   three.js r160 (로컬 벤더드) · 프레임워크 없음
   ═══════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { VRButton } from './shared/vendor/VRButton.js';

/* ── 상수 ──────────────────────────────────────────────────── */

const COLOR = {
  cream:  0xF5F2EB,
  creamHi:0xF9F6EF,
  floor:  0xEDE8DD,
  ink:    0x101010,
  red:    0xDD382C,
  yellow: 0xFFE14D,
  paper:  '#FCFAF4',
  muted:  '#6E6A61',
};

const ROOM = { w: 24, d: 36, h: 5 };      // 갤러리 홀 크기(m)
const EYE = 1.6;                           // 눈높이
const CARD = { w: 1.7, h: 2.125, y: 1.85 }; // 액자 카드 크기·중심높이
const BOUND = { x: 10.8, z: 16.8 };        // 이동 가능 범위
const SCULPT_R = 2.0;                      // 조형물 충돌 반경

const FONT_KR = '"Pretendard Variable", "Pretendard", sans-serif';
const FONT_EN = '"Poppins Variable", "Poppins", sans-serif';

/* ── 전역 상태 ─────────────────────────────────────────────── */

let renderer, scene, camera, rig, clock;
let maxAniso = 4;
let newsItems = [];
let fetchedAt = null;
const pickMeshes = [];                     // 레이캐스트 대상(액자 카드)
const look = { yaw: 0, pitch: 0 };
const keys = new Set();
const stickInput = { x: 0, y: 0 };         // 모바일 조이스틱 (-1..1)
const twoFingerMove = { fwd: 0, strafe: 0 };
const velocity = new THREE.Vector3();

const state = {
  focused: null,        // 현재 포커스된 액자 데이터
  returnPose: null,     // 포커스 전 카메라 포즈
  tween: null,          // 진행 중인 카메라 트윈
  inVR: false,
  ready: false,
};

// 회전 애니메이션 대상
const spinners = [];

/* ── 부트스트랩 ────────────────────────────────────────────── */

init().catch(err => {
  console.error('[newsroom-3d]', err);
  showFallback(
    '전시장을 여는 데 문제가 생겼어요',
    '로컬 서버로 열었는지 확인해 주세요 — 프로젝트 루트에서 python3 -m http.server 후 /newsroom-3d/ 접속'
  );
});

async function init() {
  if (!webglSupported()) {
    showFallback(
      '이 브라우저에선 전시장이 열리지 않아요',
      'WebGL을 지원하는 최신 브라우저(Chrome · Safari · Edge)로 다시 들어와 주세요'
    );
    return;
  }

  // ── 렌더러
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  document.getElementById('app').appendChild(renderer.domElement);
  maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy() || 4);

  // ── 씬 / 카메라 리그
  scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.cream);
  scene.fog = new THREE.Fog(COLOR.cream, 34, 82);

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 120);
  camera.position.set(0, EYE, 0);
  rig = new THREE.Group();
  rig.position.set(0, 0, 15.8); // 입구 — 페이드인과 함께 살짝 걸어 들어간다
  rig.add(camera);
  scene.add(rig);

  // ── 에셋 로드 (폰트 + 데이터)
  const [data] = await Promise.all([
    loadNews(),
    loadFonts(),
    delay(700), // 스피너 최소 노출
  ]);
  newsItems = data.items || [];
  fetchedAt = data.fetched_at ? new Date(data.fetched_at) : new Date();
  await preloadImages(newsItems);

  // ── 공간 구축
  buildLights();
  buildRoom();
  buildTitleWall();
  buildRedWallSign();
  buildFrames();
  buildSculpture();

  // ── UI
  setupHUD();
  setupControls();
  setupPanel();
  setupVR();

  window.addEventListener('resize', onResize);

  // ── 시작: 렌더 루프 + 2초 페이드인 + 입장 돌리
  clock = new THREE.Clock();
  renderer.setAnimationLoop(animate);
  startTween(new THREE.Vector3(0, 0, 14.2), camera.quaternion.clone(), null, 2.4);
  requestAnimationFrame(() => {
    const loader = document.getElementById('loader');
    loader.classList.add('done');
    loader.addEventListener('transitionend', () => loader.remove(), { once: true });
    state.ready = true;
  });
}

/* ── 에셋 로더 ─────────────────────────────────────────────── */

function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

async function loadNews() {
  const res = await fetch('./shared/data/news.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('news.json HTTP ' + res.status);
  return res.json();
}

async function preloadImages(items) {
  const promises = items.map(item => {
    if (!item.photo) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        item.imgElement = img;
        resolve(img);
      };
      img.onerror = () => {
        console.error('Failed to load image:', item.photo);
        resolve(null);
      };
      img.src = item.photo;
    });
  });
  await Promise.all(promises);
}


// 캔버스에 한글을 그리기 전에 Pretendard/Poppins 로드를 반드시 기다린다
function loadFonts() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wants = [
    `500 32px ${FONT_KR}`, `700 32px ${FONT_KR}`, `800 32px ${FONT_KR}`,
    `500 32px ${FONT_EN}`, `600 32px ${FONT_EN}`, `700 32px ${FONT_EN}`,
  ];
  return Promise.race([
    Promise.all(wants.map(f => document.fonts.load(f, '데일리패션뉴스 ABC'))),
    delay(3500), // 폰트가 늦어도 전시는 연다
  ]);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── 조명 ──────────────────────────────────────────────────── */

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xFFFEF8, 0xB9B3A5, 1.05));
  scene.add(new THREE.AmbientLight(0xFFFFFF, 0.45));

  const sun = new THREE.DirectionalLight(0xFFF8EC, 0.6);
  sun.position.set(6, 9, 5);
  scene.add(sun);

  // 조형물 전용 스포트라이트 — 그림자는 여기 하나만
  const spot = new THREE.SpotLight(0xFFF4E4, 55, 16, 0.62, 0.55, 1.7);
  spot.position.set(2.2, 4.9, 2.0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 1.4, 0);
  scene.add(spotTarget);
  spot.target = spotTarget;
  scene.add(spot);
}

/* ── 갤러리 홀 ─────────────────────────────────────────────── */

function buildRoom() {
  const { w, d, h } = ROOM;
  const creamMat = new THREE.MeshLambertMaterial({ color: COLOR.cream });
  const redMat   = new THREE.MeshLambertMaterial({ color: COLOR.red });
  const inkMat   = new THREE.MeshLambertMaterial({ color: COLOR.ink });

  // 바닥 — 캔버스 텍스처(잉크 라인 + 조형물 레드 링)
  const floorTex = makeTexture(drawFloorCanvas());
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ map: floorTex })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 천장
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: COLOR.creamHi }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = h;
  scene.add(ceil);

  // 천장 라이트 스트립 3줄 (자체발광 룩)
  const stripGeo = new THREE.BoxGeometry(0.34, 0.04, d - 4);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF });
  [-6, 0, 6].forEach(x => {
    const s = new THREE.Mesh(stripGeo, stripMat);
    s.position.set(x, h - 0.03, 0);
    scene.add(s);
  });

  // 벽 4면 — 남쪽(입구 뒤)이 레드 포인트 월
  const walls = [
    { size: [w, h], pos: [0, h / 2, -d / 2], ry: 0,            mat: creamMat }, // 북 — 타이틀 월
    { size: [w, h], pos: [0, h / 2,  d / 2], ry: Math.PI,      mat: redMat   }, // 남 — 레드 월
    { size: [d, h], pos: [-w / 2, h / 2, 0], ry: Math.PI / 2,  mat: creamMat }, // 서
    { size: [d, h], pos: [ w / 2, h / 2, 0], ry: -Math.PI / 2, mat: creamMat }, // 동
  ];
  for (const cfg of walls) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(...cfg.size), cfg.mat);
    wall.position.set(...cfg.pos);
    wall.rotation.y = cfg.ry;
    scene.add(wall);
  }

  // 잉크 몰딩 — 굽도리(바닥) + 픽처 레일(y=3.6)
  const moldings = [
    { geo: [0.07, 0.16, d], x: -w / 2 + 0.035, y: 0.08, z: 0 },
    { geo: [0.07, 0.16, d], x:  w / 2 - 0.035, y: 0.08, z: 0 },
    { geo: [w, 0.16, 0.07], x: 0, y: 0.08, z: -d / 2 + 0.035 },
    { geo: [w, 0.16, 0.07], x: 0, y: 0.08, z:  d / 2 - 0.035 },
    { geo: [0.04, 0.05, d], x: -w / 2 + 0.02, y: 3.6, z: 0 },
    { geo: [0.04, 0.05, d], x:  w / 2 - 0.02, y: 3.6, z: 0 },
  ];
  for (const m of moldings) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...m.geo), inkMat);
    mesh.position.set(m.x, m.y, m.z);
    scene.add(mesh);
  }
}

/* ── 타이틀 월 (북쪽 정면) ─────────────────────────────────── */

function buildTitleWall() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 400;
  const x = c.getContext('2d');
  x.textAlign = 'center';

  // 텍스트 워드마크
  x.fillStyle = '#101010';
  try { x.letterSpacing = '14px'; } catch {}
  x.font = `800 80px ${FONT_EN}`;
  x.fillText('FLAMINGALLERY', 512, 190);

  // 레드 룰
  x.fillStyle = '#DD382C';
  x.fillRect((1024 - 220) / 2, 226, 220, 9);

  // 날짜 라인 (Poppins 캡스)
  x.fillStyle = '#101010';
  try { x.letterSpacing = '10px'; } catch {}
  x.font = `600 33px ${FONT_EN}`;
  x.fillText(formatDateEN(fetchedAt), 512, 296);

  // 국문 태그라인
  try { x.letterSpacing = '1px'; } catch {}
  x.fillStyle = '#6E6A61';
  x.font = `500 25px ${FONT_KR}`;
  x.fillText('오늘 발행된 이슈가 그대로 오늘의 전시', 512, 348);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(11.5, 11.5 * (400 / 1024)),
    new THREE.MeshBasicMaterial({ map: makeTexture(c), transparent: true })
  );
  plane.position.set(0, 2.62, -ROOM.d / 2 + 0.06);
  scene.add(plane);
}

/* ── 레드 월 사인 (남쪽) ───────────────────────────────────── */

function buildRedWallSign() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 400;
  const x = c.getContext('2d');
  x.textAlign = 'center';

  x.fillStyle = '#F5F2EB';
  try { x.letterSpacing = '14px'; } catch {}
  x.font = `700 96px ${FONT_EN}`;
  x.fillText('FRESH DAILY', 512, 168);

  x.fillStyle = '#FFE14D';
  x.fillRect((1024 - 190) / 2, 208, 190, 9);

  try { x.letterSpacing = '1px'; } catch {}
  x.fillStyle = '#F5F2EB';
  x.font = `500 34px ${FONT_KR}`;
  x.fillText('내일이면 다 바뀌는 벽', 512, 288);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9 * (400 / 1024)),
    new THREE.MeshBasicMaterial({ map: makeTexture(c), transparent: true })
  );
  plane.position.set(0, 2.7, ROOM.d / 2 - 0.06);
  plane.rotation.y = Math.PI;
  scene.add(plane);
}

/* ── 뉴스 액자 24점 ────────────────────────────────────────── */

// 관람 동선: 타이틀 월(북) 4점 → 서쪽 벽 8점 → 레드 월(남) 4점 → 동쪽 벽 8점
function framePlacements() {
  const P = [];
  const wallX = ROOM.w / 2, wallZ = ROOM.d / 2;
  [-10, -7.2, 7.2, 10].forEach(x => P.push({ x, z: -wallZ, ry: 0 }));
  [-14, -10, -6, -2, 2, 6, 10, 14].forEach(z => P.push({ x: -wallX, z, ry: Math.PI / 2 }));
  [-10, -7.2, 7.2, 10].forEach(x => P.push({ x, z: wallZ, ry: Math.PI }));
  [14, 10, 6, 2, -2, -6, -10, -14].forEach(z => P.push({ x: wallX, z, ry: -Math.PI / 2 }));
  return P;
}

function buildFrames() {
  const places = framePlacements();
  const frameMat = new THREE.MeshLambertMaterial({ color: COLOR.ink });
  const frameGeo = new THREE.BoxGeometry(CARD.w + 0.18, CARD.h + 0.18, 0.07);
  const cardGeo = new THREE.PlaneGeometry(CARD.w, CARD.h);
  const count = Math.min(newsItems.length, places.length);

  for (let i = 0; i < count; i++) {
    const item = newsItems[i];
    const p = places[i];

    const group = new THREE.Group();
    group.position.set(p.x, CARD.y, p.z);
    group.rotation.y = p.ry;

    const border = new THREE.Mesh(frameGeo, frameMat);
    border.position.z = 0.045;
    group.add(border);

    const tex = makeTexture(drawCardCanvas(item, i));
    const card = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({ map: tex }));
    card.position.z = 0.085;
    group.add(card);

    scene.add(group);

    const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
    const center = new THREE.Vector3();
    card.getWorldPosition(center);
    card.userData = { item, index: i, normal, center };
    pickMeshes.push(card);
  }
}

/* ── 액자 카드 텍스처 (640×800 캔버스 타이포 카드) ─────────── */

function drawCardCanvas(item, idx) {
  const W = 640, H = 800, M = 52;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  // 종이 바탕 + 가장자리 헤어라인
  x.fillStyle = COLOR.paper;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(16,16,16,.08)';
  x.lineWidth = 2;
  x.strokeRect(13, 13, W - 26, H - 26);

  // 헤더 — 번호(레드) / 날짜(우측)
  try { x.letterSpacing = '4px'; } catch {}
  x.font = `600 26px ${FONT_EN}`;
  x.fillStyle = '#DD382C';
  x.textAlign = 'left';
  x.fillText(`NO.${String(idx + 1).padStart(2, '0')}`, M, 86);
  x.fillStyle = COLOR.muted;
  x.textAlign = 'right';
  x.fillText(String(item.date || '').slice(5).replace('-', '.'), W - M, 86);
  x.textAlign = 'left';
  try { x.letterSpacing = '0px'; } catch {}

  if (item.imgElement) {
    // 1. 이미지 카드 레이아웃
    // 이미지 그리기 (비율에 맞춰 536x400 영역에 드로잉)
    x.drawImage(item.imgElement, M, 112, W - 2 * M, 380);
    x.strokeStyle = 'rgba(16,16,16,.15)';
    x.lineWidth = 1.5;
    x.strokeRect(M, 112, W - 2 * M, 380);

    // 타이틀 (이미지 하단)
    x.fillStyle = '#101010';
    let size = 36;
    x.font = `800 ${size}px ${FONT_KR}`;
    x.fillText(item.title || '(제목 없음)', M, 536);

    // 디바이더
    x.fillStyle = 'rgba(16,16,16,.85)';
    x.fillRect(M, 558, 48, 3.5);

    // 발췌/설명
    const body = cleanExcerpt(item.excerpt).replace(/\s+/g, ' ').trim() || '';
    x.font = `500 22px ${FONT_KR}`;
    x.fillStyle = 'rgba(48,45,38,.85)';
    let elines = wrapText(x, body, W - 2 * M);
    if (elines.length > 4) {
      elines = elines.slice(0, 4);
      elines[3] = elines[3].replace(/..$/, ' …');
    }
    elines.forEach((ln, i) => x.fillText(ln, M, 600 + i * 32));

  } else {
    // 2. 기존 타이포 카드 레이아웃
    // 채널 배지 — 데이터의 channel 값을 그대로 표시(잉크/옐로 2색), 값이 없으면 ARCHIVE
    const ch = item.channel || 'ARCHIVE';
    x.font = `700 24px ${FONT_KR}`;
    const bw = x.measureText(ch).width + 40;
    const isMain = ch === '데패뉴';
    x.fillStyle = isMain ? '#101010' : '#FFE14D';
    rr(x, M, 112, bw, 44, 22);
    x.fill();
    x.fillStyle = isMain ? '#F5F2EB' : '#101010';
    x.fillText(ch, M + 20, 143);

    // 타이틀 — 길면 폰트를 줄여 최대 4줄
    x.fillStyle = '#101010';
    let size = 54, lines;
    for (;;) {
      x.font = `800 ${size}px ${FONT_KR}`;
      lines = wrapText(x, item.title || '(제목 없음)', W - 2 * M);
      if (lines.length <= 4 || size <= 40) break;
      size -= 7;
    }
    if (lines.length > 4) {
      lines = lines.slice(0, 4);
      lines[3] = lines[3].replace(/.$/, '…');
    }
    const lh = size * 1.24;
    lines.forEach((ln, i) => x.fillText(ln, M, 240 + i * lh));

    // 디바이더
    x.fillStyle = 'rgba(16,16,16,.85)';
    x.fillRect(M, 506, 56, 4);

    // 발췌 3~4줄
    const body = cleanExcerpt(item.excerpt).replace(/\s+/g, ' ').trim() ||
      '본문 준비 중 — 지금 데스크에서 다듬는 중';
    x.font = `500 26px ${FONT_KR}`;
    x.fillStyle = 'rgba(48,45,38,.82)';
    let elines = wrapText(x, body, W - 2 * M);
    if (elines.length > 4) {
      elines = elines.slice(0, 4);
      elines[3] = elines[3].replace(/..$/, ' …');
    }
    elines.forEach((ln, i) => x.fillText(ln, M, 552 + i * 41));
  }

  // 하단 — 워드마크 / 검증 스탬프
  x.fillStyle = '#DD382C';
  x.fillRect(M, 734, 9, 9);
  try { x.letterSpacing = '3px'; } catch {}
  x.font = `500 17px ${FONT_EN}`;
  x.fillStyle = COLOR.muted;
  x.fillText('FLAMINGALLERY', M + 20, 743);
  try { x.letterSpacing = '0px'; } catch {}

  if (item.verified) {
    drawStamp(x, W - M - 118, 726);
  } else {
    x.font = `700 21px ${FONT_KR}`;
    const t = '확인 중';
    const tw = x.measureText(t).width;
    x.fillStyle = '#FFE14D';
    x.fillRect(W - M - tw - 24, 706, tw + 24, 38);
    x.fillStyle = '#101010';
    x.fillText(t, W - M - tw - 12, 733);
  }

  return c;
}

// 레드 FACT-CHECKED 스탬프 (살짝 기울여 도장 느낌)
function drawStamp(x, cx, cy) {
  x.save();
  x.translate(cx, cy);
  x.rotate(-0.09);
  x.strokeStyle = 'rgba(221,56,44,.9)';
  x.lineWidth = 3.5;
  rr(x, -122, -28, 244, 56, 8);
  x.stroke();
  x.fillStyle = 'rgba(221,56,44,.94)';
  try { x.letterSpacing = '3px'; } catch {}
  x.font = `700 23px ${FONT_EN}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('FACT-CHECKED ✓', 0, 2);
  x.restore();
}

/* ── 중앙 조형물 — 회전하는 레드 리본 ──────────────────────── */

function buildSculpture() {
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.82, 0.9, 1.08, 48),
    new THREE.MeshLambertMaterial({ color: COLOR.ink })
  );
  base.position.set(0, 0.54, 0);
  scene.add(base);

  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.52, 0.16, 140, 20),
    new THREE.MeshStandardMaterial({ color: COLOR.red, roughness: 0.32, metalness: 0.22 })
  );
  knot.position.set(0, 2.1, 0);
  knot.castShadow = true;
  scene.add(knot);
  spinners.push({ obj: knot, fn: (o, t, dt) => {
    o.rotation.y += dt * 0.45;
    o.rotation.x = Math.sin(t * 0.28) * 0.22;
    o.position.y = 2.1 + Math.sin(t * 0.7) * 0.05;
  }});

  const ringGroup = new THREE.Group();
  ringGroup.position.set(0, 2.1, 0);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.06, 0.028, 12, 90),
    new THREE.MeshStandardMaterial({ color: COLOR.yellow, roughness: 0.4, metalness: 0.1 })
  );
  ring.rotation.x = 1.15;
  ring.castShadow = true;
  ringGroup.add(ring);
  scene.add(ringGroup);
  spinners.push({ obj: ringGroup, fn: (o, t, dt) => { o.rotation.y -= dt * 0.7; } });
}

/* ── HUD / 패널 / VR ───────────────────────────────────────── */

function setupHUD() {
  const verified = newsItems.filter(i => i.verified).length;
  document.getElementById('hudMeta').textContent =
    `${formatDateShort(fetchedAt)} · ${newsItems.length} ON VIEW · ${verified} FACT-CHECKED`;

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  document.getElementById('hint').innerHTML = coarse
    ? '한 손가락으로 둘러보고 <b>스틱</b>으로 걷기 · 궁금한 액자는 <b>콕</b>'
    : '드래그로 둘러보기 · <b>WASD</b>로 걷기 · 궁금한 액자는 <b>클릭</b>';
  setTimeout(() => document.getElementById('hint').classList.add('dim'), 9000);
}

function setupPanel() {
  document.getElementById('panelClose').addEventListener('click', exitFocus);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.focused) exitFocus();
  });
}

function setupVR() {
  const btn = VRButton.createButton(renderer);
  btn.classList.add('dfn-vr');
  document.body.appendChild(btn);
  // 미지원 브라우저 문구를 한국어 톤으로 + 외부 링크로 전시장 이탈 방지
  // (WebXR 미지원 시 VRButton은 immersiveweb.dev 등으로 가는 <a>를 반환한다)
  if (btn.tagName === 'A') {
    btn.removeAttribute('href');
    btn.addEventListener('click', e => e.preventDefault());
  }
  const VR_LABELS = {
    'VR NOT SUPPORTED': 'VR 미지원 — 그냥 둘러보세요',
    'WEBXR NOT AVAILABLE': 'WEBXR 미지원 — 그냥 둘러보세요',
    'WEBXR NEEDS HTTPS': 'HTTPS 필요 — 그냥 둘러보세요',
    'VR NOT ALLOWED': 'VR 권한 없음 — 그냥 둘러보세요',
  };
  const patch = () => {
    if (btn.tagName === 'A' && btn.hasAttribute('href')) btn.removeAttribute('href');
    const label = VR_LABELS[btn.textContent.trim()];
    if (label) btn.textContent = label;
  };
  patch();
  new MutationObserver(patch).observe(btn, { childList: true, characterData: true, subtree: true });

  renderer.xr.addEventListener('sessionstart', () => {
    state.inVR = true;
    document.body.classList.add('vr');
    if (state.focused) exitFocus(true);
    // VR 기준점: 현재 서 있던 자리
    velocity.set(0, 0, 0);
  });
  renderer.xr.addEventListener('sessionend', () => {
    state.inVR = false;
    document.body.classList.remove('vr');
  });
}

/* ── 조작: 시점 회전 + 이동 + 레이캐스트 픽 ────────────────── */

function setupControls() {
  const canvas = renderer.domElement;
  const pointers = new Map();
  let lastCentroid = null;
  let hoverThrottle = 0;

  canvas.addEventListener('pointerdown', e => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 합성 이벤트 등 캡처 불가 시에도 픽킹은 계속 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    lastCentroid = null;
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) { hoverPick(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 1) {
      if (!state.tween && !state.inVR) {
        look.yaw -= dx * 0.0042;
        look.pitch = clamp(look.pitch - dy * 0.0042, -1.15, 1.15);
      }
    } else if (pointers.size >= 2) {
      // 투핑거 드래그 = 걷기 (위로 밀면 전진)
      const pts = [...pointers.values()];
      const cx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
      const cy = pts.reduce((s, q) => s + q.y, 0) / pts.length;
      if (lastCentroid) {
        twoFingerMove.fwd = clamp((lastCentroid.y - cy) * 0.09, -1.4, 1.4);
        twoFingerMove.strafe = clamp((cx - lastCentroid.x) * 0.06, -1, 1);
      }
      lastCentroid = { x: cx, y: cy };
    }
  });

  const endPointer = e => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) { twoFingerMove.fwd = 0; twoFingerMove.strafe = 0; lastCentroid = null; }
    if (pointers.size === 0) canvas.classList.remove('dragging');
    if (!p) return;
    const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
    const dt = performance.now() - p.t;
    if (moved < 7 && dt < 500 && !state.inVR && !state.tween) tryPick(e);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // 휠 = 전후진
  canvas.addEventListener('wheel', e => {
    if (state.focused || state.tween || state.inVR) return;
    e.preventDefault();
    moveRig(clamp(-e.deltaY * 0.0035, -0.6, 0.6), 0);
  }, { passive: false });

  // 키보드
  const MOVE_KEYS = ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  window.addEventListener('keydown', e => {
    if (MOVE_KEYS.includes(e.code) || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      keys.add(e.code);
      if (MOVE_KEYS.includes(e.code) && state.focused && !state.tween) exitFocus(); // 걷기 시작하면 자연스럽게 복귀
      if (e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  // 모바일 조이스틱
  setupStick();

  // 데스크톱 호버 커서
  function hoverPick(e) {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const now = performance.now();
    if (now - hoverThrottle < 120 || state.inVR) return;
    hoverThrottle = now;
    const hit = raycastFrames(e);
    canvas.classList.toggle('pickable', !!hit);
  }
}

function setupStick() {
  const stick = document.getElementById('stick');
  const thumb = document.getElementById('stickThumb');
  let sid = null, cx = 0, cy = 0;
  const R = 40;

  stick.addEventListener('pointerdown', e => {
    sid = e.pointerId;
    stick.setPointerCapture(sid);
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    onStick(e);
  });
  stick.addEventListener('pointermove', e => { if (e.pointerId === sid) onStick(e); });
  const release = e => {
    if (e.pointerId !== sid) return;
    sid = null;
    stickInput.x = 0; stickInput.y = 0;
    thumb.style.transform = 'translate(-50%,-50%)';
  };
  stick.addEventListener('pointerup', release);
  stick.addEventListener('pointercancel', release);

  function onStick(e) {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    stickInput.x = dx / R;          // 좌우 = 스트레이프
    stickInput.y = -dy / R;         // 위 = 전진
    if (state.focused && !state.tween && Math.hypot(stickInput.x, stickInput.y) > 0.4) exitFocus();
  }
}

const raycaster = new THREE.Raycaster();
function raycastFrames(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(pickMeshes, false);
  return hits.length ? hits[0] : null;
}

function tryPick(e) {
  const hit = raycastFrames(e);
  if (hit) focusFrame(hit.object.userData);
}

/* ── 포커스: 액자로 다가가기 / 복귀 ────────────────────────── */

function focusFrame(f) {
  if (state.focused && state.focused.index === f.index) return;
  if (!state.focused) {
    state.returnPose = { pos: rig.position.clone(), quat: camera.quaternion.clone() };
  }
  state.focused = f;

  const target = f.center.clone();
  const eye = f.center.clone().addScaledVector(f.normal, 2.5);
  eye.y = EYE;
  const toQuat = lookQuat(eye, target);
  startTween(new THREE.Vector3(eye.x, 0, eye.z), toQuat, () => {
    syncLookFromCamera();
    openPanel(f);
  });
}

function exitFocus(instant = false) {
  closePanel();
  const rp = state.returnPose;
  state.focused = null;
  state.returnPose = null;
  if (!rp) return;
  if (instant) {
    rig.position.copy(rp.pos);
    camera.quaternion.copy(rp.quat);
    syncLookFromCamera();
    return;
  }
  startTween(rp.pos, rp.quat, () => syncLookFromCamera());
}

function lookQuat(eye, target) {
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(eye.x, EYE, eye.z), target, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function syncLookFromCamera() {
  const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  look.yaw = e.y;
  look.pitch = e.x;
}

function startTween(toPos, toQuat, onDone, dur = 1.0) {
  state.tween = {
    t: 0, dur,
    fromPos: rig.position.clone(), toPos: toPos.clone(),
    fromQuat: camera.quaternion.clone(), toQuat: toQuat.clone(),
    onDone,
  };
}

/* ── 상세 패널 ─────────────────────────────────────────────── */

function openPanel(f) {
  const { item, index } = f;
  document.getElementById('panelKicker').textContent =
    `TODAY'S ISSUE — NO.${String(index + 1).padStart(2, '0')}`;
  document.getElementById('panelTitle').textContent = item.title || '(제목 없음)';

  const meta = document.getElementById('panelMeta');
  meta.innerHTML = '';
  const chip = (txt, cls) => {
    const s = document.createElement('span');
    s.className = 'chip' + (cls ? ' ' + cls : '');
    s.textContent = txt;
    meta.appendChild(s);
  };
  chip(item.date || '');
  chip(item.channel || 'ARCHIVE', item.channel === '데뷰웰' ? 'yellow' : 'ink');
  if (item.verified) chip('FACT-CHECKED ✓', 'red');
  else chip('확인 중', 'yellow');

  const body = cleanExcerpt(item.excerpt);
  document.getElementById('panelBody').textContent =
    body || '본문 준비 중 — 지금 데스크에서 다듬는 중';

  const link = document.getElementById('panelLink');
  const src = String(item.source || '').trim();
  if (/^https?:\/\//.test(src)) {
    link.href = src;
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  document.getElementById('panel').classList.add('open');
  document.getElementById('panel').setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
  document.getElementById('panel').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
}

/* ── 렌더 루프 ─────────────────────────────────────────────── */

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 조형물 회전
  for (const s of spinners) s.fn(s.obj, t, dt);

  // 카메라 트윈
  if (state.tween) {
    const tw = state.tween;
    tw.t += dt / tw.dur;
    const e = easeInOutCubic(Math.min(tw.t, 1));
    rig.position.lerpVectors(tw.fromPos, tw.toPos, e);
    camera.quaternion.slerpQuaternions(tw.fromQuat, tw.toQuat, e);
    if (tw.t >= 1) {
      state.tween = null;
      if (tw.onDone) tw.onDone();
    }
  } else if (!state.inVR) {
    // 시점 적용
    camera.quaternion.setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ'));

    // 이동 입력 합산 (키보드 + 스틱 + 투핑거)
    let fwd = 0, strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    fwd += stickInput.y + twoFingerMove.fwd;
    strafe += stickInput.x + twoFingerMove.strafe;
    // 손가락을 댄 채 멈추면 pointermove가 끊겨도 드리프트하지 않도록 프레임마다 감쇠
    // (움직이는 동안엔 매 move 이벤트가 값을 갱신하므로 체감 영향 없음)
    const tfDecay = Math.pow(0.001, dt);
    twoFingerMove.fwd *= tfDecay;
    twoFingerMove.strafe *= tfDecay;
    const boost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 1.8 : 1;

    if (!state.focused) {
      const speed = 3.1 * boost;
      const target = new THREE.Vector3(
        (Math.cos(look.yaw) * strafe - Math.sin(look.yaw) * fwd) * speed,
        0,
        (-Math.sin(look.yaw) * strafe - Math.cos(look.yaw) * fwd) * speed
      );
      velocity.lerp(target, 1 - Math.pow(0.0001, dt));
      if (velocity.lengthSq() > 0.0001) {
        rig.position.addScaledVector(velocity, dt);
        clampToRoom(rig.position);
      }
    }
  }

  renderer.render(scene, camera);
}

function moveRig(fwd, strafe) {
  rig.position.x += Math.cos(look.yaw) * strafe - Math.sin(look.yaw) * fwd;
  rig.position.z += -Math.sin(look.yaw) * strafe - Math.cos(look.yaw) * fwd;
  clampToRoom(rig.position);
}

function clampToRoom(pos) {
  pos.x = clamp(pos.x, -BOUND.x, BOUND.x);
  pos.z = clamp(pos.z, -BOUND.z, BOUND.z);
  // 중앙 조형물 밀어내기
  const d = Math.hypot(pos.x, pos.z);
  if (d < SCULPT_R && d > 0.0001) {
    pos.x = pos.x / d * SCULPT_R;
    pos.z = pos.z / d * SCULPT_R;
  }
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ── 유틸 ──────────────────────────────────────────────────── */

// 바닥 텍스처 — 갤러리 슬래브 라인 + 중앙 조형물 자리 레드 링
function drawFloorCanvas() {
  const cw = 512, ch = 768; // ROOM.w : ROOM.d = 24 : 36
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#EDE8DD';
  ctx.fillRect(0, 0, cw, ch);

  // 슬래브 그리드 (3m 간격 → 24m/8칸, 36m/12칸)
  ctx.strokeStyle = 'rgba(16, 16, 16, 0.10)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    const x = (cw / 8) * i;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
  }
  for (let j = 1; j < 12; j++) {
    const y = (ch / 12) * j;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
  }

  // 외곽 보더 라인
  ctx.strokeStyle = 'rgba(16, 16, 16, 0.28)';
  ctx.lineWidth = 6;
  ctx.strokeRect(14, 14, cw - 28, ch - 28);

  // 중앙 조형물 자리 — 레드 링 2겹
  ctx.strokeStyle = '#DD382C';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.arc(cw / 2, ch / 2, 64, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cw / 2, ch / 2, 78, 0, Math.PI * 2); ctx.stroke();

  return c;
}

function makeTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

// 발췌에서 검증 헤더/원본 URL 프리픽스를 걷어내고 본문만
function cleanExcerpt(raw) {
  if (!raw) return '';
  const marker = '📝 피드 본문';
  const i = raw.indexOf(marker);
  let t;
  if (i >= 0) {
    t = raw.slice(i + marker.length);
  } else {
    // 마커가 없어도 내부 파이프라인 헤더(✅/⚠️ … 채널: … 📷 원본 [URL])는
    // 관람객에게 노출하지 않는다. 스트립 후 비면 호출부 폴백이 처리.
    t = raw.replace(/^\s*(?:✅|⚠️)[^\n]*?📷 원본\s*(?:https?:\/\/\S+\s*)?/, '');
  }
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 한글은 글자 단위, 영문은 단어 단위로 줄바꿈
function wrapText(ctx, text, maxW) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const lines = [];
  let line = '';
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line.length) {
      let br = -1;
      for (let j = line.length - 1; j > 0; j--) {
        const c = line[j];
        if (c === ' ') { br = j; break; }
        if (/[ᄀ-퟿　-鿿]/.test(c)) { br = j + 1; break; }
      }
      if (br > 0 && br < line.length) {
        lines.push(line.slice(0, br).trim());
        line = (line.slice(br) + ch).replace(/^ +/, '');
      } else {
        lines.push(line.trim());
        line = ch === ' ' ? '' : ch;
      }
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// 라운드 사각형 패스 (roundRect 폴리필 겸용)
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

function formatDateEN(d) {
  if (!(d instanceof Date) || isNaN(d)) d = new Date();
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()} — SEOUL`;
}
function formatDateShort(d) {
  if (!(d instanceof Date) || isNaN(d)) d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

function showFallback(title, desc) {
  const loader = document.getElementById('loader');
  if (loader) loader.remove();
  const fb = document.getElementById('fallback');
  document.getElementById('fallbackTitle').textContent = title;
  document.getElementById('fallbackDesc').textContent = desc;
  fb.hidden = false;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
