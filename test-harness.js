// zaney.daw headless test harness
// usage: node test-harness.js <client.html>
// Executes the full client script with stubbed DOM + THREE + WebAudio and
// asserts every control is wired, then simulates the real user path.
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  .filter(s => s.length < 100000);   // skip vendored three.min.js

class FakeEl {
  constructor(tag='div'){ this.tagName=(tag||'div').toUpperCase(); this.style={}; this.children=[];
    this.dataset={}; this._cls=new Set(); this.value=''; this.textContent=''; this._html=''; }
  set innerHTML(v){ this._html=v; if (v==='') this.children=[]; }
  get innerHTML(){ return this._html; }
  set className(v){ this._cls=new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className(){ return [...this._cls].join(' '); }
  get classList(){ const s=this._cls; return { add:c=>s.add(c), remove:c=>s.delete(c),
    toggle:(c,f)=>{ (f===undefined? !s.has(c):f) ? s.add(c):s.delete(c); }, contains:c=>s.has(c) }; }
  appendChild(c){ this.children.push(c); return c; }
  removeChild(c){ this.children=this.children.filter(x=>x!==c); }
  get firstChild(){ return this.children[0]||null; }
  querySelector(){ return new FakeEl('q'); }
  querySelectorAll(){ return this.children.slice(); }
  addEventListener(){} removeEventListener(){} remove(){} click(){} focus(){} blur(){}
  getContext(){ return new Proxy({}, { get:(t,p)=> p==='measureText' ? (()=>({width:10})) : (()=>{}), set:()=>true }); }
}
const byId = new Map();
const LISTENERS = {};
const document = {
  getElementById(id){ if (!byId.has(id)) byId.set(id, new FakeEl('div')); return byId.get(id); },
  createElement(tag){ return new FakeEl(tag); },
  querySelectorAll(sel){ const m = sel.match(/^#([\w-]+)/); if (m && byId.has(m[1])) return byId.get(m[1]).children.slice(); return []; },
  addEventListener(type, fn){ (LISTENERS[type] = LISTENERS[type] || []).push(fn); },
  body: new FakeEl('body'),
};

class V3 { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  lerp(v,a){this.x+=(v.x-this.x)*a;this.y+=(v.y-this.y)*a;this.z+=(v.z-this.z)*a;return this;}
  addVectors(a,b){this.x=a.x+b.x;this.y=a.y+b.y;this.z=a.z+b.z;return this;}
  multiplyScalar(s){this.x*=s;this.y*=s;this.z*=s;return this;}
  normalize(){const l=Math.hypot(this.x,this.y,this.z)||1;return this.multiplyScalar(1/l);} }
class Col { set(){return this;} multiplyScalar(){return this;} }
class Mat { constructor(o={}){ Object.assign(this,o); this.color=new Col(); this.emissive=new Col(); this.emissiveIntensity=0; }
  clone(){ return new Mat(); } dispose(){} }
class O3 { constructor(){ this.position=new V3(); this.rotation=new V3(); this.scale=new V3(1,1,1);
    this.children=[]; this.userData={}; this.visible=true; this.intensity=1; }
  add(...c){ this.children.push(...c); } remove(){} lookAt(){} }
class Mesh extends O3 { constructor(geo,mat){ super(); this.geometry=geo; this.material=mat||new Mat(); } }
const THREE = {
  Scene: class extends O3 {}, Group: class extends O3 {}, Mesh,
  Sprite: class extends O3 { constructor(m){ super(); this.material=m; } },
  PerspectiveCamera: class extends O3 { constructor(){ super(); this.aspect=1; } updateProjectionMatrix(){} },
  WebGLRenderer: class { constructor(){ this.domElement=new FakeEl('canvas'); } setPixelRatio(){} setSize(){} render(){} },
  AmbientLight: class extends O3 {}, DirectionalLight: class extends O3 {},
  BufferGeometry: class { setAttribute(){} }, Float32BufferAttribute: class {},
  Points: class extends O3 {}, PointsMaterial: Mat,
  CanvasTexture: class { constructor(){ this.anisotropy=0; } },
  PlaneGeometry: class {}, BoxGeometry: class {}, RingGeometry: class {},
  MeshBasicMaterial: Mat, MeshLambertMaterial: Mat, SpriteMaterial: Mat, LineBasicMaterial: Mat,
  Color: Col, Fog: class { constructor(c,n,f){ this.color=new Col(); this.near=n; this.far=f; } },
  Vector2: class { constructor(){this.x=0;this.y=0;} }, Vector3: V3,
  Raycaster: class { setFromCamera(){} intersectObjects(){ return []; } },
  Clock: class { getDelta(){ return 0.016; } },
};

const param = () => ({ value:0, setValueAtTime(){}, linearRampToValueAtTime(){},
  exponentialRampToValueAtTime(){}, cancelScheduledValues(){} });
const audioNode = () => ({ connect(){}, start(){}, stop(){}, gain:param(), frequency:param(),
  detune:param(), pan:param(), Q:param(), playbackRate:param(), buffer:null, type:'', loop:false });
class FakeAC {
  constructor(){ this.sampleRate = 44100; this.destination = {}; this.state = 'running'; this.currentTime = 0; }
  createGain(){ return audioNode(); }
  createOscillator(){ return audioNode(); }
  createBufferSource(){ return audioNode(); }
  createBiquadFilter(){ return audioNode(); }
  createConvolver(){ return audioNode(); }
  createStereoPanner(){ return audioNode(); }
  createBuffer(ch, len, sr){ return { numberOfChannels:ch, length:len, sampleRate:sr,
    getChannelData(){ return new Float32Array(len); } }; }
  decodeAudioData(){ return Promise.resolve(this.createBuffer(2, 44100, 44100)); }
  resume(){ return Promise.resolve(); }
}

const sandbox = {
  document, THREE, console,
  innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
  addEventListener(type, fn){ (LISTENERS[type] = LISTENERS[type] || []).push(fn); },
  removeEventListener(){},
  requestAnimationFrame(){ return 1; },
  performance, URLSearchParams,
  location: { search:'', protocol:'file:', host:'' },
  setTimeout(){ return 0; }, clearTimeout(){}, setInterval(){ return 0; }, clearInterval(){},
  WebSocket: class { constructor(){ this.readyState = 0; } send(){} close(){} },
  navigator: { mediaDevices: {} },
  atob: s=>Buffer.from(s,'base64').toString('binary'),
  btoa: s=>Buffer.from(s,'binary').toString('base64'),
  Blob: class {}, FileReader: class { readAsText(){} },
  URL: { createObjectURL: ()=>'blob:', revokeObjectURL(){} },
  AudioContext: FakeAC, OfflineAudioContext: FakeAC,
  Map, Set,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// seed static-HTML button groups the scripts wire via querySelectorAll
['stars','sea','grass','sky'].forEach(n => {
  const b = new FakeEl('button'); b.dataset.th = n; b.textContent = n.toUpperCase();
  if (n === 'stars') b._cls.add('active');
  document.getElementById('themePick').appendChild(b);
});
['1','2','4','8'].forEach(n => {
  const b = new FakeEl('button'); b.dataset.b = n; b.textContent = n;
  if (n === '4') b._cls.add('active');
  document.getElementById('barsPick').appendChild(b);
});
['one','loop'].forEach(m => {
  const b = new FakeEl('button'); b.dataset.m = m;
  document.getElementById('modePick').appendChild(b);
});

let failed = false;
for (const s of scripts){
  try { vm.runInContext(s, sandbox, { timeout: 10000 }); }
  catch (e){ console.error('LOAD CRASH:', e.stack.split('\n').slice(0,4).join('\n')); failed = true; }
}
if (failed) process.exit(1);

const g = id => byId.get(id);
const A = (cond, msg) => { if (!cond){ console.error('ASSERT FAIL: ' + msg); failed = true; } };

A(typeof g('playBtn').onclick === 'function', 'PLAY wired');
A(typeof g('clearBtn').onclick === 'function', 'CLR wired');
A(typeof g('bpm').oninput === 'function', 'BPM wired');
A(typeof g('edPitch').oninput === 'function', 'editor pitch wired');
A(g('buses').children.length === 4, 'bus rows built');
A(g('packTabs').children.length === 6, 'pack tabs built');
A(g('palette').children.length === 5, 'DRUMS palette populated');
A(g('palette').children.every(b => b.draggable === true), 'pads draggable');
A(typeof g('newChunkBtn').onclick === 'function', 'generate chunk wired');
A(typeof g('stemsBtn').onclick === 'function', 'stems wired');

g('bpm').value = '140'; g('bpm').oninput();
A(g('bpmVal').textContent == 140, 'BPM handler updates display');

const tab = n => g('packTabs').children.find(t => t.textContent === n);
tab('SYNTH').onclick();
A(g('palette').children.length === 9, 'SYNTH pack 9 pads');
tab('AMBIENT').onclick();
A(g('palette').children.length === 6, 'AMBIENT pack 6 pads');
tab('FX').onclick();
A(g('palette').children.length === 4, 'FX pack 4 pads');

// keyboard focus guard
const kd = LISTENERS['keydown'] || [];
A(kd.length >= 1, 'global keydown registered');
const fire = evt => kd.forEach(fn => { try { fn(evt); } catch(e){ console.error('keydown crash:', e.message); failed = true; } });
let rangeBlurred = false;
fire({ key:'w', code:'KeyW', target:{ tagName:'INPUT', type:'range', blur(){ rangeBlurred = true; } }, preventDefault(){} });
A(rangeBlurred, 'W blurs focused slider');
let textBlurred = false;
fire({ key:'w', code:'KeyW', target:{ tagName:'INPUT', type:'text', blur(){ textBlurred = true; } }, preventDefault(){} });
A(!textBlurred, 'text inputs keep keys');
A((LISTENERS['click'] || []).length >= 1, 'button blur guard registered');

// themes
A(g('themePick').children.length === 4, 'theme picker has 4 backdrops');
const th = n => g('themePick').children.find(b => b.dataset.th === n);
try { th('sea').onclick(); th('grass').onclick(); th('sky').onclick(); th('stars').onclick(); }
catch(e){ console.error('theme switch crashed:', e.message); failed = true; }
A(th('stars')._cls.has('active') && !th('sea')._cls.has('active'), 'theme switching updates state');

// channel rack
A(typeof g('rackBtn').onclick === 'function', 'RACK button wired');
try { g('rackBtn').onclick(); } catch(e){ console.error('RACK open crashed:', e.message); failed = true; }
A(g('rack').style.display === 'flex', 'rack opens');
A(g('rackBody').children.length === 4, 'default 4 channels');
const row0 = g('rackBody').children[0];
A(row0.children[1].children.length === 64, '4-bar grid = 64 steps');
const cell5 = row0.children[1].children[5];
try { cell5.onmousedown({ preventDefault(){}, button:0 }); } catch(e){ console.error('cell toggle crashed:', e.message); failed = true; }
A(cell5._cls.has('on'), 'step cell toggles on');
const b8 = g('barsPick').children.find(b => b.dataset.b === '8');
try { b8.onclick(); } catch(e){ console.error('bars switch crashed:', e.message); failed = true; }
A(g('rackBody').children[0].children[1].children.length === 128, '8-bar grid = 128 steps');
A(b8._cls.has('active'), 'bars selector updates');
A(g('rackBody').children[0].children[1].children[5]._cls.has('on'), 'painted steps survive bar-length change');
try { g('rackAdd').onclick(); } catch(e){ console.error('add channel crashed:', e.message); failed = true; }
A(g('rackBody').children.length === 5, 'add channel works');

// rack terrain visualization: toggled step 5 must exist as a slab in the world
A(sandbox.rackVisGroups instanceof Map, 'rack visual registry exists');
const rv0 = sandbox.rackVisGroups.get(0);
A(!!rv0, 'active chunk has a rack visual group');
A(rv0 && rv0.index.has(5), 'painted step 5 materialized on the terrain');
A(rv0 && rv0.index.get(5)[0].scale.y > 0, 'slab mesh has geometry');

// ENTER → MET → PLAY → STOP user path
A(typeof g('enterBtn').onclick === 'function', 'ENTER wired early');
try { g('enterBtn').onclick(); } catch(e){ console.error('ENTER crashed:', e.message); failed = true; }
A(g('splash').style.display === 'none', 'ENTER hides splash');
A(typeof sandbox.window.__zaneyEnter === 'function', 'audio-unlock hook installed');

A(typeof g('metBtn').onclick === 'function', 'metronome wired');
try { g('metBtn').onclick.call(g('metBtn')); } catch(e){ console.error('MET crashed:', e.message); failed = true; }
A(g('metBtn')._cls.has('active'), 'metronome toggles on');

try { g('playBtn').onclick(); } catch(e){ console.error('PLAY crashed:', e.message); failed = true; }
A(String(g('playBtn').innerHTML).includes('STOP'), 'PLAY starts transport (rack + metronome active)');
try { g('playBtn').onclick(); } catch(e){ console.error('STOP crashed:', e.message); failed = true; }
A(String(g('playBtn').innerHTML).includes('PLAY'), 'STOP returns to PLAY');

if (failed) process.exit(1);
console.log('HARNESS_PASS ' + file.split('/').pop());
