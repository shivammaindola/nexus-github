/* ============================================================
   J.A.R.V.I.S. — ADB screenshot bridge (Android)
   A tiny local helper the browser app can call to grab silent,
   pixel-perfect phone screenshots via ADB. No screen-share prompt.

   Run:  node adb-bridge.js       (needs `adb` on PATH + a device
   with USB debugging enabled and authorised)

   Endpoints (CORS enabled so the Jarvis page can fetch them):
     GET /health      -> { ok, adb, devices }
     GET /screenshot  -> image/png of the current phone screen
   ============================================================ */
const http = require('http');
const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.ADB_BRIDGE_PORT || 8788;
const SAVED = path.join(__dirname, '.adb-wireless'); // remembers the last wireless address

/* ---- CLI helpers for WIRELESS debugging (Android 11+) ----
   Pair once, then connect (address is remembered for next time):
     node adb-bridge.cjs pair 192.168.1.7:41234 123456
     node adb-bridge.cjs connect 192.168.1.7:39000
     node adb-bridge.cjs                 # auto-reconnects the saved address
*/
function runSync(cmd, a) {
  try { return execFileSync(cmd, a, { encoding: 'utf8' }); }
  catch (e) { return (e.stdout || '') + (e.stderr || e.message || ''); }
}

const args = process.argv.slice(2);
if (args[0] === 'pair') {
  if (!args[1] || !args[2]) { console.log('Usage: node adb-bridge.cjs pair <ip:pairPort> <6-digit-code>'); process.exit(1); }
  console.log('Pairing…\n' + runSync('adb', ['pair', args[1], args[2]]));
  console.log('If it said "Successfully paired", now run:  node adb-bridge.cjs connect <ip:port>');
  process.exit(0);
}

let connectAddr = null;
if (args[0] === 'connect' && args[1]) connectAddr = args[1];
else if (fs.existsSync(SAVED)) { try { connectAddr = fs.readFileSync(SAVED, 'utf8').trim(); } catch (e) {} }
if (connectAddr) {
  console.log('Connecting to ' + connectAddr + ' …\n' + runSync('adb', ['connect', connectAddr]));
  try { fs.writeFileSync(SAVED, connectAddr); } catch (e) {}
}

/* ---- auto-reconnect ----
   Android re-randomises the wireless-debugging port every time it is toggled,
   so whenever no device is attached we (a) retry the last known address and
   (b) ask adb's mDNS for the phone's current one. The moment you switch
   Wireless debugging back on, the bridge reconnects by itself. */
let announced = false;
function autoReconnect() {
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
    if (out.split('\n').slice(1).some((l) => l.includes('\tdevice'))) {
      if (!announced) { console.log('[adb-bridge] device connected ✓'); announced = true; }
      return;
    }
    announced = false;
    // 1) discover the current address over mDNS
    let svc = '';
    try { svc = execFileSync('adb', ['mdns', 'services'], { encoding: 'utf8' }); } catch (e) {}
    const hit = svc.split('\n').find((l) => l.includes('_adb-tls-connect'));
    if (hit) {
      const addr = (hit.trim().split(/\s+/).pop() || '').trim();
      if (addr && /:\d+$/.test(addr)) {
        const r = runSync('adb', ['connect', addr]);
        if (/connected/i.test(r)) {
          console.log('[adb-bridge] reconnected via mDNS ->', addr);
          try { fs.writeFileSync(SAVED, addr); } catch (e) {}
          return;
        }
      }
    }
    // 2) fall back to the last known address
    if (connectAddr) { try { execFileSync('adb', ['connect', connectAddr], { encoding: 'utf8' }); } catch (e) {} }
  } catch (e) { /* adb missing — /health will report it */ }
}
setInterval(autoReconnect, 4000);
autoReconnect();

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
}

// Returns the serial of the first authorised device, or null.
function allDevices() {
  try {
    const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
    return out.split('\n').slice(1)
      .filter((l) => l.includes('\tdevice'))
      .map((l) => l.split('\t')[0].trim())
      .filter(Boolean);
  } catch (e) { return []; }
}
function firstDevice() { return allDevices()[0] || null; }

// Capture from ONE specific device.
function captureFrom(serial) {
  return new Promise((resolve, reject) => {
    const argv = serial ? ['-s', serial, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
    const chunks = [], errs = [];
    let p;
    try { p = spawn('adb', argv); }
    catch (e) { return reject(new Error('adb not found on PATH')); }
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => errs.push(d));
    p.on('error', (e) => reject(new Error('adb not found on PATH: ' + e.message)));
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < 1000) return reject(new Error(Buffer.concat(errs).toString().trim() || 'empty capture'));
      resolve(buf);
    });
  });
}

// A phone can be listed on several transports (e.g. IP + mDNS) where some are
// stale and return an EMPTY image. Try each until one gives a real screenshot,
// then remember the good one.
let goodSerial = null;
async function adbScreencap() {
  const devices = allDevices();
  if (!devices.length) throw new Error('no device (is the phone connected & authorised?)');
  const order = goodSerial && devices.includes(goodSerial)
    ? [goodSerial, ...devices.filter((d) => d !== goodSerial)]
    : devices;
  let lastErr = 'empty capture';
  for (const serial of order) {
    try {
      const buf = await captureFrom(serial);
      if (goodSerial !== serial) console.log('[adb-bridge] capturing from', serial);
      goodSerial = serial;
      return buf;
    } catch (e) { lastErr = e.message; }
  }
  goodSerial = null;
  throw new Error(lastErr + ' (tried: ' + order.join(', ') + ')');
}

function deviceCount() {
  return new Promise((resolve) => {
    execFile('adb', ['devices'], (err, stdout) => {
      if (err) return resolve({ adb: false, devices: 0 });
      const n = stdout.split('\n').slice(1).filter((l) => l.includes('\tdevice')).length;
      resolve({ adb: true, devices: n });
    });
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = (req.url || '').split('?')[0];

  if (url === '/health') {
    const info = await deviceCount();
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(200);
    return res.end(JSON.stringify({ ok: info.adb && info.devices > 0, ...info }));
  }

  if (url === '/screenshot') {
    try {
      const png = await adbScreencap();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(200);
      return res.end(png);
    } catch (e) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(500);
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.log(`\n♟  ADB bridge running:  http://localhost:${PORT}`);
  console.log('   GET /screenshot  ·  GET /health');
  console.log('   (Phone must have USB debugging ON and be authorised.)\n');
});
