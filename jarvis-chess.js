/* ============================================================
   J.A.R.V.I.S. — Chess "best move" module
   Voice: "Jarvis, best move" ->
     capture mirrored phone screen -> read board (local template
     match) -> Stockfish (WASM, in-browser) -> speak the move.
   Everything runs locally for ~0.3-0.5s latency. No cloud vision.
   ============================================================ */
const JarvisChess = (() => {
  const LS = 'jarvisChessCalib';

  /* ---------------- Chess engine (Stockfish, single-thread) ---------------- */
  let engine = null, engineReady = false, bestmoveCb = null;
  const ENGINE_URLS = [
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
    'https://cdn.jsdelivr.net/npm/stockfish@11.1.0/src/stockfish.js',
  ];
  function loadEngine() {
    if (engine) return;
    for (const url of ENGINE_URLS) {
      try {
        const blob = new Blob([`importScripts('${url}');`], { type: 'application/javascript' });
        engine = new Worker(URL.createObjectURL(blob));
        engine.onmessage = (ev) => {
          const line = typeof ev.data === 'string' ? ev.data : (ev.data && ev.data.data) || '';
          if (line.includes('uciok')) { engine.postMessage('isready'); }
          else if (line.includes('readyok')) { engineReady = true; }
          else if (line.startsWith('bestmove')) {
            const mv = line.split(' ')[1];
            if (bestmoveCb) { const cb = bestmoveCb; bestmoveCb = null; cb(mv); }
          }
        };
        engine.onerror = () => {};
        engine.postMessage('uci');
        break;
      } catch (e) { engine = null; }
    }
  }
  function bestMove(fen, movetime = 250) {
    return new Promise((resolve) => {
      if (!engine) { loadEngine(); }
      let waited = 0;
      const go = () => {
        if (!engineReady && waited < 8000) { waited += 100; return setTimeout(go, 100); }
        if (!engineReady) return resolve(null);
        bestmoveCb = (mv) => resolve(mv);
        engine.postMessage('ucinewgame');
        engine.postMessage('position fen ' + fen);
        engine.postMessage('go movetime ' + movetime);
      };
      go();
    });
  }

  /* ---------------- Screen capture (mirrored phone) ---------------- */
  let stream = null, video = null;
  async function startCapture() {
    if (stream && stream.active) return true;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      return true;
    } catch (e) { stream = null; return false; }
  }
  function grabFrameVideo() {
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return c;
  }

  /* ---------------- ADB capture (Android, via local bridge) ---------------- */
  const ADB_URL = 'http://localhost:8788';
  async function adbHealth() {
    try {
      const r = await fetch(ADB_URL + '/health', { cache: 'no-store' });
      return await r.json();
    } catch (e) { return { ok: false, adb: false, devices: 0, bridge: false }; }
  }
  async function adbFrame() {
    const r = await fetch(ADB_URL + '/screenshot?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('adb screenshot failed');
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return c;
  }

  // Unified async frame grab based on the active capture source.
  let captureSource = 'adb'; // 'adb' | 'screen'
  async function getFrame() {
    if (captureSource === 'adb') { try { return await adbFrame(); } catch (e) { return null; } }
    return grabFrameVideo();
  }

  /* ---------------- Calibration state ---------------- */
  // rect: normalized {x,y,w,h} of the board within the frame.
  // orientation: 'white' (white at bottom) or 'black' (black at bottom).
  // myColor: 'w' or 'b' (whose move to compute).
  // templates: { wp:Float32Array(576), ... , bk:... } learned from the start position.
  // emptyStd: threshold below which a square is considered empty.
  let calib = { rect: null, orientation: 'black', myColor: 'b', templates: null, emptyStd: null };
  function saveCalib() {
    try {
      const t = {};
      if (calib.templates) for (const k in calib.templates) t[k] = Array.from(calib.templates[k]);
      localStorage.setItem(LS, JSON.stringify({ rect: calib.rect, orientation: calib.orientation, myColor: calib.myColor, templates: t, emptyStd: calib.emptyStd, source: captureSource }));
    } catch (e) {}
  }
  function loadCalib() {
    try {
      const s = JSON.parse(localStorage.getItem(LS) || 'null');
      if (!s) return;
      calib.rect = s.rect; calib.orientation = s.orientation || 'black'; calib.myColor = s.myColor || 'b';
      calib.emptyStd = s.emptyStd;
      if (s.source) captureSource = s.source;
      if (s.templates) { calib.templates = {}; for (const k in s.templates) calib.templates[k] = Float32Array.from(s.templates[k]); }
    } catch (e) {}
  }

  /* ---------------- Square feature extraction ---------------- */
  const SZ = 24; // downscaled square size
  function squareFeature(srcCanvas, sx, sy, sw, sh) {
    const c = document.createElement('canvas'); c.width = SZ; c.height = SZ;
    const ctx = c.getContext('2d');
    ctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, SZ, SZ);
    const d = ctx.getImageData(0, 0, SZ, SZ).data;
    const gray = new Float32Array(SZ * SZ);
    for (let i = 0; i < SZ * SZ; i++) {
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    // background = mean of border pixels (the square color / highlight)
    let bsum = 0, bn = 0;
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
      if (x < 2 || y < 2 || x >= SZ - 2 || y >= SZ - 2) { bsum += gray[y * SZ + x]; bn++; }
    }
    const bg = bsum / bn;
    // silhouette = gray - background (emphasises the piece, ignores square color)
    const feat = new Float32Array(SZ * SZ);
    let variance = 0, centerSum = 0, centerN = 0;
    for (let i = 0; i < feat.length; i++) { feat[i] = gray[i] - bg; variance += feat[i] * feat[i]; }
    for (let y = 6; y < SZ - 6; y++) for (let x = 6; x < SZ - 6; x++) { centerSum += feat[y * SZ + x]; centerN++; }
    const std = Math.sqrt(variance / feat.length);
    const centerMean = centerSum / centerN; // >0 => piece brighter than bg (white), <0 => darker (black)
    // normalise to unit length so matching compares SHAPE, not contrast/square-colour
    let norm = 0; for (let i = 0; i < feat.length; i++) norm += feat[i] * feat[i];
    norm = Math.sqrt(norm);
    if (norm > 1e-6) for (let i = 0; i < feat.length; i++) feat[i] /= norm;
    return { feat, std, centerMean };
  }
  function ssd(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

  /* ---------------- Board grid iteration ---------------- */
  // Yields image squares in display order (row 0 = top). Maps to absolute
  // file/rank using orientation.
  function eachSquare(frame, cb) {
    const fw = frame.width, fh = frame.height;
    const r = calib.rect;
    const bx = r.x * fw, by = r.y * fh, bw = r.w * fw, bh = r.h * fh;
    const cw = bw / 8, ch = bh / 8;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const sx = bx + col * cw, sy = by + row * ch;
      cb(row, col, sx, sy, cw, ch);
    }
  }
  // display (row,col) -> absolute {file 0..7 (a..h), rank 0..7 (rank1..8)}
  function toAbsolute(row, col) {
    if (calib.orientation === 'white') {
      // white bottom: top row = rank8, left col = file a
      return { file: col, rank: 7 - row };
    } else {
      // black bottom (flipped 180): top row = rank1, left col = file h
      return { file: 7 - col, rank: row };
    }
  }

  /* ---------------- Learn templates from the START position ---------------- */
  // Standard start layout by absolute rank (0=rank1 .. 7=rank8), file (0=a..7=h)
  const START = {
    0: ['wr','wn','wb','wq','wk','wb','wn','wr'],
    1: ['wp','wp','wp','wp','wp','wp','wp','wp'],
    6: ['bp','bp','bp','bp','bp','bp','bp','bp'],
    7: ['br','bn','bb','bq','bk','bb','bn','br'],
  };
  function learnFromStart(frame) {
    const acc = {}; const cnt = {};
    const emptyStds = []; const pieceStds = [];
    eachSquare(frame, (row, col, sx, sy, cw, ch) => {
      const abs = toAbsolute(row, col);
      const f = squareFeature(frame, sx, sy, cw, ch);
      const code = (START[abs.rank] ? START[abs.rank][abs.file] : null);
      if (code) {
        if (!acc[code]) { acc[code] = new Float32Array(f.feat.length); cnt[code] = 0; }
        for (let i = 0; i < f.feat.length; i++) acc[code][i] += f.feat[i];
        cnt[code]++; pieceStds.push(f.std);
      } else {
        emptyStds.push(f.std); // ranks 3-6 empty
      }
    });
    const templates = {};
    for (const code in acc) {
      const a = acc[code];
      for (let i = 0; i < a.length; i++) a[i] /= cnt[code];
      // re-normalise the averaged template to unit length
      let n = 0; for (let i = 0; i < a.length; i++) n += a[i] * a[i];
      n = Math.sqrt(n);
      if (n > 1e-6) for (let i = 0; i < a.length; i++) a[i] /= n;
      templates[code] = a;
    }
    // empty threshold: midpoint between max empty std and min piece std
    const maxEmpty = Math.max(...emptyStds, 0);
    const minPiece = Math.min(...pieceStds, 999);
    calib.emptyStd = (maxEmpty + minPiece) / 2;
    calib.templates = templates;
    saveCalib();
    return { pieces: Object.keys(templates).length, emptyStd: Math.round(calib.emptyStd) };
  }

  /* ---------------- Recognise current board -> FEN ---------------- */
  function recognise(frame) {
    if (!calib.rect || !calib.templates) return null;
    const board = {}; // board[rank][file] = code or null
    for (let r = 0; r < 8; r++) board[r] = [null, null, null, null, null, null, null, null];
    eachSquare(frame, (row, col, sx, sy, cw, ch) => {
      const abs = toAbsolute(row, col);
      const f = squareFeature(frame, sx, sy, cw, ch);
      if (f.std < calib.emptyStd) { board[abs.rank][abs.file] = null; return; }
      const color = f.centerMean >= 0 ? 'w' : 'b';
      let best = null, bestScore = Infinity;
      for (const code in calib.templates) {
        if (code[0] !== color) continue;
        const sc = ssd(f.feat, calib.templates[code]);
        if (sc < bestScore) { bestScore = sc; best = code; }
      }
      board[abs.rank][abs.file] = best;
    });
    return board;
  }
  function boardToFen(board) {
    const map = { wp:'P', wn:'N', wb:'B', wr:'R', wq:'Q', wk:'K', bp:'p', bn:'n', bb:'b', br:'r', bq:'q', bk:'k' };
    let rows = [];
    for (let rank = 7; rank >= 0; rank--) {
      let s = '', empty = 0;
      for (let file = 0; file < 8; file++) {
        const c = board[rank][file];
        if (!c) { empty++; }
        else { if (empty) { s += empty; empty = 0; } s += map[c]; }
      }
      if (empty) s += empty;
      rows.push(s);
    }
    // castling rights unknown from a snapshot -> assume none lost we can detect;
    // give both sides KQkq if kings/rooks on home squares, else '-'.
    let castle = '';
    if (board[0][4] === 'wk') { if (board[0][7] === 'wr') castle += 'K'; if (board[0][0] === 'wr') castle += 'Q'; }
    if (board[7][4] === 'bk') { if (board[7][7] === 'br') castle += 'k'; if (board[7][0] === 'br') castle += 'q'; }
    if (!castle) castle = '-';
    return `${rows.join('/')} ${calib.myColor} ${castle} - 0 1`;
  }

  /* ---------------- UCI move -> spoken phrase ---------------- */
  function moveToSpeech(uci, board) {
    if (!uci || uci.length < 4) return 'No move found, sir.';
    const files = 'abcdefgh';
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4];
    const ff = files.indexOf(from[0]), fr = parseInt(from[1]) - 1;
    const tf = files.indexOf(to[0]);
    const names = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
    let piece = 'Piece';
    if (board && board[fr] && board[fr][ff]) piece = names[board[fr][ff][1]] || 'Piece';
    // castling
    if (piece === 'King' && Math.abs(tf - ff) === 2) return tf > ff ? 'Castle kingside, sir.' : 'Castle queenside, sir.';
    const captures = board && board[parseInt(to[1]) - 1] && board[parseInt(to[1]) - 1][tf];
    let phrase = `${piece} ${captures ? 'takes' : 'to'} ${to[0].toUpperCase()}${to[1]}`;
    if (promo) phrase += `, promote to ${names[promo] || 'Queen'}`;
    return phrase + ', sir.';
  }

  /* ---------------- Orchestrator: run one "best move" ---------------- */
  let running = false;
  async function analyseAndSpeak(hooks) {
    const { setStatus, speak, flash } = hooks;
    if (running) return; running = true;
    try {
      if (!calib.rect || !calib.templates) { speak('Calibrate the chessboard first, sir. Say calibrate.'); return; }
      if (captureSource === 'screen' && (!stream || !stream.active)) { speak('Share the phone screen first, sir. Opening setup.'); openCalibration(); return; }
      if (captureSource === 'adb') {
        const h = await adbHealth();
        if (h.bridge === false) { speak('The A D B bridge is offline, sir. Start it on the laptop.'); return; }
        if (!h.ok) { speak(h.adb === false ? 'A D B is not installed, sir.' : 'No phone detected over A D B, sir.'); return; }
      }
      setStatus('◉ READING BOARD');
      if (flash) flash();
      const frame = await getFrame();
      if (!frame) { speak('I cannot capture the screen, sir.'); return; }
      const board = recognise(frame);
      const fen = boardToFen(board);
      lastFen = fen; lastBoard = board;
      setStatus('◉ CALCULATING');
      const uci = await bestMove(fen, 400);
      if (!uci || uci === '(none)') { speak('No legal move, sir. The board read may be off.'); return; }
      speak(moveToSpeech(uci, board));
      setStatus('◉ LISTENING');
    } catch (e) {
      speak('Chess analysis failed, sir.');
    } finally { running = false; }
  }

  let lastFen = null, lastBoard = null;

  /* ============================================================
     NO-SETUP vision mode (Gemini reads the board -> FEN)
     Screenshot -> Gemini vision -> FEN -> Stockfish -> speak.
     No calibration, works on any theme. Say "best move for black/white".
     ============================================================ */
  const GEMINI_API_KEY = ''; // ← paste a Google Gemini API key (free at aistudio.google.com)
  function geminiKey() { return GEMINI_API_KEY || (typeof window !== 'undefined' && window.__GEMINI_KEY__) || ''; }
  const GEMINI_MODEL = 'gemini-3.6-flash';

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }
  async function getFrameBlob() {
    if (captureSource === 'adb') {
      try { const r = await fetch(ADB_URL + '/screenshot?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null; return await r.blob(); }
      catch (e) { return null; }
    }
    const c = grabFrameVideo();
    if (!c) return null;
    return await new Promise((res) => c.toBlob(res, 'image/png'));
  }
  // Build a full FEN from a piece-placement field, inferring castling from home squares.
  function deriveFen(placement, side) {
    const ranks = placement.trim().split('/');
    if (ranks.length !== 8) return null;
    const board = {};
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i; board[rank] = []; let f = 0;
      for (const ch of ranks[i]) {
        if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) board[rank][f++] = null; }
        else board[rank][f++] = ch;
      }
      if (f !== 8) return null;
    }
    let castle = '';
    if (board[0][4] === 'K') { if (board[0][7] === 'R') castle += 'K'; if (board[0][0] === 'R') castle += 'Q'; }
    if (board[7][4] === 'k') { if (board[7][7] === 'r') castle += 'k'; if (board[7][0] === 'r') castle += 'q'; }
    if (!castle) castle = '-';
    return `${placement.trim()} ${side} ${castle} - 0 1`;
  }
  function fenToBoard(fen) {
    const placement = fen.split(' ')[0], ranks = placement.split('/'), board = {};
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i; board[rank] = []; let f = 0;
      for (const ch of ranks[i]) {
        if (/\d/.test(ch)) { for (let k = 0; k < +ch; k++) board[rank][f++] = null; }
        else { const color = ch === ch.toUpperCase() ? 'w' : 'b'; board[rank][f++] = color + ch.toLowerCase(); }
      }
    }
    return board;
  }
  // Downscale before uploading — a smaller image is markedly faster to analyse
  // and the board is still perfectly legible.
  async function shrinkBlob(blob, maxW = 520) {
    try {
      const bmp = await createImageBitmap(blob);
      if (bmp.width <= maxW) return blob;
      const s = maxW / bmp.width;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', 0.85));
    } catch (e) { return blob; }
  }
  async function visionFen(blob, side) {
    const key = geminiKey();
    if (!key) throw new Error('no-key');
    const small = await shrinkBlob(blob);
    const b64 = await blobToB64(small);
    const mime = small.type && small.type.startsWith('image/') ? small.type : 'image/png';
    const prompt = 'This image is a screenshot of a chess.com game or puzzle. Using the a-h and 1-8 coordinate labels on the board to orient it correctly, output ONLY the FEN piece-placement field: 8 ranks from rank 8 down to rank 1, separated by "/", uppercase KQRBNP for white pieces, lowercase kqrbnp for black, digits for consecutive empty squares. Each rank MUST sum to exactly 8 squares. Output nothing except that FEN field.';
    const body = {
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: b64 } }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    };
    // The primary model is sometimes overloaded (503) — fall through to alternates.
    const models = [GEMINI_MODEL, 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.7-flash'];
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < models.length * 2; attempt++) {
      const model = models[attempt % models.length];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      let r;
      try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
      catch (e) { lastErr = 'network'; continue; }
      if (r.status === 429 || r.status >= 500) { lastErr = 'HTTP ' + r.status; continue; }
      if (!r.ok) { lastErr = 'HTTP ' + r.status; continue; }
      const j = await r.json();
      const text = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => p.text || '').join('');
      const m = text.match(/([pnbrqkPNBRQK1-8]+(?:\/[pnbrqkPNBRQK1-8]+){7})/);
      if (m) { const fen = deriveFen(m[1], side); if (fen) return fen; lastErr = 'invalid-fen'; }
      else lastErr = 'no-fen';
    }
    throw new Error(lastErr);
  }

  /* ============================================================
     PREFETCH — keep an answer ready BEFORE you ask.
     The vision API takes ~4-7s, so we can never be fast if we start
     when asked. Instead we continuously watch the phone in the
     background: a cheap screenshot + pixel hash detects when the board
     changed, and only then do we run vision + engine. The result is
     cached, so answering is instant (~0.2s).
     ============================================================ */
  let cache = null;          // { sig, fen, uci, speech, at }
  let prefetching = false;   // vision/engine busy in the background
  let prefetchTimer = null;
  let lastSig = null;

  // Cheap perceptual signature of a frame (downscaled grey grid).
  function frameSignature(canvas) {
    const N = 24;
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(canvas, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    let s = '';
    for (let i = 0; i < d.length; i += 4) {
      s += String.fromCharCode(48 + Math.round((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 8));
    }
    return s;
  }
  function sigDiffers(a, b) {
    if (!a || !b || a.length !== b.length) return true;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > 1) diff++;
    return diff > a.length * 0.004;   // >0.4% of cells changed = board moved
  }
  async function grabCanvasAndBlob() {
    if (captureSource === 'adb') {
      try {
        const r = await fetch(ADB_URL + '/screenshot?t=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) return null;
        const blob = await r.blob();
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        return { canvas: c, blob };
      } catch (e) { return null; }
    }
    const c = grabFrameVideo();
    if (!c) return null;
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return { canvas: c, blob };
  }
  // Analyse now and fill the cache (used by prefetch AND by a cold request).
  async function analyseToCache(side, sig, blob) {
    const fen = await visionFen(blob, side);
    if (!fen) throw new Error('no-fen');
    const uci = await bestMove(fen, 300);
    if (!uci || uci === '(none)') throw new Error('no-move');
    cache = { sig, fen, uci, speech: moveToSpeech(uci, fenToBoard(fen)), side, at: Date.now() };
    lastFen = fen;
    return cache;
  }
  async function prefetchTick() {
    if (prefetching || running || !geminiKey()) return;
    const grab = await grabCanvasAndBlob();
    if (!grab) return;
    const sig = frameSignature(grab.canvas);
    if (!sigDiffers(sig, lastSig)) return;      // nothing changed -> keep cache
    lastSig = sig;
    prefetching = true;
    try { await analyseToCache(prefetchSide, sig, grab.blob); }
    catch (e) { /* keep the old cache */ }
    finally { prefetching = false; }
  }
  let prefetchSide = 'w';
  function startPrefetch(side) {
    if (side) prefetchSide = side;
    if (prefetchTimer) return;
    prefetchTimer = setInterval(prefetchTick, 1800);
    prefetchTick();
  }
  function stopPrefetch() { if (prefetchTimer) { clearInterval(prefetchTimer); prefetchTimer = null; } }

  async function analyseVision(side, hooks) {
    const { setStatus, speak, flash } = hooks;
    if (running) return; running = true;
    try {
      if (!geminiKey()) { speak('Add a Gemini key for no-setup mode, sir.'); return; }
      prefetchSide = side;
      if (flash) flash();

      // ---- FAST PATH: a background answer is already waiting ----
      const grab = await grabCanvasAndBlob();
      if (!grab) { speak('I cannot capture the screen, sir.'); return; }
      const sig = frameSignature(grab.canvas);
      if (cache && cache.side === side && !sigDiffers(sig, cache.sig) && Date.now() - cache.at < 120000) {
        setStatus('◉ LISTENING');
        speak(cache.speech);                                   // instant
        startPrefetch(side);
        return;
      }
      // If a background analysis of this exact board is already in flight, wait
      // for it instead of starting a second one.
      if (prefetching) {
        const deadline = Date.now() + 9000;
        while (prefetching && Date.now() < deadline) await new Promise((r) => setTimeout(r, 120));
        if (cache && !sigDiffers(sig, cache.sig)) { setStatus('◉ LISTENING'); speak(cache.speech); startPrefetch(side); return; }
      }

      // ---- COLD PATH: analyse now ----
      setStatus('◉ READING BOARD');
      lastSig = sig;
      let res;
      try { res = await analyseToCache(side, sig, grab.blob); }
      catch (e) {
        speak(e.message === 'no-key' ? 'Add a Gemini key, sir.'
          : e.message === 'no-move' ? 'No legal move, sir; the read may be off.'
          : 'I could not read the board, sir.');
        return;
      }
      setStatus('◉ LISTENING');
      speak(res.speech);
      startPrefetch(side);
    } catch (e) { speak('Chess analysis failed, sir.'); }
    finally { running = false; }
  }

  // Picks no-setup vision if a Gemini key exists, else the calibrated template reader.
  function bestMoveAuto(hooks, side) {
    if (geminiKey()) return analyseVision(side || calib.myColor || 'w', hooks);
    return analyseAndSpeak(hooks);
  }

  /* ---------------- Auto-watch mode ---------------- */
  // Polls the phone, and whenever the position changes it announces the best
  // move for your side. Great for a hands-free reel. Best-effort: it speaks on
  // every board change (so mostly right after the opponent moves).
  let watchTimer = null, watchLastKey = null, watchHooks = null;
  async function watchTick() {
    if (!isCalibrated() || running) return;
    const frame = await getFrame();
    if (!frame) return;
    const board = recognise(frame);
    const fen = boardToFen(board);
    const key = fen.split(' ')[0];
    if (key === watchLastKey) return;   // no change
    watchLastKey = key;
    if (watchStartKey === null) { watchStartKey = key; return; } // skip the first read
    const uci = await bestMove(fen, 200);
    if (uci && uci !== '(none)' && watchHooks) watchHooks.speak(moveToSpeech(uci, board));
  }
  let watchStartKey = null;
  function startWatch(hooks) {
    if (watchTimer) return;
    if (!isCalibrated()) { hooks.speak('Calibrate the chessboard first, sir.'); return; }
    watchHooks = hooks; watchLastKey = null; watchStartKey = null;
    hooks.setStatus('◉ WATCHING');
    watchTimer = setInterval(watchTick, 1300);
    hooks.speak('Watching the board, sir.');
  }
  function stopWatch(hooks) {
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    if (hooks && hooks.setStatus) hooks.setStatus('◉ LISTENING');
    if (hooks && hooks.speak) hooks.speak('Watch mode off, sir.');
  }

  /* ---------------- Calibration overlay UI ---------------- */
  let ui = null;
  function buildUI() {
    if (ui) return;
    ui = document.createElement('div');
    ui.id = 'chessCalib';
    ui.innerHTML = `
      <div class="cc-panel">
        <div class="cc-head">♟ CHESS SETUP <span class="cc-close">✕</span></div>
        <div class="cc-steps">
          <div class="cc-row cc-source">
            <label>Capture:
              <select class="cc-src">
                <option value="adb">Android (ADB — silent)</option>
                <option value="screen">Screen share (any)</option>
              </select>
            </label>
            <button class="cc-btn cc-connect" data-a="connect">1 · Connect</button>
          </div>
          <div class="cc-canvas-wrap"><canvas class="cc-canvas"></canvas><div class="cc-rect"></div></div>
          <div class="cc-row">
            <label>Orientation:
              <select class="cc-orient">
                <option value="black">Black at bottom</option>
                <option value="white">White at bottom</option>
              </select>
            </label>
            <label>Your side:
              <select class="cc-mycolor">
                <option value="b">Black</option>
                <option value="w">White</option>
              </select>
            </label>
          </div>
          <div class="cc-hint">2 · Drag a box tightly around the 8×8 board above.</div>
          <button class="cc-btn" data-a="learn">3 · Learn pieces (set board to START position first)</button>
          <div class="cc-status">Not calibrated.</div>
          <button class="cc-btn cc-done" data-a="done">Done</button>
        </div>
      </div>`;
    document.body.appendChild(ui);
    const canvas = ui.querySelector('.cc-canvas');
    const rectEl = ui.querySelector('.cc-rect');
    const statusEl = ui.querySelector('.cc-status');
    const wrap = ui.querySelector('.cc-canvas-wrap');
    let drawing = false, start = null, snap = null;

    async function refreshSnap() {
      const f = await getFrame();
      if (!f) { statusEl.textContent = captureSource === 'adb' ? 'No ADB frame — start the bridge & connect the phone, then Connect.' : 'No frame — share the screen first.'; return; }
      snap = f;
      const scale = Math.min(360 / f.width, 520 / f.height);
      canvas.width = f.width * scale; canvas.height = f.height * scale;
      canvas.getContext('2d').drawImage(f, 0, 0, canvas.width, canvas.height);
      if (calib.rect) drawSavedRect();
    }
    function drawSavedRect() {
      rectEl.style.display = 'block';
      rectEl.style.left = (canvas.offsetLeft + calib.rect.x * canvas.width) + 'px';
      rectEl.style.top = (canvas.offsetTop + calib.rect.y * canvas.height) + 'px';
      rectEl.style.width = (calib.rect.w * canvas.width) + 'px';
      rectEl.style.height = (calib.rect.h * canvas.height) + 'px';
    }
    canvas.addEventListener('mousedown', (e) => { drawing = true; const r = canvas.getBoundingClientRect(); start = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    window.addEventListener('mousemove', (e) => {
      if (!drawing) return; const r = canvas.getBoundingClientRect();
      const x = Math.min(Math.max(e.clientX - r.left, 0), canvas.width), y = Math.min(Math.max(e.clientY - r.top, 0), canvas.height);
      const rx = Math.min(start.x, x), ry = Math.min(start.y, y), rw = Math.abs(x - start.x), rh = Math.abs(y - start.y);
      rectEl.style.display = 'block';
      rectEl.style.left = (canvas.offsetLeft + rx) + 'px'; rectEl.style.top = (canvas.offsetTop + ry) + 'px';
      rectEl.style.width = rw + 'px'; rectEl.style.height = rh + 'px';
      calib.rect = { x: rx / canvas.width, y: ry / canvas.height, w: rw / canvas.width, h: rh / canvas.height };
    });
    window.addEventListener('mouseup', () => { drawing = false; });

    ui.querySelector('.cc-close').onclick = () => hideCalibration();
    ui.querySelector('.cc-orient').onchange = (e) => { calib.orientation = e.target.value; saveCalib(); };
    ui.querySelector('.cc-mycolor').onchange = (e) => { calib.myColor = e.target.value; saveCalib(); };
    ui.querySelector('.cc-src').onchange = (e) => { captureSource = e.target.value; saveCalib(); };
    ui.addEventListener('click', async (e) => {
      const a = e.target.getAttribute('data-a');
      if (a === 'connect') {
        if (captureSource === 'adb') {
          const h = await adbHealth();
          if (h.bridge === false) { statusEl.textContent = 'ADB bridge offline. Run: node adb-bridge.cjs'; return; }
          if (!h.ok) { statusEl.textContent = h.adb === false ? 'ADB not installed.' : 'No phone over ADB (USB debugging on?).'; return; }
          statusEl.textContent = `ADB connected (${h.devices} device). Drawing the board box…`;
          await refreshSnap();
        } else {
          const ok = await startCapture();
          statusEl.textContent = ok ? 'Screen shared. Drag a box around the board.' : 'Screen share denied.';
          if (ok) setTimeout(refreshSnap, 400);
        }
      }
      else if (a === 'learn') {
        await refreshSnap();
        if (!snap || !calib.rect) { statusEl.textContent = 'Connect and draw the board box first.'; return; }
        const res = learnFromStart(snap);
        statusEl.textContent = `Learned ${res.pieces}/12 pieces. Calibrated ✓ (empty≈${res.emptyStd})`;
      }
      else if (a === 'done') { saveCalib(); hideCalibration(); }
    });
    ui._refreshSnap = refreshSnap;
    ui.querySelector('.cc-orient').value = calib.orientation;
    ui.querySelector('.cc-mycolor').value = calib.myColor;
    ui.querySelector('.cc-src').value = captureSource;
  }
  function openCalibration() { buildUI(); ui.style.display = 'grid'; setTimeout(() => ui._refreshSnap(), 200); }
  function hideCalibration() { if (ui) ui.style.display = 'none'; }

  /* ---------------- init ---------------- */
  function isCalibrated() { return !!(calib.rect && calib.templates); }
  function init() { loadCalib(); loadEngine(); }

  return {
    init, openCalibration, hideCalibration,
    bestMove: (hooks) => analyseAndSpeak(hooks),
    bestMoveAuto,
    startWatch, stopWatch,
    startPrefetch, stopPrefetch,
    isCalibrated,
    hasVision: () => !!geminiKey(),
    getLastFen: () => lastFen,
    getCache: () => cache,
    adbHealth,
    _debug: { learnFromStart, recognise, boardToFen, moveToSpeech, bestMoveEngine: bestMove, toAbsolute, setCalib: (c) => Object.assign(calib, c), deriveFen, fenToBoard, visionFen, analyseVision, frameSignature, sigDiffers, grabCanvasAndBlob, analyseToCache, prefetchTick },
  };
})();
if (typeof window !== 'undefined') window.JarvisChess = JarvisChess;
