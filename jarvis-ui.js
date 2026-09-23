/* ============================================================
   J.A.R.V.I.S. — voice-first UI
   • Hidden webcam = invisible gesture controller (MediaPipe Hands)
   • Fire / lightning / explosions bloom on a dark background
   • Voice commands (Web Speech API) + spoken replies (TTS)
   • Reactor orb reacts to your voice level
   ============================================================ */

const video   = document.getElementById('video');
const canvas  = document.getElementById('fx');
const ctx     = canvas.getContext('2d');
const flash   = document.getElementById('flash');
const wake    = document.getElementById('wake');
const loader  = document.getElementById('loader');
const orb     = document.getElementById('orb');
const youEl   = document.getElementById('you');
const jarvisEl= document.getElementById('jarvis');
const statusEl= document.getElementById('status');
const stateHintEl = document.getElementById('stateHint');
const modeEl  = document.getElementById('mode');
const clockEl = document.getElementById('clock');
const dateEl  = document.getElementById('date');
const root    = document.documentElement;

let awake = false; // sleeping (closed eyes) until the user says "wake up"

let W = 0, H = 0;
function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const rand = (a, b) => a + Math.random() * (b - a);

/* ============================================================
   Coordinate mapping (hidden video -> canvas, mirrored, cover)
   ============================================================ */
function mapPoint(nx, ny) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale, dh = vh * scale;
  const offx = (W - dw) / 2, offy = (H - dh) / 2;
  let x = nx * dw + offx;
  const y = ny * dh + offy;
  return { x: W - x, y };
}

/* ============================================================
   Background: starfield + faint grid (drawn each frame)
   ============================================================ */
const stars = Array.from({ length: 90 }, () => ({
  x: Math.random(), y: Math.random(),
  z: rand(0.2, 1), tw: rand(0, Math.PI * 2),
}));

function drawBackground(t) {
  // faint drifting grid
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(30,90,120,0.05)';
  ctx.lineWidth = 1;
  const gap = 64;
  const off = (t * 0.01) % gap;
  ctx.beginPath();
  for (let x = -off; x < W; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = -off; y < H; y += gap) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();

  // stars
  for (const s of stars) {
    const px = s.x * W, py = s.y * H;
    const a = 0.25 + 0.35 * Math.sin(t * 0.002 + s.tw);
    ctx.fillStyle = `rgba(150,220,255,${a * s.z})`;
    ctx.beginPath();
    ctx.arc(px, py, s.z * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ============================================================
   Particle systems (fire / embers / sparks / explosion / shock)
   ============================================================ */
const fireParticles = [];
const emberParticles = [];
const sparkParticles = [];
const explosions = [];
const shockwaves = [];

function spawnFire(x, y, intensity) {
  const spread = 8 + intensity * 60;
  const count = Math.max(1, Math.round(intensity * 8));
  for (let i = 0; i < count; i++) {
    fireParticles.push({
      x: x + rand(-spread, spread) * 0.35,
      y: y + rand(-6, 10),
      vx: rand(-spread, spread) * 0.06,
      vy: -rand(1.6, 4.2) * (0.7 + intensity * 0.8),
      life: 1, decay: rand(0.012, 0.03),
      size: rand(14, 30) * (0.7 + intensity * 0.6),
      hue: rand(12, 45),
    });
  }
  if (Math.random() < 0.6) {
    emberParticles.push({
      x: x + rand(-spread, spread) * 0.4, y: y + rand(-4, 6),
      vx: rand(-0.6, 0.6), vy: -rand(2.5, 5),
      life: 1, decay: rand(0.008, 0.02), size: rand(1.5, 3.5),
    });
  }
}

function drawFire() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.x += p.vx; p.y += p.vy; p.vy *= 0.98; p.vx *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) { fireParticles.splice(i, 1); continue; }
    const r = p.size * (0.6 + p.life * 0.8), a = Math.max(0, p.life);
    const light = 45 + p.life * 45;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, `hsla(${p.hue + 20}, 100%, ${light + 15}%, ${a})`);
    g.addColorStop(0.4, `hsla(${p.hue}, 100%, ${light}%, ${a * 0.8})`);
    g.addColorStop(1, `hsla(${p.hue - 10}, 100%, 30%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = emberParticles.length - 1; i >= 0; i--) {
    const e = emberParticles[i];
    e.x += e.vx; e.y += e.vy; e.vy *= 0.99; e.life -= e.decay;
    if (e.life <= 0) { emberParticles.splice(i, 1); continue; }
    ctx.fillStyle = `hsla(${rand(30, 55)}, 100%, 70%, ${e.life})`;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawBolt(x1, y1, x2, y2, thickness, color, jag) {
  const segs = 6 + Math.floor(Math.random() * 5);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    ctx.lineTo(x1 + (x2 - x1) * t + rand(-jag, jag), y1 + (y2 - y1) * t + rand(-jag, jag));
  }
  ctx.lineTo(x2, y2);
  ctx.lineWidth = thickness; ctx.strokeStyle = color;
  ctx.shadowBlur = 18; ctx.shadowColor = '#35e6ff';
  ctx.stroke(); ctx.shadowBlur = 0;
}

function drawLightning(x, y, intensity) {
  ctx.globalCompositeOperation = 'lighter';
  const coreR = 16 + intensity * 18;
  const cg = ctx.createRadialGradient(x, y, 0, x, y, coreR);
  cg.addColorStop(0, 'rgba(220,250,255,0.95)');
  cg.addColorStop(0.4, 'rgba(53,230,255,0.6)');
  cg.addColorStop(1, 'rgba(53,230,255,0)');
  ctx.fillStyle = cg;
  ctx.beginPath(); ctx.arc(x, y, coreR, 0, Math.PI * 2); ctx.fill();

  const bolts = Math.round(2 + intensity * 5), len = 60 + intensity * 150;
  for (let i = 0; i < bolts; i++) {
    const ang = rand(0, Math.PI * 2), l = len * rand(0.5, 1);
    const ex = x + Math.cos(ang) * l, ey = y + Math.sin(ang) * l;
    drawBolt(x, y, ex, ey, rand(1.5, 3), 'rgba(180,245,255,0.9)', 14 + intensity * 16);
    if (Math.random() < 0.4) drawBolt(x, y, ex, ey, 1, 'rgba(255,255,255,0.9)', 8);
    sparkParticles.push({ x: ex, y: ey, vx: Math.cos(ang) * rand(0.5, 2), vy: Math.sin(ang) * rand(0.5, 2), life: 1, decay: rand(0.05, 0.12), size: rand(1, 2.5) });
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSparks() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = sparkParticles.length - 1; i >= 0; i--) {
    const s = sparkParticles[i];
    s.x += s.vx; s.y += s.vy; s.life -= s.decay;
    if (s.life <= 0) { sparkParticles.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(200,250,255,${s.life})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function explode(x, y) {
  const maxDim = Math.min(W, H);
  explosions.push({ x, y, r: 14, maxR: maxDim * 0.55, life: 1, decay: 0.010, type: 'ball' });
  explosions.push({ x, y, r: 8, maxR: maxDim * 0.32, life: 1, decay: 0.018, type: 'core' });
  for (let i = 0; i < 140; i++) {
    const ang = rand(0, Math.PI * 2), sp = rand(4, 20);
    fireParticles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, life: 1, decay: rand(0.006, 0.014), size: rand(12, 30), hue: rand(8, 45) });
  }
  for (let i = 0; i < 60; i++) {
    const ang = rand(0, Math.PI * 2), sp = rand(8, 26);
    sparkParticles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, decay: rand(0.008, 0.02), size: rand(1.5, 3.5) });
  }
  shockwaves.push({ x, y, r: 10, maxR: Math.hypot(W, H), life: 1 });
  flashScreen(); boom();
  setMode('boom'); setStatus('💥 DETONATION');
  setTimeout(() => setMode('idle'), 1400);
}

function drawExplosions() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.r += (e.maxR - e.r) * 0.08; e.life -= e.decay;
    if (e.life <= 0) { explosions.splice(i, 1); continue; }
    const a = Math.max(0, e.life);
    const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
    if (e.type === 'core') {
      g.addColorStop(0, `rgba(255,255,245,${a})`);
      g.addColorStop(0.3, `rgba(255,215,130,${a * 0.85})`);
      g.addColorStop(1, 'rgba(255,120,30,0)');
    } else {
      g.addColorStop(0, `rgba(255,190,90,${a * 0.7})`);
      g.addColorStop(0.5, `rgba(255,110,30,${a * 0.4})`);
      g.addColorStop(1, 'rgba(120,20,0,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawShockwaves() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i];
    w.r += (w.maxR - w.r) * 0.06 + 6; w.life -= 0.02;
    if (w.life <= 0) { shockwaves.splice(i, 1); continue; }
    const a = Math.max(0, w.life);
    for (const [o, col] of [[-4, '#ff2d5e'], [0, '#ffffff'], [4, '#35e6ff']]) {
      ctx.beginPath(); ctx.arc(w.x, w.y, w.r + o, 0, Math.PI * 2);
      ctx.lineWidth = 6 * a; ctx.strokeStyle = col; ctx.globalAlpha = a * 0.6; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

function flashScreen() {
  flash.style.transition = 'none'; flash.style.opacity = '0.9';
  requestAnimationFrame(() => { flash.style.transition = 'opacity 0.8s ease'; flash.style.opacity = '0'; });
}

/* ============================================================
   Hand analysis (rotation-invariant openness)
   ============================================================ */
function palmCenter(lm) {
  const ids = [0, 5, 9, 13, 17]; let x = 0, y = 0;
  for (const id of ids) { x += lm[id].x; y += lm[id].y; }
  return { x: x / ids.length, y: y / ids.length };
}
function openness(lm) {
  const w = lm[0];
  const fingers = [[6, 8], [10, 12], [14, 16], [18, 20]];
  let sum = 0;
  for (const [pip, tip] of fingers) {
    const dTip = Math.hypot(lm[tip].x - w.x, lm[tip].y - w.y);
    const dPip = Math.hypot(lm[pip].x - w.x, lm[pip].y - w.y) + 1e-6;
    sum += Math.max(0, Math.min(1, (dTip / dPip - 1.0) / 0.45));
  }
  return sum / fingers.length;
}
function handSizePx(lm) {
  const a = mapPoint(lm[0].x, lm[0].y), b = mapPoint(lm[9].x, lm[9].y);
  return Math.hypot(a.x - b.x, a.y - b.y) || 1;
}

/* ---------- clap (occlusion-robust) ---------- */
let clapArmed = false, lastClap = 0, prevPalmDist = null, pendingClap = null;
function detectClap(hands) {
  const now = performance.now();
  if (hands.length < 2) {
    if (pendingClap && now < pendingClap.expire && now - lastClap > 400) {
      lastClap = now; explode(pendingClap.x, pendingClap.y);
    }
    clapArmed = false; prevPalmDist = null; pendingClap = null; return;
  }
  const a = hands[0], b = hands[1];
  const d = Math.hypot(a.px.x - b.px.x, a.px.y - b.px.y);
  const hs = Math.max(a.sizePx, b.sizePx, W * 0.03);
  const clapDist = hs * 3.0, openDist = hs * 4.5;
  const mx = (a.px.x + b.px.x) / 2, my = (a.px.y + b.px.y) / 2;
  const closing = prevPalmDist === null ? 0 : (prevPalmDist - d);
  const fast = closing > hs * 0.30;
  if (d > openDist) clapArmed = true;
  if (clapArmed && fast && d < openDist) pendingClap = { x: mx, y: my, expire: now + 260 };
  if (clapArmed && (d < clapDist || (fast && d < hs * 3.8)) && now - lastClap > 400) {
    clapArmed = false; pendingClap = null; lastClap = now; explode(mx, my);
  }
  prevPalmDist = d;
}

/* ============================================================
   Voice-driven background modes (channel energy around the orb)
   ============================================================ */
let fireModeUntil = 0, boltModeUntil = 0;
function orbCenter() { return { x: W / 2, y: H / 2 }; }

function igniteFire(seconds = 5) {
  fireModeUntil = performance.now() + seconds * 1000;
  setMode('fire'); setStatus('🔥 IGNITED');
}
function chargeLightning(seconds = 4) {
  boltModeUntil = performance.now() + seconds * 1000;
  setMode('lightning'); setStatus('⚡ CHARGING');
}
function standby() {
  fireModeUntil = 0; boltModeUntil = 0;
  setMode('idle'); setStatus('◌ STANDBY');
}

/* ============================================================
   Main render loop
   ============================================================ */
let latestHands = [];
let fireI = 0, boltI = 0;

function render(t) {
  // trailing fade -> smooth glow trails on the dark background
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(2,4,10,0.28)';
  ctx.fillRect(0, 0, W, H);

  drawBackground(t);

  const now = performance.now();
  const c = orbCenter();

  // ---- voice-driven energy around the reactor ----
  if (now < fireModeUntil) {
    // gentle ring of flame around the orb + a soft column beneath it
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + t * 0.0012;
      spawnFire(c.x + Math.cos(ang) * 135, c.y + Math.sin(ang) * 135 + 30, 0.5);
    }
    if (Math.random() < 0.7) spawnFire(c.x, c.y + 140, 0.6);
  }
  if (now < boltModeUntil) {
    for (let k = 0; k < 3; k++) {
      const ang = rand(0, Math.PI * 2);
      const ex = c.x + Math.cos(ang) * rand(120, 240);
      const ey = c.y + Math.sin(ang) * rand(120, 240);
      drawBolt(c.x, c.y, ex, ey, rand(1.5, 3), 'rgba(180,245,255,0.9)', 22);
      sparkParticles.push({ x: ex, y: ey, vx: Math.cos(ang), vy: Math.sin(ang), life: 1, decay: 0.06, size: rand(1, 2.5) });
    }
  }

  // ---- hidden-hand energy (invisible controller) ----
  let fireHand = null, boltHand = null;
  for (const h of latestHands) { if (h.element === 'fire') fireHand = h; else boltHand = h; }
  const gate = (o) => (o < 0.18 ? 0 : (o - 0.18) / 0.82);
  fireI += ((fireHand ? gate(fireHand.open) : 0) - fireI) * 0.10;
  boltI += ((boltHand ? gate(boltHand.open) : 0) - boltI) * 0.10;
  if (fireHand && fireI > 0.04) spawnFire(fireHand.px.x, fireHand.px.y, fireI);
  if (boltHand && boltI > 0.04) drawLightning(boltHand.px.x, boltHand.px.y, boltI);

  drawFire();
  drawSparks();
  drawExplosions();
  drawShockwaves();

  // reactor orb reactivity: pulse while Jarvis speaks, then decay to calm
  if (jarvisSpeaking) pulseOrb(0.22 + 0.18 * Math.abs(Math.sin(t * 0.02)));
  targetLevel *= 0.90;
  micLevel += (targetLevel - micLevel) * 0.2;
  root.style.setProperty('--level', micLevel.toFixed(3));

  // ---- lip sync (driven by ACTUAL speech, so it never stops mid-sentence) ----
  const speaking = isSpeakingNow();
  if (speaking) {
    mouthPulse *= 0.86;                                   // word pulse decays
    const base = 0.26 + 0.16 * Math.abs(Math.sin(t * 0.017)) + 0.06 * Math.sin(t * 0.043);
    mouthTarget = Math.min(1, base + mouthPulse * 0.6);
  } else {
    mouthTarget = 0; mouthPulse = 0;
  }
  mouthLevel += (mouthTarget - mouthLevel) * 0.35;        // smooth
  updateFace();                                           // pick the mouth-shape frame

  updateClock();
  requestAnimationFrame(render);
}

/* ---- frame-based face rendered on a CANVAS (zero swap flicker) ---- */
let _faceFrames = null, _shownFrame = 'idle';
let _faceCanvas = null, _fctx = null, _faceDPR = 1;
let _mouthCanvas = null, _mctx = null;
let _dissolve = null; // { from, to, start, dur } for the eye open/close only
// Mouth patch region in SOURCE-image fractions (lips + chin, generously
// feathered). Only this area is swapped between speaking frames; the rest of
// the face comes from the stable base frame so it never shimmers.
const MOUTH_BOX = { x0: 0.30, y0: 0.585, x1: 0.70, y1: 0.90 };
function faceFrames() { if (!_faceFrames) _faceFrames = Array.from(document.querySelectorAll('#face .frame')); return _faceFrames; }
function imgFor(key) { return faceFrames().find((f) => f.dataset.f === key); }
function ready(img) { return img && img.complete && img.naturalWidth; }
function setupFaceCanvas() {
  _faceCanvas = document.getElementById('faceCanvas');
  if (!_faceCanvas) return;
  _fctx = _faceCanvas.getContext('2d');
  _mouthCanvas = document.createElement('canvas');
  _mctx = _mouthCanvas.getContext('2d');
  _faceDPR = Math.min(2, window.devicePixelRatio || 1);
  resizeFaceCanvas();
  window.addEventListener('resize', resizeFaceCanvas);
}
function resizeFaceCanvas() {
  if (!_faceCanvas) return;
  const r = _faceCanvas.getBoundingClientRect();
  _faceCanvas.width = Math.max(1, Math.round(r.width * _faceDPR));
  _faceCanvas.height = Math.max(1, Math.round(r.height * _faceDPR));
}
function mouthKey() {
  if (mouthLevel > 0.62) return 'continue';
  if (mouthLevel > 0.40) return 'mid';
  if (mouthLevel > 0.16) return 'start';
  return 'end';
}
// contain layout (same mapping for every frame -> patches align with the base)
function faceLayout(img) {
  const cw = _faceCanvas.width, ch = _faceCanvas.height;
  const s = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  return { s, dx: (cw - dw) / 2, dy: (ch - dh) * 0.42, dw, dh };
}
function drawContain(img, alpha) {
  if (!ready(img)) return;
  const L = faceLayout(img);
  _fctx.globalAlpha = alpha; _fctx.drawImage(img, L.dx, L.dy, L.dw, L.dh); _fctx.globalAlpha = 1;
}
// Composite ONLY the mouth region of `img` on top of the already-drawn base,
// feathered so its edges melt into the base face (hides the seam).
function drawMouthPatch(img) {
  if (!ready(img)) return;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const sx = MOUTH_BOX.x0 * iw, sy = MOUTH_BOX.y0 * ih;
  const sw = (MOUTH_BOX.x1 - MOUTH_BOX.x0) * iw, sh = (MOUTH_BOX.y1 - MOUTH_BOX.y0) * ih;
  const L = faceLayout(img);
  const dw = Math.max(1, Math.round(sw * L.s)), dh = Math.max(1, Math.round(sh * L.s));
  const dx = L.dx + sx * L.s, dy = L.dy + sy * L.s;
  if (_mouthCanvas.width !== dw || _mouthCanvas.height !== dh) { _mouthCanvas.width = dw; _mouthCanvas.height = dh; }
  _mctx.clearRect(0, 0, dw, dh);
  _mctx.globalCompositeOperation = 'source-over';
  _mctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  // feather with an elliptical radial mask (opaque center -> transparent edges)
  _mctx.globalCompositeOperation = 'destination-in';
  const cx = dw / 2, cy = dh * 0.5;
  const g = _mctx.createRadialGradient(cx, cy, Math.min(dw, dh) * 0.12, cx, cy, Math.max(dw, dh) * 0.52);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.6, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  _mctx.fillStyle = g; _mctx.fillRect(0, 0, dw, dh);
  _mctx.globalCompositeOperation = 'source-over';
  _fctx.drawImage(_mouthCanvas, dx, dy);
}
function updateFace() {
  if (!_fctx) return;
  const speaking = awake && isSpeakingNow();
  const baseKey = awake ? 'wake' : 'idle';   // STABLE base: eyes/brows/face never shimmer
  const active = _dissolve ? _dissolve.to : _shownFrame;
  if (baseKey !== active) {
    if (baseKey === 'idle' || active === 'idle') {
      _dissolve = { from: active, to: baseKey, start: performance.now(), dur: 900 };
    } else { _shownFrame = baseKey; _dissolve = null; }
  }
  _fctx.clearRect(0, 0, _faceCanvas.width, _faceCanvas.height);
  if (_dissolve) {
    const t = Math.min(1, (performance.now() - _dissolve.start) / _dissolve.dur);
    drawContain(imgFor(_dissolve.from), 1);
    drawContain(imgFor(_dissolve.to), t);
    if (t >= 1) { _shownFrame = _dissolve.to; _dissolve = null; }
  } else {
    drawContain(imgFor(_shownFrame), 1);
    // overlay just the animated mouth on the stable base while speaking
    if (speaking && _shownFrame === 'wake') drawMouthPatch(imgFor(mouthKey()));
  }
}

/* ============================================================
   UI helpers
   ============================================================ */
function setStatus(txt) { if (statusEl) statusEl.textContent = txt; }
function idleStatus() { return awake ? 'LISTENING' : 'SLEEPING'; }
function setMode(m) {
  root.setAttribute('data-mode', m === 'idle' ? '' : m);
}

/* ---------- sleep / wake (face eye open-close) ---------- */
function wakeUp() {
  if (awake) return;
  awake = true;
  root.setAttribute('data-awake', '1');   // crossfades closed -> open eyes
  setStatus('LISTENING');
  if (stateHintEl) stateHintEl.innerHTML = 'I am<br />listening';
  if (modeEl) modeEl.textContent = 'ONLINE';
  say('Command me, Master.');
  // Warm the chess pipeline in the background so "best move" can answer instantly.
  if (window.JarvisChess && JarvisChess.hasVision()) JarvisChess.startPrefetch();
}
function sleepMode() {
  awake = false;
  if (window.JarvisChess) JarvisChess.stopPrefetch();
  root.removeAttribute('data-awake');       // crossfades open -> closed eyes
  setStatus('SLEEPING');
  if (stateHintEl) stateHintEl.innerHTML = '"Say<br />\'Wake up\'"';
  if (modeEl) modeEl.textContent = 'STANDBY';
  if (jarvisEl) jarvisEl.textContent = 'Say "Wake up"';
}

/* ---------- hardcoded response helpers (no AI) ---------- */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const JOKES = [
  'Why did the A I cross the road? To optimise the chicken, Master.',
  'I would tell you a U D P joke, but you might not get it, Master.',
  'There are ten kinds of people: those who understand binary, and those who do not, Master.',
  'I am reading a book on anti gravity. It is impossible to put down, Master.',
];
function sayTime() {
  const d = new Date(); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  say(`It is ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}, Master.`);
}
function sayDate() {
  const d = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mons = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  say(`Today is ${days[d.getDay()]}, ${mons[d.getMonth()]} ${d.getDate()}, Master.`);
}

/* ---------- randomised Instagram-style status report ---------- */
/* ---------- 2. status report (fixed Instagram numbers) ---------- */
function reportStats() {
  setStatus('EXECUTING');
  say('Your Instagram page currently has 9 followers, 7K monthly views, and your top-performing Reel has 1.6K views with 48 likes. You also have 3 notifications, Master.');
}

/* ---------- 3 & 4. main light ---------- */
let mainLightOn = true;
function setLight(on) {
  mainLightOn = on;
  setStatus(on ? 'LIGHT ON' : 'LIGHT OFF');
  say('Done, Sir.');
}

/* ---------- 6. good night -> speak, then close the eyes ---------- */
function goodNight() {
  setStatus('POWERING DOWN');
  say('Good night, Master.');
  // let her finish the line, then close the eyes silently
  const closeWhenDone = () => {
    if (isSpeakingNow()) { setTimeout(closeWhenDone, 150); return; }
    sleepMode();
  };
  setTimeout(closeWhenDone, 400);
}
// NOTE: we intentionally do NOT display the user's own speech.
// Show what the recogniser is hearing (helps see mis-detections).
const heardEl = document.getElementById('heard');
let heardTimer = null;
function showYou(txt, final) {
  if (!heardEl) return;
  heardEl.textContent = txt ? '\u201C' + txt.trim() + '\u201D' : '';
  heardEl.classList.toggle('active', !!txt);
  if (heardTimer) { clearTimeout(heardTimer); heardTimer = null; }
  if (final && txt) heardTimer = setTimeout(() => { heardEl.textContent = ''; heardEl.classList.remove('active'); }, 3500);
}

function pickVoice() {
  const vs = speechSynthesis.getVoices();
  const en = (re) => vs.find(v => re.test(v.name) && v.lang.startsWith('en'));
  return en(/Samantha/) || en(/Google UK English Female/) || en(/Google US English/)
    || en(/Serena|Karen|Moira|Tessa|Victoria|Fiona|Allison|Ava|Susan|Zira|Hazel|Kathy|Nora/)
    || en(/female/i)
    || vs.find(v => v.lang.startsWith('en'))
    || null;
}
function say(text) {
  jarvisEl.textContent = text;
  try {
    try { speechSynthesis.resume(); } catch (e) {} // counter Chrome's auto-pause
    const u = new SpeechSynthesisUtterance(text);
    const pref = pickVoice();
    if (pref) u.voice = pref;
    u.rate = 1.0; u.pitch = 1.08;   // pleasant female tone
    const myId = ttsBegin(text);    // claim the speech slot (also covers dropped onstart)
    u.onstart = () => { if (myId === ttsSeq) { ttsSpeaking = true; ttsStartedAt = performance.now(); } };
    u.onboundary = () => { mouthPulse = 1; };   // open the mouth on each word/syllable
    u.onend = () => { mouthPulse = 0; ttsFinish(myId); };
    u.onerror = () => { mouthPulse = 0; ttsFinish(myId); };
    utterRefs.push(u);
    muteFor(text);
    // Stop LISTENING while Jarvis speaks so the mic never transcribes its own
    // voice. onend -> scheduleRestart() re-arms it once the reply has finished.
    try { if (recog && recogRunning) recog.abort(); } catch (e) {}
    try { speechSynthesis.cancel(); } catch (e) {}
    speechSynthesis.speak(u);
  } catch (e) {}
}
function updateClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  let h = d.getHours(); const ampm = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  if (clockEl) clockEl.textContent = `${h}:${p(d.getMinutes())} ${ampm}`;
  if (dateEl) {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    dateEl.textContent = `${days[d.getDay()]}, ${mons[d.getMonth()]} ${d.getDate()}`;
  }
}

/* ============================================================
   Voice recognition (Web Speech API)
   ============================================================ */
let recog = null;
let lastCmd = 0;
let micDenied = false;
let recogRunning = false;
function handleTranscript(text) {
  const s = text.toLowerCase();
  const now = performance.now();
  // Ignore audio captured while (or just after) Jarvis is speaking, so its
  // own replies can't re-trigger commands (prevents feedback loops).
  if (aiBusy || now < muteUntil) return;
  pulseOrb(0.45); // react to the user speaking
  if (now - lastCmd < 500) return; // debounce
  const fire = () => { lastCmd = now; };

  // ---- sleep / wake gate ----
  if (!awake) {
    // 1. "Wake up" -> "Command me, Master."
    if (/\b(wake up|wakeup|wake|hey nexus|nexus wake|activate|good morning|rise)\b/.test(s)) { fire(); wakeUp(); }
    return; // while sleeping, ignore everything except the wake word
  }

  /* ===== COMMAND LIST (in order) ===== */

  // 6. "Go to sleep" -> "Good night, Master." then eyes close
  if (/\b(go to sleep|goto sleep|sleep now|sleep|good ?night|rest now|power down|stand ?by)\b/.test(s)) { fire(); goodNight(); return; }

  // 2. "What's the status" -> Instagram report
  if (/\b(status|stats|statistics|instagram|insta|socials?|my numbers|report)\b/.test(s)) { fire(); reportStats(); return; }

  // 3. "Turn off the main light" -> "Done, Sir."
  if (/\b(light|lights|lamp)\b/.test(s) && /\b(off|shut)\b/.test(s)) { fire(); setLight(false); return; }

  // 4. "It's dark, turn the main light on" -> "Done, Sir."
  if (/\b(light|lights|lamp)\b/.test(s) && /\b(on|dark)\b/.test(s)) { fire(); setLight(true); return; }

  // 5. "What is the best move for white" -> "Calculating, Sir." then the move
  if (/\b(best move|good move|my move|what should i (play|move)|next move|analy[sz]e (the )?(board|position)?)\b/.test(s)) {
    fire();
    const side = /\bwhite\b/.test(s) ? 'w' : /\bblack\b/.test(s) ? 'b' : null;
    say('Calculating, Sir.');
    if (window.JarvisChess) JarvisChess.bestMoveAuto({ setStatus, speak: say, flash: flashScreen }, side);
    return;
  }

  // ---- chess setup / watch helpers ----
  if (/\b(calibrate|calibration|set ?up (the )?board|chess setup)\b/.test(s)) { fire(); if (window.JarvisChess) JarvisChess.openCalibration(); say('Opening chess setup, Master.'); return; }
  if (/\b(stop watching|stop watch|watch off|stop auto)\b/.test(s)) { fire(); if (window.JarvisChess) JarvisChess.stopWatch({ setStatus, speak: say }); return; }
  if (/\b(watch (the )?board|auto ?watch|watch mode|keep watching)\b/.test(s)) { fire(); if (window.JarvisChess) JarvisChess.startWatch({ setStatus, speak: say }); return; }

  // ---- hardcoded chit-chat (NO AI) ----
  if (/\b(hello|hi|hey|greetings|good (morning|evening|afternoon))\b/.test(s)) { fire(); say(pick(['Hello, Master.', 'At your service, Master.', 'Yes, Master?'])); return; }
  if (/\b(how are you|how do you feel|you okay|how'?s it going)\b/.test(s)) { fire(); say('Operating at full capacity, Master.'); return; }
  if (/\b(who are you|what(?:'?s| is)? your name|your name)\b/.test(s)) { fire(); say('I am Nexus, your A I companion.'); return; }
  if (/\b(thank you|thanks|thank u|appreciate)\b/.test(s)) { fire(); say(pick(['Always a pleasure, Master.', 'Anytime, Master.'])); return; }
  if (/\b(what can you do|help me|your commands|what do you do)\b/.test(s)) { fire(); say('Try: what is the status, turn off the main light, what is the best move for white, or go to sleep, Master.'); return; }
  if (/\bwhat time\b|\bthe time\b|\btell me the time\b/.test(s)) { fire(); sayTime(); return; }
  if (/\bwhat(?:'?s| is)? (the )?date\b|\bwhat day\b|\btoday'?s date\b/.test(s)) { fire(); sayDate(); return; }
  if (/\b(joke|make me laugh|something funny)\b/.test(s)) { fire(); say(pick(JOKES)); return; }
  if (/\b(i love you|love you)\b/.test(s)) { fire(); say('You are my favourite human, Master.'); return; }
  if (/\b(good ?bye|see you later)\b/.test(s)) { fire(); goodNight(); return; }
  if (/\b(weather|temperature|forecast)\b/.test(s)) { fire(); say('I cannot check the weather offline, Master.'); return; }
  if (/\b(are you there|you there|nexus)\b/.test(s)) { fire(); say('I am here, Master.'); return; }

  // ---- unrecognised -> hardcoded fallback (NO AI conversation) ----
  fire();
  say(pick(['I did not catch that, Master.', 'Command not recognised, Master.', 'Say that again, Master?']));
}

let shouldListen = true;
let lastRecogActivity = performance.now();
function markActivity() { lastRecogActivity = performance.now(); }
function safeStartRecog() {
  if (!recog || !shouldListen || micDenied) return;
  if (recogRunning) return;
  try { recog.start(); markActivity(); } catch (e) { /* 'already started' — ignore */ }
}
// Restart only once Jarvis has stopped speaking, so we never collide with TTS.
function scheduleRestart() {
  if (!shouldListen || micDenied) return;
  const wait = Math.max(300, muteUntil - performance.now() + 250);
  setTimeout(safeStartRecog, wait);
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus('⚠ VOICE UNSUPPORTED — USE CHROME');
    return;
  }
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = 'en-US';

  recog.onstart = () => { recogRunning = true; markActivity(); setStatus(idleStatus()); };
  recog.onaudiostart = () => { markActivity(); setStatus(idleStatus()); };
  recog.onspeechstart = () => { markActivity(); if (awake && performance.now() >= muteUntil && !aiBusy) { setStatus('◉ HEARING…'); pulseOrb(0.5); } };
  recog.onspeechend = () => { markActivity(); if (!aiBusy) setStatus(idleStatus()); };
  recog.onresult = (ev) => {
    markActivity();
    // Ignore anything captured while Jarvis is speaking (its own voice echo).
    if (performance.now() < muteUntil) return;
    let interim = '', finalTxt = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalTxt += r[0].transcript; else interim += r[0].transcript;
    }
    if (interim) {
      showYou(interim, false); pulseOrb(0.35);
      // Head start: begin the chess analysis the moment we hear "move",
      // ~1s before the final transcript arrives.
      if (awake && /\bmove\b/i.test(interim) && window.JarvisChess && JarvisChess.hasVision()) {
        const side = /\bwhite\b/i.test(interim) ? 'w' : /\bblack\b/i.test(interim) ? 'b' : null;
        JarvisChess.startPrefetch(side || undefined);
      }
    }
    if (finalTxt) { showYou(finalTxt, true); handleTranscript(finalTxt); }
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      micDenied = true; shouldListen = false; setStatus('ALLOW MIC, RELOAD');
    } else if (e.error === 'network') {
      setStatus('SPEECH NET — RETRYING');
    } else if (e.error === 'audio-capture') {
      setStatus('NO MICROPHONE');
    }
    // non-fatal errors: onend will fire and scheduleRestart() brings it back
  };
  recog.onend = () => {
    recogRunning = false;
    // Restart AFTER any current TTS finishes (restarting during/right after a
    // reply is what used to kill it after a few commands).
    scheduleRestart();
  };

  safeStartRecog();

  // Watchdog: keep recognition alive. Restarts if it dropped, and force-recovers
  // if it silently stalls (Chrome sometimes stops delivering results without
  // firing onend). Never restarts while Jarvis is speaking.
  setInterval(() => {
    if (!shouldListen || micDenied) return;
    const now = performance.now();
    if (now < muteUntil) return;                 // Jarvis is speaking — leave it
    if (!recogRunning) { safeStartRecog(); return; }
    if (now - lastRecogActivity > 4000) {        // stalled -> force a clean restart (faster recovery)
      try { recog.abort(); } catch (e) {}
      recogRunning = false;
      markActivity();
      setTimeout(safeStartRecog, 300);
    }
  }, 1500);
}

/* ============================================================
   Reactor orb reactivity — driven by speech events + TTS,
   NOT a getUserMedia mic stream (which would block SpeechRecognition).
   ============================================================ */
let audioCtx = null;
let micLevel = 0, targetLevel = 0;
let mouthLevel = 0, mouthTarget = 0, mouthPulse = 0; // lip-sync
let jarvisSpeaking = false;        // for orb reactivity only (never gates input)
let aiBusy = false;                // true while a Groq request is in flight
let muteUntil = 0;                 // ignore mic commands until this time (Jarvis's speaking window)
const utterRefs = [];              // keep utterance refs so Chrome can't GC them

// Estimate how long a phrase takes to speak (time-boxed mic mute fallback).
// No hard cap: long sentences must stay muted/animated for their full length.
function estimateSpeechMs(text) {
  const words = (text.trim().split(/\s+/).length) || 1;
  return Math.max(700, words * 380 + 600);
}
function muteFor(text) { muteUntil = Math.max(muteUntil, performance.now() + estimateSpeechMs(text)); }

/* ---- authoritative "is she actually talking right now?" ----
   Driven by real utterance start/end events AND the engine's speaking flag,
   so the lips animate for the WHOLE sentence (never cut off mid-sentence),
   while a hard deadline guarantees it can never stick forever. */
let ttsSpeaking = false;          // set by utterance onstart/onend
let ttsHardStop = 0;              // absolute safety deadline
let ttsStartedAt = 0;             // for a short grace period before the engine flag flips
let ttsSeq = 0;                   // only the LATEST utterance may change the state
function ttsBegin(text) {
  ttsSpeaking = true;
  ttsStartedAt = performance.now();
  ttsHardStop = performance.now() + estimateSpeechMs(text) * 2.5 + 4000;
  return ++ttsSeq;
}
// A stale utterance's onend must NOT stop the lips of a newer one.
function ttsFinish(id) { if (id !== undefined && id !== ttsSeq) return; ttsSpeaking = false; ttsStartedAt = 0; }
// Authoritative for the LIPS: follows real speech start/end, so it neither cuts
// off mid-sentence nor keeps flapping after she has finished.
function isSpeakingNow() {
  const now = performance.now();
  if (now > ttsHardStop) ttsSpeaking = false;                 // safety: never stick
  if (!ttsSpeaking) return false;
  if (now - ttsStartedAt < 600) return true;                  // grace: engine flag lags at start
  let engine = false;
  try { engine = speechSynthesis.speaking || speechSynthesis.pending; } catch (e) { engine = true; }
  return engine;
}

function startSpeechWatchdog() {
  setInterval(() => {
    try { if (speechSynthesis.speaking) speechSynthesis.resume(); } catch (e) {} // counter Chrome's pause bug
    // keep the mic muted as long as she is genuinely still talking
    try { if (ttsSpeaking && speechSynthesis.speaking) muteUntil = Math.max(muteUntil, performance.now() + 400); } catch (e) {}
    jarvisSpeaking = isSpeakingNow();                                            // drives orb pulse
    if (utterRefs.length > 12) utterRefs.splice(0, utterRefs.length - 12);       // trim refs
  }, 200);
}

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') { audioCtx.resume().catch(() => {}); }
}
function pulseOrb(v) { targetLevel = Math.max(targetLevel, v); }

/* ============================================================
   Groq conversation mode (fast LLM, streaming)
   ------------------------------------------------------------
   Non-command speech is sent to Groq. Tokens stream back and are
   spoken sentence-by-sentence as they arrive, so Jarvis starts
   replying almost instantly.
   ============================================================ */
// ▼▼▼ PASTE YOUR GROQ API KEY HERE (get one free at console.groq.com) ▼▼▼
const GROQ_API_KEY = '';
// ▲▲▲ leave the quotes; e.g. 'gsk_xxxxxxxxxxxxxxxx' ▲▲▲
// (You can also set it at runtime without editing the file:
//  open the browser console and run  __GROQ_KEY__ = 'gsk_...'  then reload.)
function groqKey() { return GROQ_API_KEY || (typeof window !== 'undefined' && window.__GROQ_KEY__) || ''; }
const GROQ_MODEL = 'qwen/qwen3.8-27b'; // fastest chat model on this account (~170ms). Alt: 'openai/gpt-oss-20b' (add reasoning_effort:'low')
const GROQ_SYSTEM = "You are JARVIS, Tony Stark's AI assistant. Reply in ONE calm, witty, concise sentence, under 18 words. Address the user as 'sir'. Never use emojis, markdown, or reasoning tags. Give only the final answer.";

function speakChunk(text) {
  const clean = text.trim();
  if (!clean) return;
  try {
    const u = new SpeechSynthesisUtterance(clean);
    const pref = pickVoice();
    if (pref) u.voice = pref;
    u.rate = 1.0; u.pitch = 1.08;
    const myId = ttsBegin(clean);
    u.onstart = () => { if (myId === ttsSeq) { ttsSpeaking = true; ttsStartedAt = performance.now(); } };
    u.onboundary = () => { mouthPulse = 1; };
    u.onend = () => { mouthPulse = 0; ttsFinish(myId); };
    u.onerror = () => { mouthPulse = 0; ttsFinish(myId); };
    utterRefs.push(u);
    muteFor(clean);
    speechSynthesis.speak(u);
  } catch (e) {}
}

async function askGroq(userText) {
  if (!groqKey()) {
    // graceful fallback until a key is added
    say('My uplink needs an A P I key, sir.');
    return;
  }
  setStatus('◉ THINKING');
  pulseOrb(0.4);
  aiBusy = true;                     // block new input while this reply is in flight
  muteUntil = 0;
  try { speechSynthesis.cancel(); } catch (e) {}
  utterRefs.length = 0;
  jarvisEl.textContent = '';

  let buffer = '', full = '';
  const ac = new AbortController();
  const killer = setTimeout(() => ac.abort(), 15000); // never let aiBusy stick
  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey() },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        max_tokens: 60,
        temperature: 0.6,
        messages: [
          { role: 'system', content: GROQ_SYSTEM },
          { role: 'user', content: userText },
        ],
      }),
    });
    if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let sse = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sse += dec.decode(value, { stream: true });
      const lines = sse.split('\n');
      sse = lines.pop(); // keep the trailing partial line
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) {
            buffer += delta; full += delta;
            // strip any reasoning tags so they're never shown or spoken
            const clean = full.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
            jarvisEl.textContent = clean;
            pulseOrb(0.3);
            // don't speak while inside an unclosed <think> block
            if (buffer.includes('<think>') && !buffer.includes('</think>')) continue;
            buffer = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '');
            // speak each complete sentence as soon as it lands
            let m;
            while ((m = buffer.match(/^([\s\S]*?[.!?…])(\s|$)/))) {
              speakChunk(m[1]);
              buffer = buffer.slice(m[0].length);
            }
          }
        } catch (e) { /* ignore malformed keep-alive lines */ }
      }
    }
    if (buffer.trim()) {
      const tail = buffer.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
      if (tail) speakChunk(tail);
    }
  } catch (e) {
    say('Connection glitch, sir.');
  } finally {
    clearTimeout(killer);
    aiBusy = false;
    setStatus('◉ LISTENING');
  }
}

// Warm the connection on boot so the first real reply isn't cold (only if a key is set).
function warmGroq() {
  if (!groqKey()) return;
  fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey() },
    body: JSON.stringify({ model: GROQ_MODEL, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
  }).catch(() => {});
}

function boom() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
  g.gain.setValueAtTime(0.5, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.6);
}

/* ============================================================
   MediaPipe wiring
   ============================================================ */
function onResults(results) {
  const hands = [];
  if (results.multiHandLandmarks) {
    for (const lm of results.multiHandLandmarks) {
      const c = palmCenter(lm);
      hands.push({ px: mapPoint(c.x, c.y), open: openness(lm), sizePx: handSizePx(lm) });
    }
  }
  hands.sort((a, b) => a.px.x - b.px.x);
  hands.forEach((h, idx) => {
    h.element = (hands.length === 1 ? h.px.x < W / 2 : idx === 0) ? 'fire' : 'bolt';
  });
  latestHands = hands;
  detectClap(hands);
}

/* ============================================================
   Boot
   ============================================================ */
function boot() {
  if (booted) return; booted = true;
  if (wake) wake.classList.add('hidden');
  if (loader) loader.classList.add('hidden');

  // warm up speech synthesis voices + audio (for SFX)
  try { speechSynthesis.getVoices(); } catch (e) {}
  ensureAudio();
  startSpeechWatchdog();
  setupFaceCanvas();
  if (window.JarvisChess) JarvisChess.init(); // load chess engine + saved calibration

  // Start rendering + voice immediately. Begin ASLEEP (closed eyes);
  // the user says "wake up" to open the eyes and activate.
  sleepMode();
  requestAnimationFrame(render);
  startVoice();

  // Camera / hand tracking is DISABLED by design (no MediaPipe).
}
let booted = false;

// No "tap to begin" gate — boot immediately on load.
boot();

// Browsers block speech synthesis until the first user interaction. Unlock it
// (and the audio context + mic) silently on the very first click/keypress/touch
// anywhere — no visible gate. After this, Jarvis can speak.
let audioUnlocked = false;
function unlockAudioSpeech() {
  if (audioUnlocked) return; audioUnlocked = true;
  ensureAudio();
  try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
  try {
    speechSynthesis.resume();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; // silent priming utterance to unlock TTS for later
    speechSynthesis.speak(u);
  } catch (e) {}
  safeStartRecog();
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, unlockAudioSpeech, { once: true }));

// Keyboard: press C to open chess setup (screen-share needs a click anyway)
window.addEventListener('keydown', (e) => {
  if (e.key === 'c' || e.key === 'C') { if (window.JarvisChess) JarvisChess.openCalibration(); }
});
// voices load asynchronously in some browsers
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { try { speechSynthesis.getVoices(); } catch (e) {} };
