// zaney.daw multiplayer server — with autosave + voice-chat signaling
// setup:  npm install     then:  node server.js
// friends open  http://<your-ip>:8787  (voice chat needs https or localhost —
// use a tunnel like ngrok, or Tailscale + serve over https, for remote homies)
const http = require('http');
const fs = require('fs');
const path = require('path');
let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); }
catch { console.error('missing dependency — run:  npm install ws'); process.exit(1); }

const PORT = process.env.PORT || 8787;
const CLIENT_FILE = path.join(__dirname, 'zaney-daw-online.html');
const WORLD_FILE = path.join(__dirname, 'world.json');
const SAVE_INTERVAL = 10000; // autosave every 10s when something changed

const CHUNK_NAMES = ['robot lab','aquamarine','carpet','midnight','neon garden','glass city','dust bowl','signal hill','low tide','static field'];
const CHUNK_COLORS = ['#4df3ff','#ff4d6d','#9be76a','#ffd84d','#e07be0','#5affc3','#ff9a4d','#b04dff'];
const PLAYER_COLORS = ['#ffd23d','#ff6b9d','#6bffb8','#6b9dff','#ff9d6b','#d36bff','#9dff6b','#ff8a8a'];

// ---------- authoritative world state ----------
let state = { bpm: 120, swing: 0, chunkSeq: 0, chunks: [] };
let samples = [];   // { name, mime, data(b64) } shared by players

function addChunk(cx, cz){
  const c = { id: state.chunkSeq,
              name: CHUNK_NAMES[state.chunkSeq % CHUNK_NAMES.length],
              cx, cz,
              color: CHUNK_COLORS[state.chunkSeq % CHUNK_COLORS.length],
              blocks: {} };
  state.chunkSeq++;
  state.chunks.push(c);
  return c;
}
function chunkById(id){ return state.chunks.find(c => c.id === id); }

// ---------- persistence (autosave) ----------
let dirty = false;
function markDirty(){ dirty = true; }
function saveWorld(){
  try {
    const tmp = WORLD_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), state, samples }));
    fs.renameSync(tmp, WORLD_FILE);   // atomic swap — no corrupt saves
    console.log('  world autosaved → ' + path.basename(WORLD_FILE) +
                ' (' + state.chunks.length + ' chunks, ' + samples.length + ' samples)');
  } catch (e){ console.error('  autosave failed:', e.message); }
}
function loadWorld(){
  try {
    if (!fs.existsSync(WORLD_FILE)) return false;
    const d = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    if (d.state && Array.isArray(d.state.chunks)){
      state = d.state;
      samples = Array.isArray(d.samples) ? d.samples : [];
      console.log('  world restored from disk (saved ' + (d.savedAt || '?') + ', ' +
                  state.chunks.length + ' chunks)');
      return true;
    }
  } catch (e){ console.error('  could not load world.json:', e.message); }
  return false;
}
if (!loadWorld()) addChunk(0, 0);
setInterval(() => { if (dirty){ dirty = false; saveWorld(); } }, SAVE_INTERVAL);
function shutdown(){
  if (dirty) saveWorld();
  console.log('bye');
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------- http: serve the client ----------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index') || req.url.startsWith('/zaney'))){
    fs.readFile(CLIENT_FILE, (err, data) => {
      if (err){ res.writeHead(500); res.end('put zaney-daw-online.html next to server.js'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
  } else { res.writeHead(404); res.end(); }
});

// ---------- websocket sync + voice signaling ----------
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });
let playerSeq = 0;
const players = new Map();  // ws -> { id, name, color, x, z, voice }

function bcast(o, except){
  const s = JSON.stringify(o);
  for (const ws of players.keys())
    if (ws !== except && ws.readyState === 1) ws.send(s);
}
function sendTo(id, o){
  const s = JSON.stringify(o);
  for (const [ws, q] of players)
    if (q.id === id && ws.readyState === 1){ ws.send(s); return true; }
  return false;
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = players.get(ws);

    if (m.t === 'hello'){
      if (p) return;
      const me = { id: playerSeq++,
                   name: String(m.name || 'player').slice(0, 16),
                   color: PLAYER_COLORS[playerSeq % PLAYER_COLORS.length],
                   x: 8, z: 8, voice: false };
      players.set(ws, me);
      ws.send(JSON.stringify({ t: 'init', id: me.id, state, samples,
        players: [...players.values()].filter(q => q.id !== me.id) }));
      bcast({ t: 'join', ...me }, ws);
      console.log('+ ' + me.name + '  (' + players.size + ' online)');
      return;
    }
    if (!p) return;

    switch (m.t){
      case 'pos':
        if (typeof m.x !== 'number' || typeof m.z !== 'number') break;
        p.x = m.x; p.z = m.z;
        bcast({ t: 'pos', id: p.id, x: m.x, z: m.z, name: p.name, color: p.color }, ws);
        break;
      case 'place': {
        const c = chunkById(m.chunkId);
        if (c && m.k && m.block && !c.blocks[m.k]){ c.blocks[m.k] = m.block; bcast(m, ws); markDirty(); }
        break;
      }
      case 'del': {
        const c = chunkById(m.chunkId);
        if (c && c.blocks[m.k]){ delete c.blocks[m.k]; bcast(m, ws); markDirty(); }
        break;
      }
      case 'upd': {
        const c = chunkById(m.chunkId);
        if (c && c.blocks[m.k] && m.block){ Object.assign(c.blocks[m.k], m.block); bcast(m, ws); markDirty(); }
        break;
      }
      case 'chunk': {
        if (typeof m.cx !== 'number' || typeof m.cz !== 'number') break;
        if (state.chunks.find(c => c.cx === m.cx && c.cz === m.cz)) break;
        const c = addChunk(m.cx, m.cz);
        bcast({ t: 'chunk', chunk: c });          // everyone, including requester
        markDirty();
        break;
      }
      case 'clear': {
        const c = chunkById(m.chunkId);
        if (c){ c.blocks = {}; bcast(m, ws); markDirty(); }
        break;
      }
      case 'set':
        if (m.bpm) state.bpm = Math.max(60, Math.min(180, +m.bpm));
        if (m.swing !== undefined) state.swing = Math.max(0, Math.min(60, +m.swing));
        bcast({ t: 'set', bpm: state.bpm, swing: state.swing }, ws);
        markDirty();
        break;
      case 'sample':
        if (typeof m.data === 'string' && m.data.length < 6 * 1024 * 1024 && samples.length < 40){
          samples.push({ name: String(m.name || 'sample').slice(0, 20), mime: m.mime, data: m.data });
          bcast(m, ws);
          markDirty();
          console.log('  shared sample: ' + m.name);
        }
        break;
      case 'load':
        if (m.state && Array.isArray(m.state.chunks)){
          state.bpm = m.state.bpm || 120;
          state.swing = m.state.swing || 0;
          state.chunks = m.state.chunks;
          state.chunkSeq = Math.max(1, ...state.chunks.map(c => (c.id || 0) + 1));
          bcast(m, ws);
          markDirty();
          console.log('  ' + p.name + ' loaded a map (' + state.chunks.length + ' chunks)');
        }
        break;
      case 'chat':
        bcast({ t: 'chat', name: p.name, color: p.color, msg: String(m.msg || '').slice(0, 140) });
        break;

      // ---- voice chat signaling ----
      case 'voice-join':
        p.voice = true;
        ws.send(JSON.stringify({ t: 'voice-members',
          ids: [...players.values()].filter(q => q.voice && q.id !== p.id).map(q => q.id) }));
        bcast({ t: 'voice-join', id: p.id, name: p.name }, ws);
        console.log('  ' + p.name + ' joined voice');
        break;
      case 'voice-leave':
        p.voice = false;
        bcast({ t: 'voice-leave', id: p.id, name: p.name }, ws);
        break;
      case 'rtc':
        // relay offer / answer / ice between two peers — server never sees audio
        if (typeof m.to === 'number' && ['offer','answer','ice'].includes(m.kind))
          sendTo(m.to, { t: 'rtc', from: p.id, kind: m.kind, data: m.data });
        break;
    }
  });
  ws.on('close', () => {
    const p = players.get(ws);
    if (p){
      players.delete(ws);
      if (p.voice) bcast({ t: 'voice-leave', id: p.id, name: p.name });
      bcast({ t: 'leave', id: p.id, name: p.name });
      console.log('- ' + p.name + '  (' + players.size + ' online)');
    }
  });
});

server.listen(PORT, () => {
  console.log('zaney.daw multiplayer server');
  console.log('  local:   http://localhost:' + PORT);
  console.log('  friends: http://<your-LAN-ip>:' + PORT + '  (voice needs https or localhost)');
  console.log('  world:   autosaves to world.json every ' + (SAVE_INTERVAL/1000) + 's when changed');
});
