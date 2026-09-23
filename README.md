# NEXUS · voice AI companion 🎙️

**NEXUS** (`jarvis-ui.html`) — a voice-controlled AI companion with a cinematic UI. A calm face sleeps (closed eyes) until you say **"wake up"**, then her eyes open and she listens. No camera / hand tracking — it's **voice only**, with a fast LLM (Groq), a no-setup chess assistant (Gemini + Stockfish over ADB), and spoken replies.

> (`index.html` "Elemental Hands" — the older webcam hand-effects demo — is still present but separate.)

## 🔑 API keys (not included)

For security, API keys are **blank** in this repository. Add your own before running:

| Key | File | Where to get it (free tier) |
|---|---|---|
| **Groq** | `jarvis-ui.js` → `const GROQ_API_KEY = ''` | console.groq.com |
| **Gemini** | `jarvis-chess.js` → `const GEMINI_API_KEY = ''` | aistudio.google.com |

You can also set them at runtime without editing files — open the browser console and run
`__GROQ_KEY__ = 'your_key'` / `__GEMINI_KEY__ = 'your_key'`, then reload.

Voice commands and the UI work without any keys; only the AI chat and the no-setup chess
board reading need them.


## Run it

Mic needs a local server (not opening the file directly):

```bash
cd jarvis
python3 -m http.server 8777
```

### NEXUS — **http://localhost:8777/jarvis-ui.html**
Open in **Chrome**, tap once to grant the **microphone**, then it's voice-only. She starts **asleep**:

| Say… | Result |
|---|---|
| **"wake up"** | eyes open — NEXUS activates and listens |
| **"go to sleep"** / "goodnight" | eyes close — back to standby |
| **"best move for white/black"** | chess assistant (see below) |
| **"watch the board"** / "stop watching" | hands-free chess auto-analysis |
| **"calibrate"** (or press **C**) | open chess setup |
| anything else | sent to the AI (Groq) — she replies by voice |

The sleeping/awake face is a smooth **eye open/close** crossfade of the same portrait (not an image swap). Your own spoken words are never shown on screen. **Camera / hand tracking is disabled.**

> Tip: Chrome + internet (speech + LLMs load from CDNs/APIs).

#### Enable the AI (Groq) — fast, streaming replies
Anything that isn't a keyword command is answered by a fast LLM (Groq) in the Jarvis voice, streamed sentence-by-sentence for ~instant response. To turn it on:
1. Get a free API key at **console.groq.com**.
2. Open `jarvis-ui.js`, find `const GROQ_API_KEY = ''` near the top of the Groq section, and paste your key inside the quotes.
   - Or, without editing the file: open the browser console and run `__GROQ_KEY__ = 'gsk_...'`, then reload.
3. Reload, wake, and just talk — e.g. *"Jarvis, what's the plan for today?"*

Model is `qwen/qwen3.8-27b` (fastest chat model on this account, ~170ms). Alternatives: `openai/gpt-oss-20b`. Until a key is added, non-command speech gets a spoken "uplink needs a key" fallback.

> Note: the key sits in the page, which is fine for a personal reel; don't publish the page with a real key in it.

#### ♟ Chess "best move" (phone screenshot → Stockfish → spoken move)
Say **"Jarvis, best move"** and it captures your phone screen, reads the board locally, runs Stockfish in-browser, and speaks the move — *"Pawn to c6, sir."* — all in ~0.3–0.5s, no cloud.

**Two capture methods:**

**A) Android via ADB (recommended — silent, pixel-perfect, no share prompt)**

*Wireless (no cable):*
1. Phone and laptop on the **same Wi‑Fi**. On the phone: Developer options → **Wireless debugging → On** → **Pair device with pairing code** (shows a 6‑digit code + an `IP:pairPort`; the main screen shows a different `IP:port`).
2. On the laptop:
   ```bash
   cd jarvis
   node adb-bridge.cjs pair 192.168.x.x:PAIRPORT 123456   # from the pairing popup
   node adb-bridge.cjs connect 192.168.x.x:PORT           # from the main screen; starts the server
   ```
   The address is remembered — next time just run `node adb-bridge.cjs` and it auto-reconnects.

*Cable (USB):*
1. Enable **USB debugging**, plug in, accept the prompt. Confirm with `adb devices`.
2. Start the bridge: `node adb-bridge.cjs` (serves `http://localhost:8788/screenshot`).

Then in Jarvis say **"calibrate"** (or press **C**) → set **Capture: Android (ADB)** → click **Connect** → a live phone snapshot appears (no browser prompt).

**B) Screen share (any phone incl. iPhone)**
1. Mirror the phone to the laptop first — Android: `scrcpy`; iPhone: QuickTime (USB) or an AirPlay receiver.
2. In setup choose **Capture: Screen share** → **Connect** → pick the mirrored window.

**Then, for either method:**
4. Choose **orientation** (Black/White at bottom) and **your side**.
5. **Drag a tight box** around the 8×8 board on the snapshot.
6. Set the board to the **starting position** in your app, then click **Learn pieces** (calibrates to your exact piece style). **Done.**

**Using it:**
- **"Jarvis, best move"** → speaks the top move for your side.
- **"best move for black"** / **"best move for white"** → specify the side explicitly.
- **"watch the board"** → auto-watch mode: it announces the best move by itself whenever the position changes. **"stop watching"** to end.
- Check what it read anytime in the console: `JarvisChess.getLastFen()` → paste into lichess.org/analysis to confirm.

**No-setup mode (any board, zero calibration — needs a vision key):**
Skip the board-box + Learn-pieces calibration entirely by letting **Google Gemini** read the board from the screenshot. Get a free key at **aistudio.google.com**, then in `jarvis-chess.js` set `const GEMINI_API_KEY = ''` (or run `__GEMINI_KEY__ = '...'` in the console). With a Gemini key present, **"best move for black/white"** captures the current screenshot → Gemini reads it into a position → Stockfish → spoken move, on any theme with no calibration (~1–1.5s). Without a Gemini key it falls back to the calibrated local reader above.

Notes: calibration (board box + learned pieces + orientation + capture source) is saved. ADB needs the bridge running; screen-share needs re-sharing each session. Recalibrate **Learn pieces** if you change board themes. Engine assistance in rated online games breaks fair-play rules — use for a **demo/reel** only.

### Elemental Hands — **http://localhost:8777/index.html**
Open in **Chrome** and click **ACTIVATE JARVIS** (allow the camera).

> Tip: for the best-looking reel, shoot in a **dark room** — the glowing fire/lightning pops against black.

## Controls (Elemental Hands)

| Action | How |
|---|---|
| 🔥 Fire | Open the hand on the **left side** of the screen. A closed **fist = off**; open slowly and the flame grows in gradually. |
| ⚡ Lightning | Open the hand on the **right side** of the screen. Fist = off; open hand = longer, more intense arcs. |
| 💥 Explosion | **Clap** your hands — a big fireball + shockwave + screen shake + boom (lasts ~2s). Fires reliably on every clap. |
| Swap sides | Press **S** (if fire/lightning feel reversed). |
| Hide UI | Press **H** (clean frame for recording). |
| Mute | Press **M**. |

## How it works

- **MediaPipe Hands** tracks 21 points per hand at ~30fps and reports which hand is left/right.
- **Palm center** and **finger openness** are computed each frame to drive the effects.
- **Canvas 2D** with additive blending (`globalCompositeOperation = 'lighter'`) creates the glow; particles handle fire/embers/sparks, and jagged polylines with shadow-blur make the lightning.
- **Clap** is detected when both palms rush together quickly; it spawns an expanding chromatic ring + CSS screen shake/flash + a synthesized WebAudio boom.

## Files
- `jarvis-ui.html` / `jarvis-ui.css` / `jarvis-ui.js` — **Jarvis UI mode**: hidden-camera control, voice commands (Web Speech API) + TTS, reactor-orb UI, effects on dark background
- `index.html` — layout, HUD, start gate, CDN scripts
- `styles.css` — cinematic dark theme, HUD, shockwave shake/flash
- `app.js` — hand tracking, particle engine, clap detection, SFX

## Reel tip
Do it in one unbroken take and caption it *"100% real-time, no editing."* That's the real flex.
