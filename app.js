/* ============================================================
   J.A.R.V.I.S. — Elemental Hands
   Fire (left palm) · Lightning (right palm) · Clap shockwave
   Hand tracking: MediaPipe Hands · Rendering: Canvas 2D (additive glow)
   ============================================================ */

const video   = document.getElementById('video');
const canvas  = document.getElementById('fx');
const ctx     = canvas.getContext('2d');
const stage   = document.getElementById('stage');
const flash   = document.getElementById('flash');
const statusEl= document.getElementById('status');
const gate    = document.getElementById('gate');
const startBtn= document.getElementById('startBtn');
const loader  = document.getElementById('loader');
const hud     = document.getElementById('hud');
const legend  = document.getElementById('legend');

/* ---------- config ---------- */
let swapHands = false;   // press S to swap which physical hand casts fire/lightning
let uiHidden  = false;
let muted     = false;

/* ---------- canvas sizing ---------- */
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

/* ---------- coordinate mapping ----------
   Maps a MediaPipe normalized point (0..1, un-mirrored) to canvas pixels,
   matching the video's object-fit: cover AND the horizontal mirror. */
function mapPoint(nx, ny) {
  const vw = video.videoWidth  || 1280;
  const vh = video.videoHeight || 720;
  const cw = canvas.width, ch = canvas.height;
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale, dh = vh * scale;
  const offx = (cw - dw) / 2, offy = (ch - dh) / 2;
  let x = nx * dw + offx;
  const y = ny * dh + offy;
  x = cw - x; // mirror to match the flipped video
  return { x, y };
}

/* ============================================================
   Particle systems
   ============================================================ */
const fireParticles = [];
const emberParticles = [];
const sparkParticles = [];
const shockwaves = [];

function rand(a, b) { return a + Math.random() * (b - a); }

/* ---------- FIRE ---------- */
function spawnFire(x, y, openness) {
  // openness 0 (fist) -> tight bright core; 1 (open) -> wide flames
  const spread = 8 + openness * 60;
  const count = Math.round(2 + openness * 6);
  for (let i = 0; i < count; i++) {
    fireParticles.push({
      x: x + rand(-spread, spread) * 0.35,
      y: y + rand(-6, 10),
      vx: rand(-spread, spread) * 0.06,
      vy: -rand(1.6, 4.2) * (0.7 + openness * 0.8),
      life: 1,
      decay: rand(0.012, 0.03),
      size: rand(14, 30) * (0.7 + openness * 0.6),
      hue: rand(12, 45),
    });
  }
  // rising embers for extra sparkle
  if (Math.random() < 0.6) {
    emberParticles.push({
      x: x + rand(-spread, spread) * 0.4,
      y: y + rand(-4, 6),
      vx: rand(-0.6, 0.6),
      vy: -rand(2.5, 5),
      life: 1,
      decay: rand(0.008, 0.02),
      size: rand(1.5, 3.5),
    });
  }
}

function drawFire() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = fireParticles.length - 1; i >= 0; i--) {
    const p = fireParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy *= 0.98;      // buoyancy fade
    p.vx *= 0.97;
    p.life -= p.decay;
    if (p.life <= 0) { fireParticles.splice(i, 1); continue; }

    const r = p.size * (0.6 + p.life * 0.8);
    const a = Math.max(0, p.life);
    // hotter (whiter) in the core, redder as it dies
    const light = 45 + p.life * 45;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0,   `hsla(${p.hue + 20}, 100%, ${light + 15}%, ${a})`);
    g.addColorStop(0.4, `hsla(${p.hue}, 100%, ${light}%, ${a * 0.8})`);
    g.addColorStop(1,   `hsla(${p.hue - 10}, 100%, 30%, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = emberParticles.length - 1; i >= 0; i--) {
    const e = emberParticles[i];
    e.x += e.vx; e.y += e.vy; e.vy *= 0.99;
    e.life -= e.decay;
    if (e.life <= 0) { emberParticles.splice(i, 1); continue; }
    ctx.fillStyle = `hsla(${rand(30,55)}, 100%, 70%, ${e.life})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- LIGHTNING ---------- */
function drawBolt(x1, y1, x2, y2, thickness, color, jag) {
  const segs = 6 + Math.floor(Math.random() * 5);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const nx = x1 + (x2 - x1) * t + rand(-jag, jag);
    const ny = y1 + (y2 - y1) * t + rand(-jag, jag);
    ctx.lineTo(nx, ny);
  }
  ctx.lineTo(x2, y2);
  ctx.lineWidth = thickness;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 18;
  ctx.shadowColor = '#35e6ff';
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawLightning(x, y, openness) {
  ctx.globalCompositeOperation = 'lighter';

  // glowing core in the palm
  const coreR = 16 + openness * 18;
  const cg = ctx.createRadialGradient(x, y, 0, x, y, coreR);
  cg.addColorStop(0, 'rgba(220,250,255,0.95)');
  cg.addColorStop(0.4, 'rgba(53,230,255,0.6)');
  cg.addColorStop(1, 'rgba(53,230,255,0)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(x, y, coreR, 0, Math.PI * 2);
  ctx.fill();

  // arcs radiating outward — more/longer when the hand is open
  const bolts = Math.round(2 + openness * 5);
  const len = 60 + openness * 150;
  for (let i = 0; i < bolts; i++) {
    const ang = rand(0, Math.PI * 2);
    const l = len * rand(0.5, 1);
    const ex = x + Math.cos(ang) * l;
    const ey = y + Math.sin(ang) * l;
    drawBolt(x, y, ex, ey, rand(1.5, 3), 'rgba(180,245,255,0.9)', 14 + openness * 16);
    // occasional forked white-hot bolt
    if (Math.random() < 0.4) {
      drawBolt(x, y, ex, ey, 1, 'rgba(255,255,255,0.9)', 8);
    }
    // tip spark
    sparkParticles.push({
      x: ex, y: ey, vx: Math.cos(ang) * rand(0.5, 2), vy: Math.sin(ang) * rand(0.5, 2),
      life: 1, decay: rand(0.05, 0.12), size: rand(1, 2.5),
    });
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
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- EXPLOSION + SHOCKWAVE (clap) ---------- */
const explosions = [];

function flashScreen() {
  flash.style.transition = 'none';
  flash.style.opacity = '0.98';
  requestAnimationFrame(() => {
    flash.style.transition = 'opacity 0.8s ease';
    flash.style.opacity = '0';
  });
}
function shakeScreen() {
  stage.classList.remove('shake');
  void stage.offsetWidth; // reflow to restart animation
  stage.classList.add('shake');
  setTimeout(() => stage.classList.remove('shake'), 600);
}

function explode(x, y) {
  const maxDim = Math.min(canvas.width, canvas.height);
  // layered fireball that lingers ~2s
  explosions.push({ x, y, r: 14, maxR: maxDim * 0.55, life: 1, decay: 0.010, type: 'ball' });
  explosions.push({ x, y, r: 8,  maxR: maxDim * 0.32, life: 1, decay: 0.018, type: 'core' });

  // outward blast of fire particles
  for (let i = 0; i < 140; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(4, 20);
    fireParticles.push({
      x, y,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp - 2,
      life: 1,
      decay: rand(0.006, 0.014),
      size: rand(12, 30),
      hue: rand(8, 45),
    });
  }
  // debris sparks
  for (let i = 0; i < 60; i++) {
    const ang = rand(0, Math.PI * 2);
    const sp = rand(8, 26);
    sparkParticles.push({
      x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      life: 1, decay: rand(0.008, 0.02), size: rand(1.5, 3.5),
    });
  }

  shockwaves.push({ x, y, r: 10, maxR: Math.hypot(canvas.width, canvas.height), life: 1 });
  flashScreen();
  shakeScreen();
  boom();
  setStatus('💥 EXPLOSION');
}

function drawExplosions() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i];
    e.r += (e.maxR - e.r) * 0.08;
    e.life -= e.decay;
    if (e.life <= 0) { explosions.splice(i, 1); continue; }
    const a = Math.max(0, e.life);
    const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r);
    if (e.type === 'core') {
      g.addColorStop(0,   `rgba(255,255,245,${a})`);
      g.addColorStop(0.3, `rgba(255,215,130,${a * 0.85})`);
      g.addColorStop(1,   'rgba(255,120,30,0)');
    } else {
      g.addColorStop(0,   `rgba(255,190,90,${a * 0.7})`);
      g.addColorStop(0.5, `rgba(255,110,30,${a * 0.4})`);
      g.addColorStop(1,   'rgba(120,20,0,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawShockwaves() {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const w = shockwaves[i];
    w.r += (w.maxR - w.r) * 0.06 + 6;
    w.life -= 0.02;
    if (w.life <= 0) { shockwaves.splice(i, 1); continue; }
    const a = Math.max(0, w.life);
    // chromatic triple-ring
    const offs = [[-4, '#ff2d5e'], [0, '#ffffff'], [4, '#35e6ff']];
    for (const [o, col] of offs) {
      ctx.beginPath();
      ctx.arc(w.x, w.y, w.r + o, 0, Math.PI * 2);
      ctx.lineWidth = 6 * a;
      ctx.strokeStyle = col;
      ctx.globalAlpha = a * 0.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

/* ============================================================
   Hand analysis
   ============================================================ */
function palmCenter(lm) {
  // average of wrist + finger MCPs => stable palm point
  const ids = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const id of ids) { x += lm[id].x; y += lm[id].y; }
  return { x: x / ids.length, y: y / ids.length };
}

function handSize(lm) {
  // wrist(0) to middle-finger MCP(9) as a scale reference
  return Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) || 0.001;
}

function openness(lm) {
  // Rotation/scale-invariant openness.
  // For each finger, compare wrist->tip vs wrist->pip distance: an extended
  // finger has its tip farther from the wrist than its pip joint (ratio > 1),
  // a curled finger has it closer (ratio < 1). Ratios cancel out hand size AND
  // orientation, so effects work at any rotation/tilt of the hand.
  const w = lm[0];
  const fingers = [[6, 8], [10, 12], [14, 16], [18, 20]]; // [pip, tip]
  let sum = 0;
  for (const [pip, tip] of fingers) {
    const dTip = Math.hypot(lm[tip].x - w.x, lm[tip].y - w.y);
    const dPip = Math.hypot(lm[pip].x - w.x, lm[pip].y - w.y) + 1e-6;
    const r = dTip / dPip;
    sum += Math.max(0, Math.min(1, (r - 1.0) / 0.45));
  }
  return sum / fingers.length;
}

// hand scale in screen pixels (for distance-independent clap detection)
function handSizePx(lm) {
  const w = mapPoint(lm[0].x, lm[0].y);
  const m = mapPoint(lm[9].x, lm[9].y);
  return Math.hypot(w.x - m.x, w.y - m.y) || 1;
}

/* ============================================================
   Clap detection — robust to hand overlap/occlusion.
   Arm when hands separate; fire when they meet OR when a fast
   approach ends in overlap (MediaPipe often drops to 1 hand at
   the moment of contact, which the occlusion-catch handles).
   Thresholds scale with hand size => distance-independent.
   ============================================================ */
let clapArmed = false;
let lastClap = 0;
let prevPalmDist = null;
let pendingClap = null; // {x, y, expire} — set during a fast approach

function detectClap(hands) {
  const now = performance.now();

  if (hands.length < 2) {
    // Hands overlapped and one was lost mid-clap -> fire on the pending approach.
    if (pendingClap && now < pendingClap.expire && now - lastClap > 400) {
      lastClap = now;
      explode(pendingClap.x, pendingClap.y);
    }
    clapArmed = false;
    prevPalmDist = null;
    pendingClap = null;
    return;
  }

  const a = hands[0], b = hands[1];
  const d = Math.hypot(a.px.x - b.px.x, a.px.y - b.px.y);
  const hs = Math.max(a.sizePx, b.sizePx, canvas.width * 0.03);
  const clapDist = hs * 3.0;
  const openDist = hs * 4.5;
  const mx = (a.px.x + b.px.x) / 2, my = (a.px.y + b.px.y) / 2;

  const closing = prevPalmDist === null ? 0 : (prevPalmDist - d);
  const fast = closing > hs * 0.30; // rapid approach this frame

  if (d > openDist) clapArmed = true;

  // remember a fast approach so we can still fire if a hand vanishes next frame
  if (clapArmed && fast && d < openDist) {
    pendingClap = { x: mx, y: my, expire: now + 260 };
  }

  if (clapArmed && (d < clapDist || (fast && d < hs * 3.8)) && now - lastClap > 400) {
    clapArmed = false;
    pendingClap = null;
    lastClap = now;
    explode(mx, my);
  }

  prevPalmDist = d;
}

/* ============================================================
   WebAudio SFX (simple synth — no assets)
   ============================================================ */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
}
function boom() {
  if (muted || !audioCtx) return;
  const t = audioCtx.currentTime;
  // low sine sweep
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.5);
  g.gain.setValueAtTime(0.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t + 0.6);
  // noise burst
  const dur = 0.35;
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audioCtx.createBufferSource();
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.5, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.buffer = buf;
  src.connect(ng).connect(audioCtx.destination);
  src.start(t);
}
let lastZap = 0;
function zap() {
  if (muted || !audioCtx) return;
  const now = performance.now();
  if (now - lastZap < 120) return;
  lastZap = now;
  const t = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(rand(1800, 3200), t);
  o.frequency.exponentialRampToValueAtTime(rand(400, 700), t + 0.08);
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g).connect(audioCtx.destination);
  o.start(t); o.stop(t + 0.12);
}

/* ============================================================
   Main loop
   ============================================================ */
let latestHands = [];   // [{px:{x,y}, open, element:'fire'|'bolt', sizePx}]
let fireI = 0, boltI = 0; // smoothed effect intensities (slow ramp)

function render() {
  // clear fully so the live webcam stays bright (no dark overlay)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let fireHand = null, boltHand = null;
  for (const h of latestHands) {
    if (h.element === 'fire') fireHand = h; else boltHand = h;
  }

  // gate: closed fist (open < 0.18) produces nothing
  const gate = (o) => (o < 0.18 ? 0 : (o - 0.18) / 0.82);
  const fireTarget = fireHand ? gate(fireHand.open) : 0;
  const boltTarget = boltHand ? gate(boltHand.open) : 0;

  // slow ramp up/down so effects grow gradually as the hand opens
  fireI += (fireTarget - fireI) * 0.10;
  boltI += (boltTarget - boltI) * 0.10;

  if (fireHand && fireI > 0.04) spawnFire(fireHand.px.x, fireHand.px.y, fireI);
  if (boltHand && boltI > 0.04) {
    drawLightning(boltHand.px.x, boltHand.px.y, boltI);
    if (boltI > 0.3) zap();
  }

  drawFire();
  drawSparks();
  drawExplosions();
  drawShockwaves();

  requestAnimationFrame(render);
}

/* ============================================================
   MediaPipe wiring
   ============================================================ */
function onResults(results) {
  const hands = [];
  if (results.multiHandLandmarks) {
    for (let i = 0; i < results.multiHandLandmarks.length; i++) {
      const lm = results.multiHandLandmarks[i];
      const c = palmCenter(lm);
      const px = mapPoint(c.x, c.y);
      hands.push({ px, open: openness(lm), sizePx: handSizePx(lm) });
    }
  }
  // Assign element by stable on-screen position (not MediaPipe's noisy
  // Left/Right label, which flickers). Leftmost hand on screen = fire.
  hands.sort((h1, h2) => h1.px.x - h2.px.x);
  hands.forEach((h, idx) => {
    let isFire = hands.length === 1 ? (h.px.x < canvas.width / 2) : (idx === 0);
    if (swapHands) isFire = !isFire;
    h.element = isFire ? 'fire' : 'bolt';
  });

  latestHands = hands;
  detectClap(hands);

  if (hands.length === 0) setStatus('SEARCHING FOR HANDS…');
  else if (performance.now() - lastClap > 900) {
    setStatus(hands.length === 2 ? '⚡ DUAL WIELD ACTIVE' : '◉ ONLINE — 1 HAND');
  }
}

let statusResetT = 0;
function setStatus(txt) {
  statusEl.textContent = txt;
  statusResetT = performance.now();
}

/* ============================================================
   Boot
   ============================================================ */
async function boot() {
  gate.classList.add('hidden');
  loader.classList.remove('hidden');
  ensureAudio();
  if (audioCtx && audioCtx.state === 'suspended') { try { await audioCtx.resume(); } catch (e) {} }

  if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
    loader.innerHTML = '<div style="max-width:420px;text-align:center;line-height:1.7">' +
      '⚠️ Could not load the hand-tracking library.<br>Check your internet connection and reload.<br>' +
      '<small>(MediaPipe is loaded from a CDN.)</small></div>';
    return;
  }

  const hands = new Hands({
    locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  hands.onResults(onResults);

  try {
    const camera = new Camera(video, {
      onFrame: async () => { await hands.send({ image: video }); },
      width: 1280,
      height: 720,
    });
    await camera.start();
  } catch (err) {
    loader.innerHTML = '<div style="max-width:420px;text-align:center;line-height:1.7">' +
      '⚠️ Camera access denied or unavailable.<br>Allow camera permission and reload.<br>' +
      `<small>${(err && err.message) ? err.message : err}</small></div>`;
    return;
  }

  // wait for the first frame so videoWidth is known
  const waitReady = setInterval(() => {
    if (video.videoWidth > 0) {
      clearInterval(waitReady);
      loader.classList.add('hidden');
      setStatus('◉ ONLINE');
      render();
    }
  }, 100);
}

/* ---------- UI events ---------- */
startBtn.addEventListener('click', boot);

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 's') {
    swapHands = !swapHands;
    setStatus(swapHands ? '↔ HANDS SWAPPED' : '↔ HANDS DEFAULT');
  } else if (k === 'h') {
    uiHidden = !uiHidden;
    hud.classList.toggle('faded', uiHidden);
    legend.classList.toggle('faded', uiHidden);
  } else if (k === 'm') {
    muted = !muted;
    setStatus(muted ? '🔇 MUTED' : '🔊 SOUND ON');
  }
});
