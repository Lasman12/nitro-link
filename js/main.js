// NITRO LINK – הקובץ הראשי: רינדור, לולאת המשחק, מצלמה, HUD, לובי ומוסך
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CarPhysics, CarVisual, carShape, addForce, P as CP, DEFAULT_SKIN, SKIN_OPTS, G_CAR, G_REMOTE } from './car.js?v=1794770732';
import { buildLevel, CHAIN_LEN, RACE_LEVELS, CHAIN_LEVELS, VS_MAPS, BATTLE_MAPS, VS_CATS, MINI_CATS, vsSplit, miniSplit, mapInfo, trackShape } from './level.js?v=1794770732';
import { WRAPS, GRADS, FEATHERS, TRAILS, HORNS, ROAD, SHOP, SOURCE, itemName, itemSwatch } from './items.js?v=1794770732';
import { Account, rankOf, AuthError } from './account.js?v=1794770732';
import { Sky, Particles, ChainVisual, tex } from './fx.js?v=1794770732';
import { Net } from './net.js?v=1794770732';
import { Input } from './input.js?v=1794770732';
import { Sfx } from './audio.js?v=1794770732';
import { Bot, BOT_NAMES, botSkin } from './bot.js?v=1794770732';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem('nl_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nl_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const fmt = (ms) => {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

const settings = { quality: store.get('quality', 'high'), sound: store.get('sound', true), music: store.get('music', true) };
const me = { name: store.get('name', ''), skin: { ...DEFAULT_SKIN, ...store.get('skin', {}) } };
me.uid = null;
const account = new Account();
const net = new Net();
const input = new Input();
const sfx = new Sfx(settings.sound, settings.music);
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) document.body.classList.add('touch');

// ---------- רינדור ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
// מפת סביבה להשתקפויות: שמי שקיעה + פסי תאורת אצטדיון (במקום חדר לבן ששורף את הצבע)
function makeEnv() {
  const s = new THREE.Scene();
  new Sky(s, 0x2b4fd0, 0xc98aff, 0x1a1a3a);
  const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.9).multiplyScalar(7) });
  for (const [x, y, z, ry] of [[-60, 45, 30, 1.1], [60, 45, 30, -1.1], [0, 50, -70, 0], [0, 30, 80, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(60, 5, 1), panel);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    s.add(m);
  }
  const gen = new THREE.PMREMGenerator(renderer);
  const t = gen.fromScene(s, 0.03, 0.1, 4000).texture;
  gen.dispose();
  return t;
}
const envTex = makeEnv();
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 3200);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
const renderPass = new RenderPass(new THREE.Scene(), camera);
const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.42, 0.5, 1.0);
composer.addPass(renderPass);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const w = Math.max(2, innerWidth), h = Math.max(2, innerHeight);
  const pr = Math.min(devicePixelRatio || 1, settings.quality === 'high' ? 2 : 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function render(scene) {
  if (settings.quality === 'high') { renderPass.scene = scene; composer.render(); } else renderer.render(scene, camera);
}

// ---------- אולם תצוגה (תפריט / לובי / מוסך) ----------
class Showroom {
  constructor() {
    const s = (this.scene = new THREE.Scene());
    s.environment = envTex;
    s.fog = new THREE.Fog(0x2a1a66, 40, 220);
    this.sky = new Sky(s);
    s.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a2a66, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 12, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 40 });
    s.add(sun);
    const fg = new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 80, uv.getY(i) * 80);
    const floor = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: tex.grid, color: 0x24418a, metalness: 0.5, roughness: 0.4 }));
    floor.receiveShadow = true;
    s.add(floor);
    this.cars = [];
    this.particles = new Particles(s);
    this.boost = false;
    this.pads = new THREE.Group();
    s.add(this.pads);
    this.t = 0;
  }

  setCars(list) {
    for (const c of this.cars) c.dispose();
    this.pads.clear();
    this.cars = list.map((p, i) => {
      const v = new CarVisual(p.skin, list.length > 1 ? p.name : null);
      const x = (i - (list.length - 1) / 2) * 4.2;
      v.group.position.set(x, 0.83, 0);
      this.scene.add(v.group);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.06, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(p.skin.glow || '#00e5ff').multiplyScalar(2.2) }));
      ring.position.set(x, 0.05, 0);
      this.pads.add(ring);
      return v;
    });
  }

  update(dt) {
    this.t += dt;
    const n = Math.max(1, this.cars.length), wide = camera.aspect > 1.15;
    this.cars.forEach((c, i) => { c.group.rotation.y = this.t * 0.45 + i * 0.7; c.update(0.25 * Math.sin(this.t), null, this.t * 2, !!this.boost, this.t); });
    if (this.boost && this.cars[0]) {
      // שובל לדוגמה, כדי שיראו את אפקט השובל
      const c = this.cars[0], col = trailCol(c, this.t);
      for (const sx of [-0.38, 0.38]) {
        _v.set(sx, -0.12, -2.4).applyQuaternion(c.group.quaternion).add(c.group.position);
        _v2.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, -9).applyQuaternion(c.group.quaternion);
        this.particles.emit(_v, _v2, col, 0.5);
      }
    }
    this.particles.update(dt);
    const R = (7.5 + n * 2.1) * (wide ? 1 : 1.5);
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.position.set(Math.sin(0.5) * R, 2.3 + n * 0.25, Math.cos(0.5) * R);
    const target = new THREE.Vector3(0, 0.6, 0);
    if (wide) target.add(new THREE.Vector3(Math.cos(0.5), 0, -Math.sin(0.5)).multiplyScalar(R * 0.3)); else target.y -= R * 0.22;
    camera.lookAt(target);
    this.sky.update(camera);
  }
}

// ---------- מכונית של שחקן אחר ----------
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

class Remote {
  constructor(game, pl) {
    this.id = pl.id; this.name = pl.name;
    this.vis = new CarVisual(pl.skin, pl.name);
    this.vis.group.visible = false;
    game.scene.add(this.vis.group);
    this.body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: game.carMat, collisionFilterGroup: G_REMOTE, collisionFilterMask: G_CAR });
    this.body.addShape(carShape(), new CANNON.Vec3(0, CP.boxY, 0));
    this.body.remote = this;
    this.lives = 3; this.kos = 0; this.out = 0; this.gone = false; this.inWorld = false;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.np = new THREE.Vector3(); this.nq = new THREE.Quaternion(); this.nv = new THREE.Vector3();
    this.attach = new THREE.Vector3();
    this.has = false; this.age = 0; this.cp = 0; this.prog = 0; this.fin = 0; this.boosting = false; this.spin = 0;
    this.supported = true; this.cv = new THREE.Vector3();
  }

  onState(d, game) {
    if (d[14] !== game.gid) return; // מצב שנשאר ממשחק קודם – מתעלמים
    this.np.set(d[0], d[1], d[2]);
    this.nq.set(d[3], d[4], d[5], d[6]).normalize();
    this.nv.set(d[7], d[8], d[9]);
    this.boosting = !!(d[10] & 1);
    this.supported = !(d[10] & 2);
    this.cp = this.lives = d[11]; this.prog = this.kos = d[12]; this.fin = this.out = d[13];
    this.gone = !!(d[10] & 4);
    this.age = 0;
    if (!this.has || this.pos.distanceTo(this.np) > 14) { this.pos.copy(this.np); this.quat.copy(this.nq); }
    this.has = true;
    this.vis.group.visible = !this.gone;
    if (this.gone === this.inWorld) { if (this.gone) game.world.removeBody(this.body); else game.world.addBody(this.body); this.inWorld = !this.gone; }
  }

  update(dt, t) {
    if (!this.has) return;
    this.age += dt;
    // חיזוי קדימה; כשהמכונית באוויר מוסיפים גם את כוח המשיכה, אחרת היא "נשארת מאחור" בנפילה
    const a = Math.min(this.age, 0.25), g = this.supported ? 0 : CP.gravity;
    this.cv.copy(this.nv); this.cv.y -= g * a;
    _v.copy(this.np).addScaledVector(this.nv, a); _v.y -= 0.5 * g * a * a;
    this.pos.addScaledVector(this.cv, dt).lerp(_v, 1 - Math.exp(-12 * dt));
    this.quat.slerp(this.nq, 1 - Math.exp(-12 * dt));
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.body.quaternion.set(this.quat.x, this.quat.y, this.quat.z, this.quat.w);
    this.body.velocity.set(this.nv.x, this.nv.y, this.nv.z);
    this.body.aabbNeedsUpdate = true;
    this.vis.group.position.copy(this.pos);
    this.vis.group.quaternion.copy(this.quat);
    this.attach.set(0, 0.3, 0).applyQuaternion(this.quat).add(this.pos);
    const vf = _v2.set(0, 0, 1).applyQuaternion(this.quat).dot(this.nv);
    this.spin += (vf / CP.radius) * dt;
    this.vis.update(0, null, this.spin, this.boosting, t);
  }

  dispose(game) {
    this.vis.dispose();
    if (this.inWorld) game.world.removeBody(this.body);
  }
}

// ---------- המשחק ----------
const H = 1 / 120;
const CHAIN_K = 6000, CHAIN_C = 900;
const ATT = new CANNON.Vec3(0, 0.3, 0), cr = new CANNON.Vec3(), cv = new CANNON.Vec3(), cf = new CANNON.Vec3();
const hud = {
  timer: $('#timer'), rank: $('#rank'), board: $('#board'), ring: $('#ring'), spd: $('#spd'),
  chain: $('#chainHud'), height: $('#height'), tension: $('#tension'), msg: $('#msg'), count: $('#countdown'),
  nitro: $('#nitro'), nitroFill: $('#nitroFill'), battle: $('#battleHud'), info: $('#info'), item: $('#item'),
};
let msgTimer = 0;
function banner(text, cls, ms = 2400) {
  const el = $('#banner');
  el.textContent = text;
  el.className = '';
  void el.offsetWidth; // מאתחל את האנימציה
  el.style.setProperty('--ms', ms + 'ms');
  el.className = cls + ' show';
}
function showMsg(text, ms = 1600) {
  hud.msg.textContent = text;
  hud.msg.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => hud.msg.classList.remove('show'), ms);
}

// תיבות הפתעה וחפצים
const ITEMS = [null, { n: '🚀 טורבו', use: 'טורבו!' }, { n: '🛡️ מגן', use: 'מגן פעיל' }, { n: '💥 גל הדף', use: 'גל הדף!' }, { n: '🛢️ כתם שמן', use: 'שמן על המסלול' }, { n: '⚡ ברק', use: 'ברק!' }];
const boxGeo = new THREE.BoxGeometry(1.7, 1.7, 1.7);
let boxTex = null;
function boxMat() {
  if (!boxTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 128, 128);
    gr.addColorStop(0, '#ff5ad1'); gr.addColorStop(0.5, '#ffd21a'); gr.addColorStop(1, '#19d3ff');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(4, 4, 120, 120);
    g.fillStyle = '#fff'; g.font = '900 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 64, 70);
    boxTex = new THREE.CanvasTexture(c);
    boxTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshBasicMaterial({ map: boxTex, color: new THREE.Color(1.5, 1.5, 1.5), transparent: true, opacity: 0.92 });
}

const EMOTES = ['👍', '😂', '😱', '🔥', '👋'];
// צבע השובל לפי האפקט שנבחר במוסך
const _tc = new THREE.Color();
function trailCol(vis, t) {
  const fx = vis.skin.tfx;
  if (fx === 1) return _tc.setHSL((t * 0.9) % 1, 1, 0.55);
  if (fx === 2) return _tc.set(Math.random() > 0.5 ? 0xffffff : 0xffc21a);
  if (fx === 3) return _tc.set(Math.random() > 0.5 ? 0xd8f8ff : 0x38b6ff);
  return vis.trailColor;
}

class Game {
  constructor(mode, level, startAt) {
    this.mode = mode; this.startAt = startAt; this.credit = null; this.teamTime = 0;
    this.isRace = mode === 'race' || mode === 'vs'; this.battle = mode === 'battle' || mode === 'mini';
    this.gid = Math.round(startAt) % 1000000;
    const scene = (this.scene = new THREE.Scene());
    scene.environment = envTex;
    const world = (this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -CP.gravity, 0) }));
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 8;
    const groundMat = new CANNON.Material('ground'), kinMat = new CANNON.Material('kin');
    this.carMat = new CANNON.Material('car');
    world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, groundMat, { friction: 0.03, restitution: 0.05 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, kinMat, { friction: 0.05, restitution: 0.3 }));
    world.addContactMaterial(new CANNON.ContactMaterial(this.carMat, this.carMat, { friction: 0.05, restitution: 0.35 }));

    this.level = buildLevel(mode, level, { scene, world, groundMat, kinMat, seed: Math.round(startAt) % 1000000, solo: net.players.filter((p) => !p.bot).length < 2 });
    this.lvl = this.level.level;
    const [top, mid, bot] = this.level.sky;
    this.sky = new Sky(scene, top, mid, bot);
    const look = this.level.look;
    scene.fog = new THREE.Fog(mid, 260, 1500);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3a80, look.hemi));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunI);
    this.sun.castShadow = settings.quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    const grid = new THREE.GridHelper(6000, 150, look.trimA, look.trimB);
    grid.position.y = this.level.killY - 30;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    scene.add(grid);

    this.car = new CarPhysics(world, this.carMat);
    this.vis = new CarVisual(me.skin);
    scene.add(this.vis.group);
    this.particles = new Particles(scene);
    this.remotes = new Map();
    this.chains = [];
    this.order = []; this.slot = 0; this.neighbors = [];
    this.cp = 0; this.fin = 0; this.teamDone = false; this.tension = 0;
    this.acc = 0; this.pendingJump = false; this.sendT = 0; this.hudT = 0; this.lastRs = 0; this.lastCount = 99; this.time = 0;
    this.prevP = new THREE.Vector3(); this.prevQ = new THREE.Quaternion();
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.phys = new THREE.Vector3();
    this.camYaw = 0; this.camPos = new THREE.Vector3(); this.fov = 62;
    this.carsPos = [];
    this.lives = 3; this.kos = 0; this.out = 0; this.gone = false; this.lastHitId = -1; this.lastHitT = -99; this.hitT = -99;
    this.spec = null; this.over = false; this.endIn = null; this.tRace = -9; this.floorY = 0; this.floorT = 0; this.focus = this.pos;
    // מיני גיימס: תופסת / כתר / רצפה נעלמת
    this.mini = mode === 'mini' ? ['tag', 'crown', 'floor'][Math.floor(this.lvl / 100)] : null;
    this.its = new Set(); this.tags = {}; this.tagT = {}; this.holder = -1; this.holdCd = 0; this.miniT = 0; this.noBoost = false; this.amIt = false; this.seenIt = false;
    if (this.mini === 'floor') this.lives = 1;
    if (this.mini === 'crown') {
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.25, emissive: 0xff9a1a, emissiveIntensity: 0.6 });
      this.crown = new THREE.Group();
      this.crown.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.8, 0.5, 14, 1, true), gold));
      for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), gold); c.position.set(Math.cos(i * 1.047) * 0.85, 0.5, Math.sin(i * 1.047) * 0.85); this.crown.add(c); }
      this.crown.children[0].material.side = THREE.DoubleSide;
      scene.add(this.crown);
    }
    hud.battle.className = this.mini ? 'mini' : '';
    if (this.battle) { this.car.regen = 16; this.addHit(this.car.body, this); }
    // "אני" בממשק של שחקן מרוחק – כדי שבוטים (ושרשרת) יתייחסו אליי כמו לכל מכונית אחרת
    const self = this, mb = this.car.body;
    this.meProxy = { id: net.myId, name: me.name, has: true, pos: this.phys, nv: mb.velocity, cv: mb.velocity, attach: new THREE.Vector3(),
      get gone() { return self.gone; }, get lives() { return self.lives; }, get supported() { return self.car.supported; }, get boosting() { return self.car.boosting; } };
    mb.remote = this.meProxy;
    this.bots = []; this.rings = []; this.shake = 0; this.cele = null;
    $('#banner').className = '';
    // קרח, הקפות ותיבות הפתעה
    this.car.grip = this.level.ice ? 0.3 : 1;
    this.laps = this.level.laps; this.lap = 0; this.item = 0; this.shieldT = 0; this.slipT = 0; this.oils = [];
    this.boxes = this.level.boxes.map((pos) => {
      const m = new THREE.Mesh(boxGeo, boxMat());
      m.position.copy(pos);
      scene.add(m);
      return { pos, mesh: m, cd: 0 };
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dd6ff).multiplyScalar(1.6), transparent: true, opacity: 0.22, depthWrite: false }));
    this.shield.visible = false;
    scene.add(this.shield);
    hud.item.classList.add('hidden');
    this.syncPlayers();
    this.respawn();
    hud.battle.classList.toggle('hidden', !this.battle);
    hud.info.textContent = '';
    sfx.musicStart(this.lvl * 3 + mode.length);
    hud.chain.classList.toggle('hidden', mode !== 'chain');
    hud.rank.classList.toggle('hidden', !this.isRace);
    $('#lvlTag').textContent = mode === 'vs' || this.battle ? mapInfo(mode, this.lvl).name : (mode === 'chain' ? 'שרשרת · ' : '') + 'שלב ' + this.lvl;
  }

  syncPlayers() {
    const ids = new Set(net.players.map((p) => p.id));
    for (const [id, r] of this.remotes) if (!ids.has(id)) { r.dispose(this); this.remotes.delete(id); }
    this.order = [...ids].sort((a, b) => a - b);
    for (const p of net.players) if (p.id !== net.myId && !this.remotes.has(p.id)) {
      // בוטים רצים אצל המארח; אצל שאר השחקנים הם נראים כמו כל שחקן מרוחק
      const r = p.bot && net.isHost ? new Bot(this, p) : new Remote(this, p);
      if (r.isBot && this.battle) this.addHit(r.body, r);
      this.remotes.set(p.id, r);
    }
    this.bots = [...this.remotes.values()].filter((r) => r.isBot);
    if (this.mini === 'floor') for (const r of this.remotes.values()) if (!r.has || r.isBot) r.lives = Math.min(r.lives, 1);
    if (this.bots.length) this.car.body.collisionFilterMask |= G_CAR;
    this.slot = Math.max(0, this.order.indexOf(net.myId));
    this.neighbors = [this.order[this.slot - 1], this.order[this.slot + 1]].filter((x) => x !== undefined);
    for (const c of this.chains) c.vis.dispose();
    this.chains = [];
    if (this.mode === 'chain') for (let i = 0; i + 1 < this.order.length; i++) this.chains.push({ a: this.order[i], b: this.order[i + 1], vis: new ChainVisual(this.scene, CHAIN_LEN) });
  }

  respawn(random) {
    const s = this.level.spawn(this.battle ? (random ? Math.random() * 6.28 : 0) : this.cp, this.slot, this.order.length);
    if (random) s.pos.y += 3;
    this.car.reset(s.pos, s.yaw);
    this.prevP.copy(s.pos);
    this.prevQ.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.yaw);
    this.camYaw = s.yaw;
    this.camPos.set(s.pos.x - Math.sin(s.yaw) * 9, s.pos.y + 3.4, s.pos.z - Math.cos(s.yaw) * 9);
  }

  teamRespawn(send) {
    const now = performance.now();
    if (now - this.lastRs < 1500) return;
    this.lastRs = now;
    if (send) net.sendEvent({ k: 'rs' });
    this.respawn();
    for (const b of this.bots) b.respawn(this);
    showMsg('חוזרים לנקודת הביקורת');
  }

  setGone(v) {
    if (this.gone === v) return;
    this.gone = v;
    this.vis.group.visible = !v;
    if (v) this.world.removeBody(this.car.body); else this.world.addBody(this.car.body);
  }

  fall() {
    sfx.fall();
    if (this.battle) {
      if (this.out || this.over || this.mini === 'tag' || this.mini === 'crown') { this.respawn(true); return; }
      this.lives--;
      const by = this.time - this.lastHitT < 6 ? this.lastHitId : -1;
      net.sendEvent({ k: 'ko', by });
      this.onKo(net.myId, by);
      this.lastHitT = -99;
      if (this.lives <= 0) { this.out = Math.max(1, Math.round(this.tRace * 1000)); this.setGone(true); showMsg('הודחת מהזירה!', 2500); } else { this.respawn(true); showMsg(`נפלת! נשארו ${this.lives} חיים`); }
      return;
    }
    if (this.mode === 'chain') this.teamRespawn(true); else this.respawn();
  }

  // נגיחה בקרב: מי שנכנס בי מהר מעיף אותי, ונרשם כמי שהפיל אותי אם אפול. self = אני או בוט
  addHit(b, self) {
    b.addEventListener('collide', (e) => {
      const r = e.body.remote;
      if (!r || r === self || this.time - self.hitT < 0.3) return;
      let nx = b.position.x - r.pos.x, nz = b.position.z - r.pos.z;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      const closing = (r.nv.x - b.velocity.x) * nx + (r.nv.z - b.velocity.z) * nz, theirs = r.nv.x * nx + r.nv.z * nz;
      if (closing < 4) return;
      self.hitT = this.time;
      if (theirs > 3) {
        const k = Math.min(26, theirs * (r.boosting ? 1.0 : 0.7));
        b.velocity.x += nx * k; b.velocity.z += nz * k; b.velocity.y += Math.min(7, k * 0.3);
        self.lastHitId = r.id; self.lastHitT = this.time;
      }
      if (self === this || r === this.meProxy) {
        sfx.hit();
        this.shake = Math.max(this.shake, Math.min(0.6, closing * 0.03));
        this.burst(_v.set((b.position.x + r.pos.x) / 2, b.position.y + 0.3, (b.position.z + r.pos.z) / 2), 16, 9, [0xffffff, 0xffd21a], 0.35);
      }
    });
  }

  botFall(b) {
    if (this.battle) {
      if (this.mini === 'tag' || this.mini === 'crown') { b.respawn(this, true); return; }
      if (b.out) return;
      if (this.over) { b.respawn(this, true); return; }
      const by = this.time - b.lastHitT < 6 ? b.lastHitId : -1;
      b.lastHitT = -99; b.lives--;
      net.sendEvent({ k: 'ko', by, who: b.id });
      this.onKo(b.id, by);
      if (b.lives <= 0) { b.out = Math.max(1, Math.round(this.tRace * 1000)); b.setGone(this, true); } else b.respawn(this, true);
    } else if (this.mode === 'chain') this.teamRespawn(true);
    else {
      // בוט שנכשל שלוש פעמים באותו קטע מדלג לנקודת הביקורת הבאה, כדי שלא ייתקע לנצח
      if (++b.fails >= 3 && b.cp < this.level.cps.length - 1) { b.cp++; b.fails = 0; }
      b.respawn(this);
    }
  }

  // נוקאאוט: מישהו עף מהזירה
  onKo(who, by) {
    const v = this.who(who), mine = who === net.myId, killer = this.who(by);
    if (killer && killer.isBot) killer.kos++;
    const at = mine ? this.phys : v && v.pos;
    if (at) this.boom(at);
    if (mine) banner('הועפת!', 'lose', 1500);
    else if (by === net.myId) { this.kos++; sfx.ko(); banner('K.O!', 'ko', 1700); }
    else showMsg(`${(v && v.name) || 'שחקן'} עף מהזירה${killer && killer.name ? ' – ' + killer.name : ''}`, 1500);
  }

  // ----- אפקטים: פיצוץ, גל הדף, קונפטי -----
  burst(at, n, speed, colors, life = 0.7) {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.8);
      _v2.set(Math.cos(a) * s * sp, Math.abs(u) * sp + 2, Math.sin(a) * s * sp);
      this.particles.emit(at, _v2, _tc.set(colors[i % colors.length]), life * (0.6 + Math.random() * 0.7), 2.4);
    }
  }
  boom(pos) {
    const at = new THREE.Vector3(pos.x, Math.max(pos.y, -3), pos.z);
    this.burst(at, 90, 22, [0xff5a1f, 0xffd21a, 0xffffff, 0xff2d1a], 0.9);
    for (const [col, k] of [[0xffb21a, 1], [0xffffff, 0.6]]) {
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 6, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.5), transparent: true, depthWrite: false }));
      mesh.position.copy(at);
      this.scene.add(mesh);
      this.rings.push({ mesh, t: 0, k });
    }
    this.shake = Math.max(this.shake, clamp(1.2 - at.distanceTo(this.pos) / 60, 0.15, 1));
    sfx.boom();
  }
  confetti(at, n) {
    const cols = [0xff2d55, 0xffd21a, 0x22d38a, 0x1e7bff, 0xb14dff, 0xffffff];
    for (let i = 0; i < n; i++) {
      _v.set(at.x + (Math.random() - 0.5) * 9, at.y + 4 + Math.random() * 4, at.z + (Math.random() - 0.5) * 9);
      _v2.set((Math.random() - 0.5) * 5, -2 - Math.random() * 4, (Math.random() - 0.5) * 5);
      this.particles.emit(_v, _v2, _tc.set(cols[Math.floor(Math.random() * cols.length)]), 1 + Math.random() * 0.8, 2.2);
    }
  }
  updateFx(dt) {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const s = 1 + r.t * 34 * r.k;
      r.mesh.scale.set(s, 1 + r.t * 3, s);
      r.mesh.material.opacity = Math.max(0, 1 - r.t / 0.7);
      if (r.t > 0.7) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); r.mesh.removeFromParent(); this.rings.splice(i, 1); }
    }
    if (this.cele) this.confetti(this.focus, 3);
  }

  onEvent(m) {
    if (m.k === 'rs' && this.mode === 'chain') this.teamRespawn(false);
    if (m.k === 'it') this.onItem(m);
    if (m.k === 'emo') this.remotes.get(m.from)?.vis.emote(EMOTES[m.i] || '👍');
    if (m.k === 'horn') sfx.horn(clamp(Math.round(m.h) || 1, 1, 4));
    if (m.k === 'ko' && this.battle) this.onKo(m.who ?? m.from, m.by);
    if (m.k === 'mn' && this.mini && m.from === 0) this.onMini(m);
  }

  emote(i) {
    if (!EMOTES[i]) return;
    this.vis.emote(EMOTES[i]);
    net.sendEvent({ k: 'emo', i });
  }

  // ----- חפצים מתיבות ההפתעה -----
  addOil(x, y, z, mine) {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.85 }));
    mesh.position.set(x, y + 0.06, z);
    this.scene.add(mesh);
    this.oils.push({ mesh, t: 14, safe: mine ? 1.2 : 0 });
  }
  useItem() {
    const it = this.item, b = this.car.body, p = b.position;
    if (!it || this.fin || this.gone) return;
    this.item = 0;
    hud.item.classList.add('hidden');
    sfx.pad();
    if (it === 1) { // טורבו
      const f = _v.set(0, 0, 1).applyQuaternion(_q.copy(b.quaternion));
      this.car.boost = 100;
      b.velocity.x += f.x * 16; b.velocity.z += f.z * 16;
    } else if (it === 2) this.shieldT = 7;
    else if (it === 3) net.sendEvent({ k: 'it', it, p: [p.x, p.y, p.z] });
    else if (it === 4) {
      const f = _v.set(0, 0, -3.5).applyQuaternion(_q.copy(b.quaternion));
      const o = [Math.round((p.x + f.x) * 10) / 10, Math.round((p.y - 0.75) * 10) / 10, Math.round((p.z + f.z) * 10) / 10];
      this.addOil(o[0], o[1], o[2], true);
      net.sendEvent({ k: 'it', it, p: o });
    } else if (it === 5) net.sendEvent({ k: 'it', it });
    showMsg(ITEMS[it].use, 1200);
  }
  onItem(m) {
    const b = this.car.body, who = this.remotes.get(m.from)?.name || 'שחקן';
    if (m.it === 4 && Array.isArray(m.p)) { this.addOil(+m.p[0] || 0, +m.p[1] || 0, +m.p[2] || 0, false); return; }
    if (this.gone || this.fin) return;
    if (this.shieldT > 0) { if (m.it === 5) showMsg('המגן חסם את הברק!', 1200); return; }
    if (m.it === 3 && Array.isArray(m.p)) {
      const dx = b.position.x - m.p[0], dz = b.position.z - m.p[2], d = Math.hypot(dx, dz);
      if (d > 18 || Math.abs(b.position.y - m.p[1]) > 6) return;
      const k = 22 * (1 - d / 24) / (d || 1);
      b.velocity.x += dx * k; b.velocity.z += dz * k; b.velocity.y += 6;
      sfx.hit(); showMsg(`גל הדף מ${who}!`, 1200);
    } else if (m.it === 5) {
      b.velocity.x *= 0.4; b.velocity.z *= 0.4; b.angularVelocity.y += 6;
      sfx.hit(); showMsg(`${who} הפעיל ברק!`, 1400);
    }
  }
  updateItems(dt, inp) {
    const p = this.phys, b = this.car.body, live = !this.gone && !this.fin;
    for (const bx of this.boxes) {
      bx.cd -= dt;
      bx.mesh.visible = bx.cd <= 0;
      bx.mesh.rotation.y += dt * 1.6; bx.mesh.rotation.x += dt * 0.9;
      if (bx.cd <= 0 && live && Math.hypot(p.x - bx.pos.x, p.z - bx.pos.z) < 2.6 && Math.abs(p.y - bx.pos.y) < 3) {
        bx.cd = 5;
        if (!this.item) {
          // מי שמוביל מקבל פחות חפצים חזקים
          const lead = this.standings()[0]?.me, r = Math.random();
          this.item = lead ? (r < 0.4 ? 1 : r < 0.7 ? 2 : 4) : r < 0.3 ? 1 : r < 0.48 ? 2 : r < 0.68 ? 3 : r < 0.86 ? 4 : 5;
          hud.item.innerHTML = `${ITEMS[this.item].n}<small>${isTouch ? 'הקישו לשימוש' : 'חץ מטה / LB'}</small>`;
          hud.item.classList.remove('hidden');
          sfx.coin();
        }
      }
    }
    if (input.item && live) this.useItem();
    this.shieldT -= dt;
    this.slipT -= dt;
    this.car.grip = this.slipT > 0 ? 0.04 : this.level.ice || this.level.onIce(this.phys) ? 0.3 : 1;
    this.shield.visible = this.shieldT > 0 && !this.gone;
    if (this.shield.visible) this.shield.position.copy(this.pos);
    for (let i = this.oils.length - 1; i >= 0; i--) {
      const o = this.oils[i];
      o.t -= dt; o.safe -= dt;
      let hit = false;
      if (live && o.safe <= 0 && this.shieldT <= 0 && this.car.supported && Math.hypot(p.x - o.mesh.position.x, p.z - o.mesh.position.z) < 2.9 && Math.abs(p.y - o.mesh.position.y) < 1.8) {
        hit = true;
        b.angularVelocity.y += (Math.random() > 0.5 ? 1 : -1) * 12;
        b.velocity.x *= 0.6; b.velocity.z *= 0.6;
        this.slipT = 1.3; // בלי אחיזה לרגע – המכונית מסתחררת
        sfx.fall(); showMsg('החלקת על שמן!', 1200);
      }
      if (hit || o.t <= 0) { o.mesh.geometry.dispose(); o.mesh.material.dispose(); o.mesh.removeFromParent(); this.oils.splice(i, 1); }
    }
  }

  // ----- מיני גיימס: תופסת ותפוס את הכתר. המארח קובע מי התופסים ואצל מי הכתר, ומשדר לכולם -----
  updateMini(dt, tRace) {
    const all = [this.meProxy, ...this.remotes.values()].filter((o) => o.has && !o.gone);
    const near = (a, c, d) => Math.hypot(a.pos.x - c.pos.x, a.pos.z - c.pos.z) < d && Math.abs(a.pos.y - c.pos.y) < 2.6;
    if (net.isHost && tRace > 0 && !this.over) {
      let changed = false;
      if (this.mini === 'tag') {
        if (!this.its.size) { this.its.add(this.order[Math.floor(Math.random() * this.order.length)]); changed = true; }
        // נגיעה של תופס מדביקה; גם מי שנופל מהזירה נתפס
        if (tRace > 5) for (const c of all) {
          if (this.its.has(c.id)) continue;
          let by = c.pos.y < -5 ? -1 : null;
          if (by === null) for (const t of all) if (this.its.has(t.id) && this.time - (this.tagT[t.id] || -9) > 1.2 && near(t, c, 3.8)) { by = t.id; break; }
          if (by === null) continue;
          this.its.add(c.id); this.tagT[c.id] = this.time; changed = true;
          if (by !== -1) this.tags[by] = (this.tags[by] || 0) + 1;
        }
      } else {
        this.holdCd -= dt;
        const C = this.level.crownPos, h = this.who(this.holder);
        if (this.holder !== -1 && (!h || !h.has || h.gone || h.pos.y < -5)) { this.holder = -1; changed = true; } // נפל עם הכתר – חוזר למרכז
        else if (this.holder === -1) { for (const c of all) if (Math.hypot(c.pos.x - C.x, c.pos.z - C.z) < 3.2 && Math.abs(c.pos.y - C.y) < 4.5) { this.holder = c.id; this.holdCd = 1.5; changed = true; break; } }
        else if (this.holdCd <= 0) for (const c of all) if (c.id !== this.holder && near(c, h, 3.8)) { this.holder = c.id; this.holdCd = 1.5; changed = true; break; }
      }
      this.miniT -= dt;
      if (changed || this.miniT <= 0) {
        this.miniT = 1.5;
        const m = { k: 'mn', its: [...this.its], tg: this.tags, h: this.holder };
        net.sendEvent(m);
        this.onMini(m);
      }
    }
    const ms = Math.max(1, Math.round(tRace * 1000));
    if (this.mini === 'tag') {
      const it = this.its.has(net.myId);
      this.car.speedMul = it ? 1.3 : 1; this.car.regen = it ? 30 : 16;
      for (const b of this.bots) { const bi = this.its.has(b.id); b.car.speedMul = bi ? 1.3 : 1; if (bi && !b.out) b.out = ms; b.kos = this.tags[b.id] || 0; }
      if (!this.over && tRace > 5 && this.its.size) {
        const n = this.order.length, clean = this.order.filter((id) => !this.its.has(id)).length;
        if (clean === 0 || (n >= 3 && clean <= 1) || tRace > 150) this.finishMatch();
      }
    } else {
      const mine = this.holder === net.myId;
      this.car.speedMul = mine ? 0.82 : 1; this.noBoost = mine;
      let top = this.kos;
      if (!this.over && tRace > 0 && mine) this.kos += dt * 10;
      for (const b of this.bots) { const bh = this.holder === b.id; b.car.speedMul = bh ? 0.82 : 1; if (bh && !this.over && tRace > 0) b.kos += dt * 10; }
      for (const r of this.remotes.values()) top = Math.max(top, r.kos);
      if (!this.over && (top >= 600 || tRace > 180)) this.finishMatch();
      // הכתר: מרחף במרכז, או מעל מי שמחזיק בו
      const h = this.who(this.holder), C = this.level.crownPos;
      if (h && h.has) this.crown.position.set(h.pos.x, h.pos.y + 2.5, h.pos.z); else this.crown.position.set(C.x, C.y + 0.4 + Math.sin(this.time * 3) * 0.25, C.z);
      this.crown.rotation.y += dt * 2.5;
    }
  }
  onMini(m) {
    if (this.mini === 'tag') {
      const was = this.amIt, first = !this.seenIt;
      this.its = new Set(Array.isArray(m.its) ? m.its : []);
      this.tags = m.tg && typeof m.tg === 'object' ? m.tg : {};
      this.kos = Number(this.tags[net.myId]) || 0;
      this.amIt = this.its.has(net.myId); this.seenIt = this.its.size > 0;
      if (this.its.has(net.myId) && !was) {
        this.out = Math.max(1, Math.round(this.tRace * 1000));
        if (first) { banner('אתה התופס!', 'ko', 2000); sfx.ko(); } else { banner('נתפסת!', 'lose', 1800); this.boom(this.phys); }
      } else if (first && this.its.size) { showMsg(`${this.who([...this.its][0])?.name || 'מישהו'} הוא התופס – ברחו!`, 2500); sfx.beep(true); }
      this.vis.setMark(this.its.has(net.myId));
      for (const r of this.remotes.values()) r.vis.setMark(this.its.has(r.id));
    } else if (this.mini === 'crown') {
      const prev = this.holder;
      this.holder = Number.isInteger(m.h) ? m.h : -1;
      if (this.holder !== prev && this.holder !== -1) { sfx.coin(); if (this.holder === net.myId) banner('הכתר אצלך!', 'win', 1400); else if (prev === net.myId) banner('חטפו לך את הכתר!', 'lose', 1400); }
    }
  }
  // לאן בוט צריך לנסוע במיני גיימס (null = התנהגות קרב רגילה)
  botGoal(b) {
    if (!this.mini || this.mini === 'floor') return null;
    const all = [this.meProxy, ...this.remotes.values()].filter((o) => o !== b && o.has && !o.gone && o.pos.y > -3);
    const nearest = (ok) => { let best = null, bd = 1e9; for (const o of all) { if (!ok(o)) continue; const d = Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z); if (d < bd) { bd = d; best = o; } } return best; };
    if (this.mini === 'tag') {
      if (this.its.has(b.id)) { const t = nearest((o) => !this.its.has(o.id)); return t ? { x: t.pos.x, z: t.pos.z } : null; }
      const t = nearest((o) => this.its.has(o.id));
      return t ? { x: t.pos.x, z: t.pos.z, flee: true } : { x: 0, z: 0 };
    }
    if (this.holder === b.id) { const t = nearest(() => true); return t ? { x: t.pos.x, z: t.pos.z, flee: true } : null; }
    const h = this.who(this.holder);
    return h && h.has ? { x: h.pos.x, z: h.pos.z } : { x: this.level.crownPos.x, z: this.level.crownPos.z };
  }

  // צפייה: אחרי שסיימתי (או הודחתי) המצלמה עוברת לשחקנים שעדיין משחקים
  updateSpec() {
    const can = (this.isRace && this.fin) || (this.battle && this.out && this.mini !== 'tag');
    const list = can ? [...this.remotes.values()].filter((r) => r.has && !r.gone && (this.battle ? r.lives > 0 : !r.fin)) : [];
    if (!list.length) { this.spec = null; return false; }
    let i = list.findIndex((r) => r.id === this.spec);
    if (i < 0) i = 0; else if (input.next) i = (i + 1) % list.length;
    this.spec = list[i].id;
    return true;
  }

  finishMatch() {
    this.over = true;
    const st0 = this.standings(), won = !!st0[0]?.me && !(this.mode === 'vs' && !this.fin);
    // חגיגה: המצלמה מקיפה את המנצח, קונפטי וכרזה
    this.cele = { id: st0[0] ? st0[0].id : net.myId, a: this.camYaw + Math.PI };
    this.spec = null;
    if (won) { banner('ניצחון!', 'win', 3000); sfx.win(); } else { banner(st0.length > 1 ? `מקום ${st0.findIndex((x) => x.me) + 1}` : 'נגמר!', 'lose', 3000); sfx.lose(); }
    setTimeout(() => {
      if (game !== this) return;
      const st = this.standings(), place = st.findIndex((x) => x.me) + 1, n = st.length;
      if (n >= 2) {
        // תגמול קטן בכוונה – כדי שלא ישתלם לחברים להפסיד בכוונה אחד לשני. מול בוטים בלבד אין גביעים
        const humans = net.players.filter((pl) => !pl.bot).length >= 2;
        const dnf = this.mode === 'vs' && !this.fin, win = place === 1 && !dnf;
        this.credit = account.gain({ tr: humans && !dnf ? [3, 2, 1][place - 1] ?? 0 : 0, coins: humans && win ? 4 : 0, xp: 30 + (n - place) * 15 });
        this.credit.place = place; this.credit.bots = !humans;
      }
      showResults();
    }, 3400);
  }

  who(id) { return id === net.myId ? this.meProxy : this.remotes.get(id); }
  neighborsOf(id) { const i = this.order.indexOf(id); return i < 0 ? [] : [this.order[i - 1], this.order[i + 1]].filter((x) => x !== undefined); }

  // כוח השרשרת על מכונית אחת (שלי, או של בוט שהמארח מריץ)
  applyChain(car = this.car, id = net.myId) {
    const b = car.body;
    let maxT = 0, lift = 0;
    b.quaternion.vmult(ATT, cr);
    for (const nid of this.neighborsOf(id)) {
      const r = this.who(nid);
      if (!r || !r.has) continue;
      const dx = r.attach.x - b.position.x - cr.x, dy = r.attach.y - b.position.y - cr.y, dz = r.attach.z - b.position.z - cr.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CHAIN_LEN * 2.5 || dist < 1e-3) continue;
      const stretch = dist - CHAIN_LEN;
      // אני תלוי באוויר והשותף עומד על המסלול: השרשרת מרימה אותי עד שאני כמעט בגובה שלו.
      // כך המשקל שלי לא מקבע אותו במקום – הוא יכול לנסוע ולמשוך אותי חזרה מעל השפה.
      const hanging = !car.supported && r.supported;
      if (hanging) lift = Math.max(lift, clamp(stretch * 1.5 + 1, 0, 2.5) * clamp((dy + 0.4) / 0.8, 0, 1));
      if (stretch <= 0) continue;
      const ux = dx / dist, uy = dy / dist, uz = dz / dist;
      b.angularVelocity.cross(cr, cv); cv.vadd(b.velocity, cv);
      const rate = (r.cv.x - cv.x) * ux + (r.cv.y - cv.y) * uy + (r.cv.z - cv.z) * uz; // >0 = מתרחקים
      maxT = Math.max(maxT, stretch / 2.2);
      if (!car.supported && !r.supported) {
        // שתי המכוניות באוויר: אין מי שיחזיק – נופלים יחד. בלי קפיץ, כדי שלא ימשכו זו את זו למעלה לסירוגין.
        if (stretch > 0.5 && rate > 0) { const k = Math.min(1, 3 * H) * rate; b.velocity.x += ux * k; b.velocity.y += uy * k; b.velocity.z += uz * k; }
        continue;
      }
      // לפחות אחת עומדת על משהו: השרשרת מחזיקה. הכוח נחלש כשמתקרבים, כך שאין אפקט "גומי" שמקפיץ חזרה.
      const soft = clamp(1 + rate / 2, 0, 1);
      // כשאני עומד והשותף תלוי, אני מרגיש רק חלק קטן מהמשיכה (הוא מורם בכוח השרשרת), כדי שאוכל לנסוע
      const holding = car.supported && !r.supported;
      let F = clamp(CHAIN_K * stretch * soft + CHAIN_C * Math.max(rate, 0), 0, CP.mass * 110);
      if (holding) F = Math.min(F * 0.35, CP.mass * 7);
      // כשאני תלוי עמוק מתחת לשותף, המשיכה היא כמעט רק כלפי מעלה – עולים לצד הקיר במקום להידחס אליו
      // או להיסחף מתחת לפלטפורמה. המשיכה פנימה חוזרת רק ליד השפה, כדי לעבור מעליה.
      const side = hanging && dy > 2.5 ? 0.15 : 1;
      addForce(b, cf.set(ux * F * side, uy * F, uz * F * side), cr);
      if (stretch > (holding ? 6 : 2.2) && rate > 0) { b.velocity.x += ux * rate * 0.5; b.velocity.y += uy * rate * 0.5; b.velocity.z += uz * rate * 0.5; }
    }
    if (lift > 0) {
      const m = CP.mass, k = Math.min(1, lift);
      b.force.y += m * CP.gravity * lift - m * 2.2 * b.velocity.y * k;
      b.force.x -= m * 1.2 * b.velocity.x * k; b.force.z -= m * 1.2 * b.velocity.z * k;
    }
    if (car === this.car) this.tension = maxT;
  }

  progress(pos = this.phys, cp = this.cp, lap = this.lap) {
    const cps = this.level.cps, cur = cps[cp].pos;
    const next = cp + 1 < cps.length ? cps[cp + 1].pos : this.level.finish.pos;
    const total = cur.distanceTo(next) || 1;
    return lap * 100000 + cp * 1000 + (clamp(total - pos.distanceTo(next), 0, total) / total) * 999;
  }

  standings() {
    if (this.mini === 'tag' || this.mini === 'crown') {
      const list = [{ id: net.myId, name: me.name || 'אני', lives: 1, kos: Math.round(this.kos), out: this.out, me: true }];
      for (const r of this.remotes.values()) list.push({ id: r.id, name: r.name, lives: 1, kos: Math.round(r.kos), out: r.out });
      if (this.mini === 'crown') return list.sort((a, b) => b.kos - a.kos);
      // תופסת: מי שלא נתפס ראשון; בין התופסים – מי שתפס יותר, ואז מי שנתפס מאוחר יותר
      return list.sort((a, b) => (!a.out && !b.out ? 0 : !a.out ? -1 : !b.out ? 1 : b.kos - a.kos || b.out - a.out));
    }
    if (this.battle) {
      const list = [{ id: net.myId, name: me.name || 'אני', lives: this.lives, kos: this.kos, out: this.out, me: true }];
      for (const r of this.remotes.values()) list.push({ id: r.id, name: r.name, lives: r.lives, kos: r.kos, out: r.lives > 0 ? 0 : r.out || 1 });
      return list.sort((a, b) => (!a.out && !b.out ? b.lives - a.lives || b.kos - a.kos : !a.out ? -1 : !b.out ? 1 : b.out - a.out));
    }
    const list = [{ id: net.myId, name: me.name || 'אני', fin: this.fin, prog: this.fin ? 1e9 : this.progress(), me: true }];
    for (const r of this.remotes.values()) list.push({ id: r.id, name: r.name, fin: r.fin, prog: r.fin ? 1e9 : r.prog });
    return list.sort((a, b) => (a.fin && b.fin ? a.fin - b.fin : b.prog - a.prog));
  }

  frame(dt) {
    this.time += dt;
    const tRace = (net.now() - this.startAt) / 1000;
    this.tRace = tRace;
    const inp = input.read();
    const spectating = this.updateSpec();
    const locked = tRace < 0 || spectating || (this.over && this.mode === 'vs');
    if (this.noBoost) inp.boost = false;
    this.pendingJump ||= inp.jump;
    const car = this.car, body = car.body, level = this.level;

    for (const r of this.remotes.values()) r.update(dt, this.time);
    this.carsPos.length = 0;
    this.carsPos.push(this.phys.copy(body.position));
    for (const r of this.remotes.values()) if (r.has) this.carsPos.push(r.pos);

    // פיזיקה בצעד קבוע
    this.acc += dt;
    let n = Math.floor(this.acc / H);
    this.acc -= n * H;
    if (n > 10) n = 10;
    for (let i = 0; i < n; i++) {
      level.step(tRace - (n - 1 - i) * H, H, this.carsPos);
      this.prevP.copy(body.position); this.prevQ.copy(body.quaternion);
      inp.jump = this.pendingJump; this.pendingJump = false;
      if (!this.gone) { car.step(H, inp, locked); if (car.didJump) sfx.jump(); }
      this.meProxy.attach.set(0, 0.3, 0).applyQuaternion(_q.copy(body.quaternion)).add(body.position);
      if (this.mode === 'chain') this.applyChain();
      for (const b of this.bots) b.step(H, tRace < 0 || (this.over && this.mode === 'vs'), this);
      this.world.step(H);
    }
    this.phys.copy(body.position);
    const p = this.phys;
    for (const b of this.bots) b.post(dt, this, tRace, net);
    this.updateFx(dt);

    // משטחי בוסט
    for (const pd of level.pads) {
      pd.cd -= dt;
      if (pd.cd <= 0 && !this.gone && level.inPad(pd, p)) {
        pd.cd = 1;
        car.boost = 100;
        const along = body.velocity.x * pd.f.x + body.velocity.z * pd.f.z;
        const kick = clamp(46 - along, 0, 12);
        body.velocity.x += pd.f.x * kick; body.velocity.z += pd.f.z * kick;
        sfx.pad();
      }
    }
    // נקודות ביקורת, סיום ונפילה
    for (let i = Math.min(level.cps.length - 1, this.cp + 2); i > this.cp; i--) {
      if (level.inZone(level.cps[i], p)) { this.cp = i; sfx.checkpoint(); showMsg('נקודת ביקורת!'); break; }
    }
    if (this.mode === 'chain') for (const r of this.remotes.values()) if (r.cp > this.cp) { this.cp = r.cp; showMsg('נקודת ביקורת!'); }
    if (this.laps && !this.fin && !locked && level.inZone(level.finish, p)) {
      // מסלול הקפות: חציית הקו נספרת רק אחרי שעברו את כל נקודות הביקורת
      if (this.cp === level.cps.length - 1) {
        this.lap++; this.cp = 0;
        if (this.lap < this.laps) { sfx.checkpoint(); showMsg(this.lap === this.laps - 1 ? 'הקפה אחרונה!' : `הקפה ${this.lap + 1} מתוך ${this.laps}`, 1800); }
      }
    }
    if (!this.fin && !locked && (this.laps ? this.lap >= this.laps : level.inZone(level.finish, p))) {
      this.fin = Math.max(1, Math.round(tRace * 1000));
      sfx.finish();
      if (this.mode === 'race') {
        this.credit = account.finishRace(this.lvl, this.fin);
        this.confetti(this.phys, 90);
        banner(this.credit.newPb && !this.credit.first ? 'שיא חדש!' : 'סיימת!', 'win', 2000);
        showMsg((this.credit.newPb && !this.credit.first ? 'שיא חדש! ' : 'סיימת! ') + fmt(this.fin), 3000);
        setTimeout(() => { if (game === this) showResults(); }, 1500);
      } else if (this.mode === 'vs') showMsg('סיימת! ' + fmt(this.fin), 3000);
      else showMsg(this.remotes.size ? 'הגעת! מחכים לשאר הקבוצה…' : 'סיימת! ' + fmt(this.fin), 3000);
    }
    if (this.mode === 'chain' && this.fin && !this.teamDone && [...this.remotes.values()].every((r) => r.fin)) {
      this.teamDone = true;
      this.teamTime = Math.max(this.fin, ...[...this.remotes.values()].map((r) => r.fin));
      // שלב בשרשרת נחשב רק כשמשחקים אותו לפחות שניים
      if (this.remotes.size) this.credit = account.finishChain(this.lvl, this.teamTime, net.players.some((pl) => pl.bot) ? null : net.players.map((pl) => ({ name: pl.name, uid: pl.uid })));
      this.confetti(this.phys, 90); sfx.win();
      banner('עברתם יחד!', 'win', 2000);
      setTimeout(() => { if (game === this) showResults(); }, 1200);
    }
    // מירוץ חברים: נגמר כשכולם סיימו, או 45 שניות אחרי הראשון
    if (this.mode === 'vs' && !this.over && tRace > 1) {
      let first = this.fin || Infinity, all = !!this.fin;
      for (const r of this.remotes.values()) { if (r.fin) first = Math.min(first, r.fin); else all = false; }
      this.endIn = first < Infinity ? (first + 45000) / 1000 - tRace : null;
      if (all || (this.endIn !== null && this.endIn <= 0)) this.finishMatch();
    }
    // קרב: נגמר כשנשאר שחקן אחד, או אחרי 4 דקות
    if (this.mini && this.mini !== 'floor') this.updateMini(dt, tRace);
    else if (this.battle && !this.over && tRace > 3) {
      let alive = this.lives > 0 ? 1 : 0;
      for (const r of this.remotes.values()) if (r.lives > 0) alive++;
      if (alive <= (this.order.length >= 2 ? 1 : 0) || tRace > 240) this.finishMatch();
    }
    this.floorT -= dt;
    if (this.floorT <= 0) { this.floorT = 0.25; this.floorY = level.floorNear(p); }
    if (this.gone) { /* מודח – אין מכונית */ } else if (p.y < (this.battle ? level.killY : Math.max(level.killY, this.floorY - 38))) this.fall();
    else if (inp.respawn && !locked && !this.battle) { if (this.mode === 'chain') this.teamRespawn(true); else this.respawn(); }

    // מצב מוצג (אינטרפולציה בין צעדי הפיזיקה)
    const alpha = this.acc / H;
    this.pos.copy(this.prevP).lerp(this.phys, alpha);
    this.quat.copy(this.prevQ).slerp(_q.copy(body.quaternion), alpha);
    this.vis.group.position.copy(this.pos);
    this.vis.group.quaternion.copy(this.quat);
    this.vis.update(car.steer, car.wheels, car.spin, car.boosting, this.time);

    // חלקיקי בוסט
    const emit = (pos, quat, vel, color) => {
      for (const sx of [-0.38, 0.38]) {
        _v.set(sx, -0.12, -2.4).applyQuaternion(quat).add(pos);
        _v2.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, -10).applyQuaternion(quat).addScaledVector(vel, 0.6);
        this.particles.emit(_v, _v2, color, 0.45);
      }
    };
    if (car.boosting && !this.gone) emit(this.pos, this.quat, body.velocity, trailCol(this.vis, this.time));
    for (const r of this.remotes.values()) if (r.has && r.boosting && !r.gone) emit(r.pos, r.quat, r.nv, trailCol(r.vis, this.time));
    this.particles.update(dt);

    // שרשראות
    for (const c of this.chains) {
      const a = this.attachOf(c.a, _v), b = this.attachOf(c.b, _v2);
      c.vis.update(a || _v, b || _v2, !!(a && b) && _v.distanceTo(_v2) < CHAIN_LEN * 2.5);
    }

    this.updateItems(dt, inp);
    if (input.horn && input.enabled && me.skin.horn) { sfx.horn(me.skin.horn); net.sendEvent({ k: 'horn', h: me.skin.horn }); }
    level.update(dt, this.cp);
    this.updateCamera(dt);
    this.sun.position.set(this.focus.x + 12, this.focus.y + 90, this.focus.z - 45);
    this.sun.target.position.copy(this.focus);
    this.sky.update(camera);
    const speed = body.velocity.length();
    sfx.engine(speed, inp.throttle, car.boosting && !this.gone, true);

    // שליחת מצב לרשת
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 30;
      const q = body.quaternion, v = body.velocity, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
      net.sendState([r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(v.x), r2(v.y), r2(v.z), (car.boosting ? 1 : 0) | (car.supported ? 0 : 2) | (this.gone ? 4 : 0), this.battle ? this.lives : this.cp, this.battle ? Math.round(this.kos) : Math.round(this.progress()), this.battle ? this.out : this.fin, this.gid]);
    }

    this.updateHud(dt, tRace, speed);
  }

  attachOf(id, out) {
    if (id === net.myId) return out.set(0, 0.3, 0).applyQuaternion(this.quat).add(this.pos);
    const r = this.remotes.get(id);
    return r && r.has ? out.copy(r.attach) : null;
  }

  updateCamera(dt) {
    if (this.cele) {
      // חגיגת ניצחון: המצלמה מקיפה את המנצח
      const w = this.cele.id === net.myId ? null : this.remotes.get(this.cele.id);
      const C = (this.focus = w && w.has && !w.gone ? w.pos : this.pos);
      this.cele.a += dt * 0.9;
      camera.position.set(C.x + Math.sin(this.cele.a) * 9, C.y + 3.6, C.z + Math.cos(this.cele.a) * 9);
      camera.lookAt(C.x, C.y + 1, C.z);
      this.camPos.copy(camera.position);
      camera.fov = this.fov = 58;
      camera.updateProjectionMatrix();
      return;
    }
    const sr = this.spec != null ? this.remotes.get(this.spec) : null;
    const P = (this.focus = sr ? sr.pos : this.pos), Q = sr ? sr.quat : this.quat;
    const v = sr ? sr.nv : this.car.body.velocity, onGround = sr ? sr.supported : this.car.grounded >= 2;
    const hs = Math.hypot(v.x, v.z);
    _v.set(0, 0, 1).applyQuaternion(Q);
    let yawT = this.camYaw;
    if (onGround) { if (Math.hypot(_v.x, _v.z) > 0.3) yawT = Math.atan2(_v.x, _v.z); } else if (hs > 6) yawT = Math.atan2(v.x, v.z);
    let d = yawT - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * (1 - Math.exp(-dt * 5));
    const sp = Math.hypot(v.x, v.y, v.z), dist = 8.5 + sp * 0.06, sn = Math.sin(this.camYaw), cs = Math.cos(this.camYaw);
    this.camPos.x = P.x - sn * dist;
    this.camPos.z = P.z - cs * dist;
    this.camPos.y += (P.y + 3.5 - this.camPos.y) * (1 - Math.exp(-dt * 7));
    camera.position.copy(this.camPos);
    if (this.shake > 0) { camera.position.x += (Math.random() - 0.5) * this.shake; camera.position.y += (Math.random() - 0.5) * this.shake; camera.position.z += (Math.random() - 0.5) * this.shake; }
    camera.lookAt(P.x + sn * 5, P.y + 1.3, P.z + cs * 5);
    this.fov += (62 + Math.min(24, sp * 0.5) - this.fov) * Math.min(1, dt * 4);
    camera.fov = this.fov;
    camera.updateProjectionMatrix();
  }

  updateHud(dt, tRace, speed) {
    // ספירה לאחור
    const c = tRace < 0 ? Math.ceil(-tRace) : tRace < 0.9 ? 0 : -1;
    if (c !== this.lastCount) {
      this.lastCount = c;
      hud.count.classList.toggle('hidden', c < 0);
      hud.count.textContent = c > 3 ? '' : c > 0 ? c : 'צא!';
      if (c >= 0 && c <= 3) sfx.beep(c === 0);
    }
    const cap = this.mini === 'tag' ? 150 : this.mini === 'crown' ? 180 : 240;
    hud.timer.textContent = this.battle ? fmt(clamp(cap - tRace, 0, cap) * 1000).slice(0, 4) : fmt(this.fin || Math.max(0, tRace * 1000));
    hud.nitroFill.style.width = `${this.car.boost.toFixed(0)}%`;
    hud.nitro.classList.toggle('low', this.car.boost < 12);
    hud.nitro.classList.toggle('on', this.car.boosting);
    hud.spd.textContent = Math.round(speed * 3.6);
    hud.ring.style.setProperty('--b', this.car.boost.toFixed(0));
    if (this.mode === 'chain') {
      hud.tension.style.width = `${clamp(this.tension, 0, 1) * 100}%`;
      hud.height.textContent = `גובה ${Math.max(0, Math.round(this.pos.y))} מ'`;
    }
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.3;
      const st = this.standings();
      const sr = this.spec != null ? this.remotes.get(this.spec) : null;
      hud.info.textContent = sr ? `👁 צופה ב־${sr.name}${this.remotes.size > 1 ? ' · רווח / A להחלפה' : ''}`
        : this.laps && !this.fin ? `הקפה ${Math.min(this.laps, this.lap + 1)} / ${this.laps}${this.endIn !== null && !this.over ? ` · נגמר בעוד ${Math.max(0, Math.ceil(this.endIn))} שנ'` : ''}`
        : this.mode === 'vs' && this.endIn !== null && !this.fin && !this.over ? `המירוץ נגמר בעוד ${Math.max(0, Math.ceil(this.endIn))} שנ'` : '';
      if (this.mini) {
        const el = hud.battle, nameOf = (id) => (id === net.myId ? 'אצלך' : 'אצל ' + (this.remotes.get(id)?.name || '…'));
        if (this.mini === 'tag') {
          const it = this.its.has(net.myId), clean = this.order.filter((id) => !this.its.has(id)).length;
          el.innerHTML = `<b>${!this.its.size ? 'מתכוננים…' : it ? 'אתה התופס! תפוס את כולם' : 'ברח מהתופסים!'}</b><small>נשארו ${clean} חופשיים${it ? ` · תפסת ${this.kos}` : ''}</small>`;
          el.classList.toggle('hot', it);
        } else if (this.mini === 'crown') {
          el.innerHTML = `<b>👑 ${this.holder === -1 ? 'הכתר חופשי – רוצו אליו!' : 'הכתר ' + nameOf(this.holder)}</b><small>הנקודות שלך: ${Math.floor(this.kos / 10)} / 60</small>`;
          el.classList.toggle('gold', this.holder === net.myId);
        } else el.innerHTML = `<b>${this.out ? 'נפלת!' : 'הרצפה נעלמת – הישארו למעלה'}</b><small>נשארו ${st.filter((x) => !x.out).length} שחקנים</small>`;
        hud.board.innerHTML = st.map((x, i) => `<li class="${x.me ? 'me' : ''}">${i + 1}. ${esc(x.name)}<span>${this.mini === 'crown' ? Math.floor(x.kos / 10) : this.mini === 'tag' ? (x.out ? '🔴 ' + x.kos : '🟢') : x.out ? '✖' : '🟢'}</span></li>`).join('');
        if (!$('#results').classList.contains('hidden')) fillResults();
        return;
      }
      if (this.battle) {
        hud.battle.innerHTML = `<b>${'❤'.repeat(Math.max(0, this.lives))}<s>${'❤'.repeat(3 - Math.max(0, this.lives))}</s></b><small>הפלות: ${this.kos}</small>`;
        hud.board.innerHTML = st.map((x, i) => `<li class="${x.me ? 'me' : ''}">${i + 1}. ${esc(x.name)}<span>${x.out ? '✖' : '❤'.repeat(Math.max(0, x.lives))} · ${x.kos}</span></li>`).join('');
        if (!$('#results').classList.contains('hidden')) fillResults();
        return;
      }
      if (this.isRace) hud.rank.innerHTML = `${st.findIndex((x) => x.me) + 1}<small>/${st.length}</small>`;
      hud.board.innerHTML = st.map((x, i) => `<li class="${x.me ? 'me' : ''}">${i + 1}. ${esc(x.name)}<span>${x.fin ? fmt(x.fin) : ''}</span></li>`).join('');
      if (!$('#results').classList.contains('hidden')) fillResults();
    }
  }

  dispose() {
    for (const r of this.remotes.values()) r.vis.dispose();
    for (const c of this.chains) c.vis.dispose();
    this.vis.dispose();
    this.level.dispose();
    this.sun.shadow.map?.dispose();
    sfx.engine(0, 0, false, false);
    sfx.musicStop();
    for (const bx of this.boxes) bx.mesh.material.dispose();
    for (const r of this.rings) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    if (this.crown) this.crown.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    hud.battle.className = 'hidden';
    $('#banner').className = '';
    for (const o of this.oils) { o.mesh.geometry.dispose(); o.mesh.material.dispose(); }
    this.shield.geometry.dispose(); this.shield.material.dispose();
    hud.item.classList.add('hidden');
  }
}

// ---------- ממשק ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const showroom = new Showroom();
let game = null, currentGame = null, lobbyMode = 'race', screen = 'menu', garageFrom = 'menu';
const lobbyLevel = { race: 1, chain: 1, vs: 1, battle: 1, mini: 1 };
const MAXL = { race: RACE_LEVELS, chain: CHAIN_LEVELS, vs: VS_MAPS, battle: BATTLE_MAPS, mini: 399 };
const CATS = { vs: VS_CATS, mini: MINI_CATS }, SPLIT = { vs: vsSplit, mini: miniSplit };
const maxLevel = (mode) => MAXL[mode] || 1;
const isMaps = (mode) => mode === 'vs' || mode === 'battle' || mode === 'mini'; // מצבים עם מפות פתוחות (בלי התקדמות)
const unlocked = (mode) => (isMaps(mode) ? maxLevel(mode) : Math.min(maxLevel(mode), (account.profile[mode] || 0) + 1));

// תמונת תצוגה מקדימה של מפה: המסלול מלמעלה
const previews = {};
function preview(mode, i) {
  const key = mode + i;
  if (previews[key]) return previews[key];
  const sh = trackShape(mode, i), W = 160, Hh = 100, c = document.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d'), polys = [];
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const sg of sh.segs) {
    const fx = Math.sin(sg.yaw) * sg.len / 2, fz = Math.cos(sg.yaw) * sg.len / 2, lx = Math.cos(sg.yaw) * sg.w / 2, lz = -Math.sin(sg.yaw) * sg.w / 2;
    const pts = [[sg.x + fx + lx, sg.z + fz + lz], [sg.x + fx - lx, sg.z + fz - lz], [sg.x - fx - lx, sg.z - fz - lz], [sg.x - fx + lx, sg.z - fz + lz]];
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    polys.push(pts);
  }
  // מסלולים ארוכים ממלאים את התמונה טוב יותר כשהם שוכבים לרוחב
  const flip = z1 - z0 > x1 - x0, bw = flip ? z1 - z0 : x1 - x0, bh = flip ? x1 - x0 : z1 - z0;
  const k = Math.min((W - 16) / bw, (Hh - 16) / bh), ox = (W - bw * k) / 2, oy = (Hh - bh * k) / 2;
  const map = (x, z) => (flip ? [ox + (z - z0) * k, oy + (x - x0) * k] : [ox + (x1 - x) * k, oy + (z1 - z) * k]);
  g.fillStyle = '#0a1022'; g.fillRect(0, 0, W, Hh);
  g.globalAlpha = 0.4; g.fillStyle = sh.sky; g.fillRect(0, 0, W, Hh); g.globalAlpha = 1;
  g.fillStyle = sh.floor; g.strokeStyle = sh.trim; g.lineWidth = 2.5; g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const pts of polys) {
    g.beginPath();
    pts.forEach(([x, z], j) => { const [cx, cy] = map(x, z); if (j) g.lineTo(cx, cy); else g.moveTo(cx, cy); });
    g.closePath();
    if (pass) g.fill(); else g.stroke();
  }
  const dot = (pos, col) => { const [cx, cy] = map(pos.x, pos.z); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 4.5, 0, 7); g.fill(); g.stroke(); };
  if (sh.finish) { dot(sh.start, '#2bff7a'); dot(sh.finish, '#ffffff'); }
  return (previews[key] = c.toDataURL());
}

function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function show(name) {
  screen = name;
  for (const s of ['menu', 'garage', 'lobby', 'auth', 'lb', 'road', 'shop']) $('#' + s).classList.toggle('hidden', s !== name);
  const inGame = name === 'game';
  $('#hud').classList.toggle('hidden', !inGame);
  $('#touch').classList.toggle('hidden', !(inGame && isTouch));
  if (!inGame) { $('#countdown').classList.add('hidden'); $('#results').classList.add('hidden'); $('#pause').classList.add('hidden'); input.enabled = true; }
}

function refreshShowroom() {
  showroom.setCars(screen === 'lobby' || (screen === 'garage' && garageFrom === 'lobby') ? net.players : [{ name: me.name, skin: me.skin }]);
}

function readName() {
  if (account.loggedIn) { me.name = account.user.name; me.uid = account.uid; return; }
  me.uid = null;
  me.name = ($('#name').value.trim() || 'שחקן').slice(0, 14);
  store.set('name', me.name);
}

// ----- חשבון ו-XP -----
function xpHtml() {
  const xp = account.profile.xp || 0, r = rankOf(xp);
  return `<div class="xpbar"><i style="width:${(r.frac * 100).toFixed(0)}%"></i></div><small>${xp} XP · עוד ${r.next - xp} לרמה ${r.lvl + 1}</small>`;
}
function walletHtml() { return `<div class="wallet"><span>🏆 ${account.profile.tr || 0}</span><span>🪙 ${account.profile.coins || 0}</span></div>`; }
function renderAccount() {
  const box = $('#acct'), r = rankOf(account.profile.xp || 0);
  const badge = `<span class="rankBadge">רמה ${r.lvl} · ${r.title}</span>`;
  if (account.loggedIn) {
    box.innerHTML = `<div class="top"><b>${esc(account.user.name)}</b>${badge}<button id="btnLogout" class="chip">התנתק</button></div>${xpHtml()}${walletHtml()}`;
    $('#btnLogout').onclick = () => { account.logout(); };
    $('#name').value = account.user.name;
  } else {
    box.innerHTML = `<div class="top">${account.profile.xp ? badge : '<b>אורח</b>'}<button id="btnAuth" class="chip">התחברות / הרשמה</button></div>`
      + (account.profile.xp ? xpHtml() : '') + walletHtml() + '<small>ההתקדמות נשמרת בדפדפן הזה. הירשמו כדי להופיע בטבלת השיאים ולשחק מכל מכשיר</small>';
    $('#btnAuth').onclick = () => { $('#authErr').textContent = ''; $('#authName').value = $('#name').value.trim(); $('#authPass').value = ''; show('auth'); };
  }
  $('#name').readOnly = account.loggedIn;
  $('#authNote').textContent = account.online
    ? 'שם המשתמש יופיע בטבלת השיאים העולמית. ההתקדמות, השיאים וה‑XP נשמרים בחשבון.'
    : 'החשבון נשמר במכשיר הזה. טבלת השיאים מתעדכנת בין חברים שמשחקים יחד באותו חדר.';
}
// המראה של המכונית שייך למשתמש: כשמתחברים, מתנתקים או נכנסים מחדש – טוענים את המראה השמור שלו
let skinOwner;
function loadUserSkin() {
  const key = account.uid || 'guest';
  if (key === skinOwner) return;
  skinOwner = key;
  const sk = account.profile.skin;
  if (sk && typeof sk === 'object') { me.skin = { ...DEFAULT_SKIN, ...sk }; store.set('skin', me.skin); } else account.setSkin(me.skin);
  if (!net.offline) net.updateMe(me);
  if (screen !== 'game') refreshShowroom();
}
// תצוגה מקדימה של פריט על המכונית (בלי לשמור)
let pvItem = null;
function previewItem(id) {
  const m = /^([a-z]+)(\d+)$/.exec(id || '');
  if (!m) return;
  const key = m[1], i = Number(m[2]);
  pvItem = id;
  document.querySelectorAll('.items li').forEach((li) => li.classList.toggle('pv', li.dataset.item === id));
  if (key === 'horn') { sfx.init(); sfx.horn(i); return; }
  const sk = { ...me.skin, [key]: i };
  if (key === 'type' && i >= 3) { sk.wrap = 0; sk.grad = 0; }
  showroom.setCars([{ name: me.name, skin: sk }]);
  showroom.boost = key === 'tfx';
}
function endPreview() { pvItem = null; showroom.boost = false; refreshShowroom(); }

account.onChange = () => { readName(); loadUserSkin(); renderAccount(); if (screen === 'lobby') renderLobby(); if (screen === 'road') renderRoad(); if (screen === 'shop') renderShop(); };
async function doAuth(kind) {
  const err = $('#authErr');
  err.textContent = kind === 'login' ? 'מתחבר…' : 'נרשם…';
  try {
    await account[kind]($('#authName').value, $('#authPass').value);
    err.textContent = '';
    show('menu');
    toast(kind === 'login' ? 'התחברת בהצלחה' : 'נרשמת בהצלחה – בהצלחה במירוץ!');
  } catch (e) { err.textContent = e instanceof AuthError ? e.message : 'שגיאה, נסו שוב'; }
}

// ----- טבלת שיאים -----
let lbTab = 'race', lbData = null;
function renderLb() {
  document.querySelectorAll('#lb .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === lbTab));
  $('#lbLevelRow').classList.toggle('hidden', lbTab !== 'time');
  const list = $('#lbList');
  if (!lbData) { list.innerHTML = '<li>טוען…</li>'; return; }
  const myName = account.loggedIn ? account.user.name : null;
  let rows = lbData[lbTab] || [];
  if (lbTab === 'time') {
    const k = 'l' + $('#lbLevel').value;
    rows = (lbData.all || []).filter((e) => e.best && e.best[k] > 0).map((e) => ({ name: e.name, t: e.best[k] })).sort((a, b) => a.t - b.t).slice(0, 50);
  }
  if (rows.length && (lbTab === 'tr' || lbTab === 'time')) {
    list.innerHTML = rows.map((e, i) => `<li class="${e.name === myName ? 'me' : ''}"><span class="n">${i + 1}</span>${esc(e.name)}<span class="v"><b dir="ltr">${lbTab === 'tr' ? e.tr + ' 🏆' : fmt(e.t)}</b></span></li>`).join('');
    $('#lbNote').textContent = '';
    return;
  }
  if (!rows.length) list.innerHTML = '<li>עדיין אין כאן אף אחד. סיימו שלב כשאתם מחוברים לחשבון כדי להופיע ראשונים!</li>';
  else if (lbTab === 'race') list.innerHTML = rows.map((e, i) => `<li class="${e.name === myName ? 'me' : ''}"><span class="n">${i + 1}</span>${esc(e.name)}<span class="v"><em>${e.xp} XP</em><b>שלב ${e.level}</b></span></li>`).join('');
  else list.innerHTML = rows.map((e, i) => `<li class="${myName && e.names.split(' + ').includes(myName) ? 'me' : ''}"><span class="n">${i + 1}</span>${esc(e.names)}<span class="v"><em>${fmt(e.time)}</em><b>שלב ${e.level}</b></span></li>`).join('');
  $('#lbNote').textContent = account.online ? '' : 'הטבלה שמורה במכשיר ומתמזגת עם חברים שמשחקים איתכם באותו חדר.';
}
let lbFrom = 'menu';
async function openLb(from = 'menu') {
  lbFrom = from;
  lbData = null;
  $('#lb').classList.toggle('ingame', from === 'game');
  // באמצע משחק הטבלה נפתחת מעל המשחק, בלי לצאת ממנו
  if (from === 'game') { $('#pause').classList.add('hidden'); $('#lb').classList.remove('hidden'); input.enabled = false; } else show('lb');
  renderLb();
  try { lbData = await account.leaderboard(); } catch { lbData = { race: [], chain: [] }; }
  renderLb();
}

// ----- דרך הגביעים והחנות -----
function renderRoad() {
  const tr = account.profile.tr || 0;
  $('#roadTop').innerHTML = walletHtml();
  $('#roadList').innerHTML = ROAD.map((r, i) => {
    const got = account.claimed(i), can = tr >= r.at && !got;
    const what = r.coins ? `${r.coins} מטבעות` : esc(itemName(r.item));
    const act = got ? '<em>נאסף ✓</em>' : can ? `<button class="chip on" data-i="${i}">אסוף</button>` : `<em>עוד ${r.at - tr} 🏆</em>`;
    return `<li data-item="${r.item || ''}" class="${r.item === pvItem && pvItem ? 'pv ' : ''}${got ? 'got' : can ? 'can' : tr >= r.at ? '' : 'far'}"><span class="at">🏆 ${r.at}</span><i style="background:${r.item ? itemSwatch(r.item) : 'radial-gradient(circle, #fff3a0, #ffb41a)'}"></i><b>${what}</b>${act}</li>`;
  }).join('');
  $('#roadList').querySelectorAll('li[data-item]').forEach((li) => (li.onclick = (e) => { if (e.target.tagName !== 'BUTTON') previewItem(li.dataset.item); }));
  $('#roadList').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const i = Number(b.dataset.i), r = ROAD[i];
    if (account.claim(i, r)) { sfx.init(); sfx.coin(); toast(r.coins ? `קיבלת ${r.coins} מטבעות!` : `קיבלת ${itemName(r.item)} – חפשו במוסך`, 3500); }
  }));
  $('#roadNote').textContent = account.loggedIn ? 'לחצו על פריט כדי לראות אותו על המכונית. גביעים מרוויחים בשלבים ובניצחונות.' : 'ההתקדמות נשמרת בדפדפן הזה. הירשמו כדי לשחק מכל מכשיר ולהופיע בטבלת השיאים.';
  $('#roadList').querySelector('.can, .far')?.scrollIntoView({ block: 'center' });
}
function renderShop() {
  const coins = account.profile.coins || 0;
  $('#shopTop').innerHTML = walletHtml();
  $('#shopList').innerHTML = SHOP.map((it, i) => {
    const own = account.owns(it.item);
    return `<li data-item="${it.item}" class="${it.item === pvItem ? 'pv ' : ''}${own ? 'got' : ''}"><i style="background:${itemSwatch(it.item)}"></i><b>${esc(itemName(it.item))}</b>${own ? '<em>בבעלותך ✓</em>' : `<button class="chip on" data-i="${i}" ${coins < it.price ? 'disabled' : ''}>${it.price} 🪙</button>`}</li>`;
  }).join('');
  $('#shopList').querySelectorAll('li[data-item]').forEach((li) => (li.onclick = (e) => { if (e.target.tagName !== 'BUTTON') previewItem(li.dataset.item); }));
  $('#shopList').querySelectorAll('button').forEach((b) => (b.onclick = () => {
    const it = SHOP[Number(b.dataset.i)];
    if (account.buy(it.item, it.price)) { sfx.init(); sfx.coin(); toast(`קניתם ${itemName(it.item)} – לבישה במוסך`, 3500); }
  }));
  $('#shopNote').textContent = account.loggedIn ? 'לחצו על פריט כדי לראות אותו על המכונית. מטבעות מרוויחים בכל משחק ובדרך הגביעים.' : 'לחצו על פריט כדי לראות אותו על המכונית. הקניות נשמרות בדפדפן הזה; הירשמו כדי לשחק מכל מכשיר.';
}

function errText(e) {
  const t = e?.type || e?.message || '';
  if (t === 'peer-unavailable') return 'לא נמצא חדר עם הקוד הזה';
  if (t === 'full') return 'החדר מלא';
  if (t === 'relay-denied') return 'החיבור הישיר בין המחשבים נחסם, וחיבור הגיבוי עדיין לא הופעל בהגדרות האתר';
  if (t === 'relay-timeout' || t === 'timeout') return 'לא הצלחנו להתחבר לחדר. בדקו שהמארח עדיין בלובי ונסו שוב';
  if (t === 'nolib') return 'ספריית הרשת לא נטענה – בדקו את החיבור לאינטרנט';
  return 'בעיית חיבור, נסו שוב';
}

// מוסך
let skinTimer = 0;
function skinChanged() {
  store.set('skin', me.skin);
  account.setSkin(me.skin);
  clearTimeout(skinTimer);
  skinTimer = setTimeout(() => {
    if (garageFrom === 'lobby') net.updateMe(me); else refreshShowroom();
  }, 70);
}

function buildGarage() {
  const root = $('#garageOpts');
  root.innerHTML = '';
  const section = (label) => {
    const d = document.createElement('div');
    d.className = 'opt';
    d.innerHTML = `<small>${label}</small><div class="chips"></div>`;
    root.appendChild(d);
    return d.lastChild;
  };
  const chips = (label, key, names) => {
    const box = section(label);
    names.forEach((n, i) => {
      const b = document.createElement('button');
      const id = key + i, lock = SOURCE[id] && !account.owns(id);
      b.className = 'chip' + (me.skin[key] === i ? ' on' : '') + (lock ? ' locked' : '');
      b.textContent = n + (lock ? ' 🔒' : '');
      b.onclick = () => { if (lock) { toast(`תצוגה מקדימה בלבד – משיגים ב${SOURCE[id]}`, 3200); if (garageFrom === 'menu') previewItem(id); return; } if (key === 'horn') { sfx.init(); sfx.horn(i); } me.skin[key] = i; box.querySelectorAll('.chip').forEach((c, j) => c.classList.toggle('on', j === i)); skinChanged(); };
      box.appendChild(b);
    });
  };
  const colors = (label, key) => {
    const box = section(label);
    const mark = () => box.querySelectorAll('.sw').forEach((s) => s.classList.toggle('on', s.dataset.c === me.skin[key]));
    for (const c of SKIN_OPTS.colors) {
      const b = document.createElement('button');
      b.className = 'sw';
      b.dataset.c = c;
      b.style.background = c;
      b.onclick = () => { me.skin[key] = c; pick.value = c; mark(); skinChanged(); };
      box.appendChild(b);
    }
    const pick = document.createElement('input');
    pick.type = 'color';
    pick.value = me.skin[key];
    pick.title = 'צבע מותאם';
    pick.oninput = () => { me.skin[key] = pick.value; mark(); skinChanged(); };
    box.appendChild(pick);
    mark();
  };
  chips('דגם', 'type', SKIN_OPTS.types);
  colors('צבע ראשי', 'color');
  chips('צבע גרדיאנט (במקום הצבע הראשי)', 'grad', GRADS.map((g) => (g ? g.n : 'ללא')));
  chips('טפט', 'wrap', WRAPS);
  chips('גימור צבע', 'finish', SKIN_OPTS.finishes);
  colors('צבע משני', 'accent');
  chips('גלגלים', 'wheel', SKIN_OPTS.wheels);
  colors('צבע חישוקים', 'rim');
  chips('ספוילר', 'spoiler', SKIN_OPTS.spoilers);
  chips('קישוט גג', 'topper', SKIN_OPTS.toppers);
  chips('נוצות זנב', 'feather', FEATHERS.map((f) => (f ? f.n : 'ללא')));
  colors('זוהר ניאון', 'glow');
  colors('שובל בוסט', 'trail');
  chips('אפקט שובל', 'tfx', TRAILS);
  chips('צופר (מקש Tab)', 'horn', HORNS);
}

function openGarage(from) {
  garageFrom = from;
  buildGarage();
  show('garage');
  refreshShowroom();
}

// לובי
function renderLobby() {
  $('#roomCode').textContent = net.offline ? 'אימון' : net.code;
  $('#btnCopy').classList.toggle('hidden', net.offline);
  $('#btnPublic').classList.toggle('hidden', net.offline || !net.isHost || !net.canMatch);
  $('#btnPublic').classList.toggle('on', !!net.isPublic);
  $('#btnPublic span').textContent = net.isPublic ? 'חדר ציבורי 🌍' : 'חדר פרטי 🔒';
  renderBots();
  $('#players').innerHTML = net.players.map((p) => `<li><i style="background:${esc(p.skin?.color || '#fff')}"></i>${esc(p.name)}<em>${p.bot ? `בוט · רמה ${p.lvl}` : ''}${p.id === 0 ? 'מארח' : ''}${p.id === net.myId ? ' (אני)' : ''}</em></li>`).join('');
  if (net.offline && lobbyMode !== 'race') lobbyMode = 'race'; // שאר המצבים רק בחדר אמיתי
  document.querySelectorAll('.mode').forEach((b) => {
    const multi = b.dataset.mode !== 'race';
    b.classList.toggle('on', b.dataset.mode === lobbyMode);
    b.disabled = !net.isHost || (multi && net.offline);
    b.classList.toggle('off', multi && net.offline);
  });
  const needMore = lobbyMode !== 'race' && net.players.length < 2;
  $('#btnStart').classList.toggle('hidden', !net.isHost);
  $('#btnStart').disabled = needMore;
  $('#btnStart span').textContent = needMore ? 'מחכים לשחקן נוסף…' : 'התחל משחק';
  $('#netNote').textContent = net.isHost && !net.offline && net.relayState === 'denied'
    ? 'חיבור הגיבוי כבוי: חברים ברשתות מסוימות לא יצליחו להצטרף עד שיעודכנו כללי ה‑Firebase (ראו README).' : '';
  $('#chainNote').textContent = net.offline ? 'מירוץ חברים, קרב ושרשרת משחקים בחדר: צרו חדר והזמינו לפחות חבר אחד.' : needMore ? 'שלחו את הקישור לחבר – המצב הזה מתחיל כשיש לפחות שני שחקנים בחדר.' : '';
  $('#lobbyWait').classList.toggle('hidden', net.isHost);
  // בחירת שלב: פתוחים כל השלבים שהושלמו ועוד אחד
  const mode = lobbyMode, open = unlocked(mode), best = mode === 'chain' ? account.profile.bestChain : mode === 'race' ? account.profile.bestRace : {};
  if (net.isHost) lobbyLevel[mode] = clamp(lobbyLevel[mode], 1, open);
  const sel = lobbyLevel[mode];
  $('#levelsTitle').textContent = `שלב ${sel} מתוך ${maxLevel(mode)}`;
  let html = '';
  const maps = isMaps(mode);
  if (maps) {
    const info = mapInfo(mode, sel);
    $('#levelsTitle').textContent = `${mode === 'battle' ? 'זירה' : 'מפה'}: ${info.name}${info.size ? ' · ' + info.size : ''}`;
    // מירוץ חברים: לשוניות של תת-קטגוריות, ובכל אחת המפות שלה
    const cats = CATS[mode], [cat] = cats ? SPLIT[mode](sel) : [0], base = cat * 100, count = cats ? cats[cat].count : maxLevel(mode);
    if (cats) html += '<div class="tabs">' + cats.map((c, k) => (mode === 'vs' && k === 2 ? '' : `<button class="tab${k === cat ? ' on' : ''}" data-cat="${k}" ${net.isHost ? '' : 'disabled'}>${c.n}</button>`)).join('') + '</div>';
    for (let i = 1; i <= count; i++) {
      const inf = mapInfo(mode, base + i);
      if (mode === 'vs' && cat === 0 && i % 10 === 1) html += `<h4>מסלולים ${['קצרים', 'בינוניים', 'ארוכים'][(i - 1) / 10]}</h4>`;
      html += `<button class="map${base + i === sel ? ' on' : ''}" data-l="${base + i}" ${net.isHost ? '' : 'disabled'}><img src="${preview(mode, base + i)}" alt=""><b>${esc(inf.name)}</b></button>`;
    }
  } else for (let i = 1; i <= maxLevel(mode); i++) {
    const lock = i > open;
    html += `<button class="map lvc${i === sel ? ' on' : ''}${lock ? ' lock' : ''}${best[i] ? ' done' : ''}" data-l="${i}" ${!net.isHost || lock ? 'disabled' : ''}><img src="${preview(mode, i)}" alt="" loading="lazy"><b>${lock ? '🔒 ' : ''}שלב ${i}${best[i] ? ' · ' + fmt(best[i]) : ''}</b></button>`;
  }
  $('#levels').className = 'maps';
  $('#levels').innerHTML = html;
  $('#levels').querySelectorAll('.tab').forEach((b) => (b.onclick = () => { lobbyLevel[lobbyMode] = Number(b.dataset.cat) * 100 + 1; net.syncLobby(); }));
  $('#levels').querySelectorAll('.lv, .map').forEach((b) => (b.onclick = () => { lobbyLevel[lobbyMode] = Number(b.dataset.l); net.syncLobby(); }));
  if (renderLobby.last !== mode + sel) { renderLobby.last = mode + sel; $('#levels').querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }
}

// בוטים: המארח מוסיף עד שלושה ובוחר לכל אחד רמת קושי 1–7
function renderBots() {
  const box = $('#bots');
  if (!net.isHost || net.offline) { box.innerHTML = ''; return; }
  const bots = net.bots, opts = (l) => [1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === l ? 'selected' : ''}>רמה ${n}</option>`).join('');
  box.innerHTML = bots.map((b) => `<div class="botRow"><span>🤖 ${esc(b.name)}</span><select data-id="${b.id}">${opts(b.lvl)}</select><button data-id="${b.id}" title="הסר">✕</button></div>`).join('')
    + (bots.length < 3 && net.players.length < 8 ? '<button id="btnAddBot">+ הוסף בוט</button>' : '');
  box.querySelectorAll('select').forEach((s) => (s.onchange = () => net.setBot(Number(s.dataset.id), Number(s.value))));
  box.querySelectorAll('.botRow button').forEach((b) => (b.onclick = () => net.removeBot(Number(b.dataset.id))));
  const add = $('#btnAddBot');
  if (add) add.onclick = () => {
    const used = new Set(net.players.map((p) => p.name)), i = BOT_NAMES.findIndex((n) => !used.has(n));
    net.addBot(BOT_NAMES[Math.max(0, i)], botSkin(Math.max(0, i) + net.nextId), 4);
  };
}

function enterLobby() {
  show('lobby');
  renderLobby();
  refreshShowroom();
}

function startGame(mode, level, startAt) {
  sfx.init();
  if (game) game.dispose();
  currentGame = { mode, level, startAt };
  game = new Game(mode, level, startAt);
  $('#results').classList.add('hidden');
  $('#pause').classList.add('hidden');
  input.enabled = true;
  show('game');
}

// ----- חיפוש קבוצה: מצטרפים לחדר ציבורי פתוח, ואם אין – פותחים אחד ומחכים -----
let seeking = false;
function joined(w) {
  $('#menuErr').textContent = '';
  lobbyMode = MAXL[w.mode] ? w.mode : 'race';
  lobbyLevel[lobbyMode] = w.level || 1;
  enterLobby();
  if (net.viaRelay) toast('מחוברים דרך שרת ממסר – החיבור הישיר נחסם ברשת של אחד מכם', 5000);
  shareLb();
  if (w.game) startGame(w.game.mode, w.game.level || 1, w.game.startAt);
}
async function tryJoinPublic(exclude) {
  let list = [];
  try { list = await Net.findPublic(exclude); } catch { /* אין רשימה – ממשיכים לפתיחת חדר */ }
  for (const c of list.slice(0, 3)) {
    try { const w = await net.join(c.code, me); joined(w); toast(`הצטרפת לקבוצה של ${c.h || 'שחקן'}`, 4000); return true; } catch { /* החדר נסגר בינתיים – מנסים את הבא */ }
  }
  return false;
}
async function openPublicRoom() {
  await net.host(me);
  net.setPublic(true, false);
  seeking = true;
  $('#menuErr').textContent = '';
  pickNext();
  enterLobby();
}
async function findGroup() {
  readName(); sfx.init();
  if (!net.canMatch) { $('#menuErr').textContent = 'חיפוש קבוצה לא זמין בגרסה הזו'; return; }
  $('#menuErr').textContent = 'מחפש קבוצה…';
  if (await tryJoinPublic()) return;
  $('#menuErr').textContent = 'לא נמצאה קבוצה פתוחה – פותח חדר ציבורי…';
  try { await openPublicRoom(); toast('פתחנו לך חדר ציבורי – מי שיחפש קבוצה יצטרף אליו', 6000); } catch (e) { $('#menuErr').textContent = errText(e); }
}
// שני שחקנים שחיפשו באותו רגע פתחו כל אחד חדר: מי שלבד עובר לחדר השני (זה עם הקוד הקטן יותר נשאר)
let merging = false;
setInterval(async () => {
  if (net.isHost && net.isPublic) net.publish(!!game);
  if (!seeking || merging || !net.isHost || !net.isPublic || game || screen !== 'lobby') return;
  if (net.players.filter((p) => !p.bot).length > 1) { seeking = false; return; }
  merging = true;
  try {
    const mine = net.code, list = await Net.findPublic(mine);
    const target = list.find((c) => c.n > 1 || c.code < mine);
    if (target && net.code === mine && net.players.filter((p) => !p.bot).length === 1 && screen === 'lobby') {
      net.leave();
      try { const w = await net.join(target.code, me); seeking = false; joined(w); toast(`הצטרפת לקבוצה של ${target.h || 'שחקן'}`, 4000); }
      catch { try { await openPublicRoom(); } catch { show('menu'); refreshShowroom(); } }
    }
  } catch { /* ננסה שוב בסיבוב הבא */ }
  merging = false;
}, 8000);

function hostStart(mode, level) {
  if (!net.isHost) return;
  if (mode !== 'race' && (net.offline || net.players.length < 2)) { toast('המצב הזה דורש חדר עם שני שחקנים לפחות'); toLobby(); return; }
  // מירוצי הקרח שייכים למיני גיימס, אבל בפועל הם מירוץ חברים רגיל על מסלול קרח
  if (mode === 'vs' && Math.floor(level / 100) === 2) { mode = 'mini'; level = 300 + (level % 100); }
  level = clamp(level, 1, maxLevel(mode));
  lobbyMode = mode; lobbyLevel[mode] = level;
  if (mode === 'mini' && Math.floor(level / 100) === 3) { mode = 'vs'; level = 200 + (level % 100); }
  const startAt = net.now() + 4200;
  currentGame = { mode, level, startAt };
  net.hostCmd({ t: 'start', mode, level, startAt });
  if (net.isPublic) net.publish(true);
  startGame(mode, level, startAt);
}

function toLobby() {
  setTimeout(() => { if (net.isHost && net.isPublic) net.publish(false); }, 0);
  if (game) { game.dispose(); game = null; }
  currentGame = null;
  enterLobby();
}

function quitToMenu() {
  if (game) { game.dispose(); game = null; }
  currentGame = null;
  net.leave();
  show('menu');
  refreshShowroom();
}

function fillResults() {
  if (!game) return;
  const st = game.standings(), c = game.credit, chain = game.mode === 'chain', maps = isMaps(game.mode);
  let info = '';
  if (maps) {
    // פודיום לשלושת הראשונים
    $('#resTitle').textContent = game.mini ? `${mapInfo('mini', game.lvl).size} – תוצאות` : game.battle ? 'הקרב נגמר!' : `${mapInfo('vs', game.lvl).name} – תוצאות`;
    const val = (x) => (game.mini === 'crown' ? `${Math.floor(x.kos / 10)} נק'` : game.mini === 'tag' ? (x.out ? `נתפס · תפס ${x.kos}` : 'לא נתפס!') : game.mini === 'floor' ? (x.out ? fmt(x.out) : 'שרד!') : game.battle ? `${x.kos} הפלות` : x.fin ? fmt(x.fin) : 'לא סיים');
    const col = (x) => esc(net.players.find((pl) => pl.id === x.id)?.skin?.color || '#19b5ff');
    const step = (i) => (st[i] ? `<div class="pd p${i + 1}${st[i].me ? ' me' : ''}"><u style="background:${col(st[i])}"></u><b>${esc(st[i].name)}</b><small>${val(st[i])}</small><i>${i + 1}</i></div>` : `<div class="pd p${i + 1} none"><i>${i + 1}</i></div>`);
    $('#resList').innerHTML = `<div class="podium">${step(1)}${step(0)}${step(2)}</div>` + st.slice(3).map((x, i) => `<li value="${i + 4}">${esc(x.name)}<span>${val(x)}</span></li>`).join('');
    if (c && c.bots) info = `<div class="pb">מקום ${c.place}</div><div class="xp" dir="ltr">+${c.xp} XP</div><small>במשחק מול בוטים בלבד לא מקבלים גביעים ומטבעות.</small>`;
    else if (c) info = `<div class="pb">מקום ${c.place}</div><div class="xp" dir="ltr">+${c.tr} 🏆 · +${c.coins} 🪙 · +${c.xp} XP</div>` + (c.saved ? '' : '<small>נשמר בדפדפן הזה. הירשמו כדי להופיע בטבלת השיאים.</small>');
  } else if (chain) {
    const done = st.every((x) => x.fin);
    $('#resTitle').textContent = done ? `שלב ${game.lvl} – עברתם יחד!` : 'תוצאות';
    $('#resList').innerHTML = done
      ? `<li>זמן קבוצתי<span>${fmt(game.teamTime || Math.max(...st.map((x) => x.fin)))}</span></li>` + st.map((x) => `<li>${esc(x.name)}</li>`).join('')
      : st.map((x) => `<li>${esc(x.name)}<span>${x.fin ? 'בסיום' : 'בדרך'}</span></li>`).join('');
  } else {
    $('#resTitle').textContent = `שלב ${game.lvl} – תוצאות`;
    $('#resList').innerHTML = st.map((x) => `<li>${esc(x.name)}<span>${x.fin ? fmt(x.fin) : 'עדיין במירוץ'}</span></li>`).join('');
  }
  // שיא אישי, XP, גביעים ומטבעות
  if (maps) { /* כבר מולא */ } else if (c) {
    const best = (chain ? account.profile.bestChain : account.profile.bestRace)[game.lvl];
    if (c.first) info += '<div class="pb">שלב חדש הושלם!</div>';
    else if (c.newPb) info += `<div class="pb">שיא אישי חדש! (הקודם: ${fmt(c.prev)})</div>`;
    else info += `<div>השיא האישי שלך: ${fmt(best)}</div>`;
    info += `<div class="xp" dir="ltr">+${c.xp} XP${c.tr ? ` · +${c.tr} 🏆` : ''} · +${c.coins} 🪙</div>${xpHtml()}`;
    if (!c.saved) info += '<small>נשמר בדפדפן הזה. הירשמו בתפריט הראשי כדי להופיע בטבלת השיאים.</small>';
  } else if (chain && game.teamDone) info = '<small>שיחקת לבד, אז זה נחשב אימון. שחקו בשניים כדי להתקדם בשלבי השרשרת.</small>';
  $('#resInfo').innerHTML = info;
  const canNext = !maps && net.isHost && game.lvl < maxLevel(game.mode) && game.lvl < unlocked(game.mode);
  $('#btnNext').classList.toggle('hidden', !canNext);
  $('#btnRetry').classList.toggle('hidden', !net.isHost);
  $('#btnRetry span').textContent = maps ? 'סיבוב נוסף' : 'שוב את השלב הזה';
  $('#btnResLobby').classList.toggle('hidden', !net.isHost);
  $('#btnResLobby span').textContent = maps ? 'בחירת מפה אחרת' : 'חזרה ללובי';
  $('#btnResClose span').textContent = maps ? (net.isHost ? 'סגור' : 'ממתינים למארח… (סגור)') : 'המשך לנהוג';
}
function showResults() { fillResults(); $('#results').classList.remove('hidden'); }

function setPause(on) {
  if (!game) return;
  $('#pause').classList.toggle('hidden', !on);
  input.enabled = !on;
  $('#btnToLobby').classList.toggle('hidden', !net.isHost);
  $('#btnQuality span').textContent = 'גרפיקה: ' + (settings.quality === 'high' ? 'גבוהה' : 'מהירה');
  $('#btnSound span').textContent = 'סאונד: ' + (settings.sound ? 'פועל' : 'כבוי');
  $('#btnMusic span').textContent = 'מוזיקה: ' + (settings.music ? 'פועלת' : 'כבויה');
}

// אירועי כפתורים
$('#name').value = me.name;
$('#btnCreate').onclick = async () => {
  readName(); sfx.init();
  $('#menuErr').textContent = 'יוצר חדר…';
  try { await net.host(me); $('#menuErr').textContent = ''; pickNext(); enterLobby(); } catch (e) { $('#menuErr').textContent = errText(e); }
};
$('#btnJoin').onclick = async () => {
  readName(); sfx.init();
  const code = $('#code').value.trim().toUpperCase();
  if (code.length < 4) { $('#menuErr').textContent = 'הקלידו קוד חדר'; return; }
  $('#menuErr').textContent = 'מתחבר…';
  try {
    joined(await net.join(code, me));
  } catch (e) { $('#menuErr').textContent = errText(e); }
};
$('#btnFind').onclick = findGroup;
$('#btnPublic').onclick = () => { if (!net.isHost) return; net.setPublic(!net.isPublic, !!game); seeking = false; renderLobby(); toast(net.isPublic ? 'החדר ציבורי – שחקנים שמחפשים קבוצה יכולים להצטרף' : 'החדר פרטי – רק עם הקוד או הקישור', 4000); };
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#btnSolo').onclick = () => { readName(); sfx.init(); net.solo(me); pickNext(); enterLobby(); };
$('#btnGarage').onclick = () => { readName(); openGarage('menu'); };
$('#btnLobbyGarage').onclick = () => openGarage('lobby');
$('#btnGarageDone').onclick = () => { if (garageFrom === 'lobby') enterLobby(); else { show('menu'); refreshShowroom(); } };
$('#btnLeave').onclick = quitToMenu;
$('#btnCopy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${net.code}`;
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק – שלחו לחברים'); } catch { toast(url, 6000); }
};
document.querySelectorAll('.mode').forEach((b) => (b.onclick = () => { if (net.isHost) { lobbyMode = b.dataset.mode; net.syncLobby(); } }));
$('#btnStart').onclick = () => hostStart(lobbyMode, lobbyLevel[lobbyMode]);
$('#btnNext').onclick = () => { if (game) hostStart(game.mode, game.lvl + 1); };
$('#btnRetry').onclick = () => { if (game) hostStart(game.mode, game.lvl); };
$('#btnLb').onclick = () => openLb('menu');
$('#btnLbBack').onclick = () => {
  if (lbFrom === 'game' && game) { $('#lb').classList.add('hidden'); input.enabled = true; }
  else if (lbFrom === 'lobby' && net.players.length) enterLobby(); else show('menu');
};
$('#btnPauseLb').onclick = () => openLb('game');
$('#btnLobbyLb').onclick = () => openLb('lobby');
document.querySelectorAll('#lb .tab').forEach((t) => (t.onclick = () => { lbTab = t.dataset.tab; renderLb(); }));
$('#lbLevel').innerHTML = Array.from({ length: RACE_LEVELS }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
$('#lbLevel').onchange = renderLb;
document.querySelectorAll('#emotes button').forEach((b) => (b.onclick = () => { if (game) game.emote(Number(b.dataset.e)); b.blur(); }));
$('#btnLogin').onclick = () => doAuth('login');
$('#btnRegister').onclick = () => doAuth('register');
$('#btnAuthBack').onclick = () => show('menu');
$('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });
// המארח מתחיל מהשלב הבא שעוד לא הושלם
function pickNext() { lobbyLevel.race = unlocked('race'); lobbyLevel.chain = unlocked('chain'); }
// במצב מקומי: מחליפים טבלאות שיאים עם מי שבחדר
let lbShared = 0;
function shareLb() {
  if (account.online || net.offline || net.players.length < 2 || net.players.length === lbShared) return;
  lbShared = net.players.length;
  net.sendEvent({ k: 'lb', data: account.exportLb() });
}
const hostToLobby = () => { if (!net.isHost) return; currentGame = null; net.hostCmd({ t: 'lobby' }); toLobby(); };
$('#btnResLobby').onclick = hostToLobby;
$('#btnToLobby').onclick = hostToLobby;
$('#btnResClose').onclick = () => $('#results').classList.add('hidden');
$('#btnResume').onclick = () => setPause(false);
$('#btnRespawn').onclick = () => { setPause(false); if (game && !game.battle) { if (game.mode === 'chain') game.teamRespawn(true); else game.respawn(); } };
$('#btnQuit').onclick = quitToMenu;
$('#btnQuality').onclick = () => {
  settings.quality = settings.quality === 'high' ? 'low' : 'high';
  store.set('quality', settings.quality);
  if (game) game.sun.castShadow = settings.quality === 'high';
  resize();
  setPause(true);
};
$('#btnMusic').onclick = () => { settings.music = !settings.music; store.set('music', settings.music); sfx.setMusic(settings.music); setPause(true); };
$('#btnRoad').onclick = () => { readName(); show('road'); renderRoad(); };
$('#btnShop').onclick = () => { readName(); show('shop'); renderShop(); };
$('#btnRoadBack').onclick = () => { show('menu'); endPreview(); };
$('#btnShopBack').onclick = () => { show('menu'); endPreview(); };
$('#btnSound').onclick = () => { settings.sound = !settings.sound; store.set('sound', settings.sound); sfx.setEnabled(settings.sound); setPause(true); };
$('#tMenu').onclick = () => setPause(true);
$('#item').onclick = () => input.pressed.add('TouchItem');
addEventListener('keydown', (e) => {
  if (game && input.enabled && /^Digit[1-5]$/.test(e.code) && e.target.tagName !== 'INPUT' && !e.repeat) game.emote(Number(e.code.slice(5)) - 1);
  if (e.code === 'Escape' && game) setPause($('#pause').classList.contains('hidden'));
  if (e.code === 'KeyM' && game && e.target.tagName !== 'INPUT') { settings.sound = !settings.sound; sfx.setEnabled(settings.sound); }
});

addEventListener('gamepadconnected', () => toast('שלט מחובר: מקל – היגוי · RT – גז · LT – ברקס · A – קפיצה · B – ניטרו', 6000));
addEventListener('gamepaddisconnected', () => toast('השלט התנתק'));

// אירועי רשת
net.getInfo = () => ({ mode: lobbyMode, level: lobbyLevel[lobbyMode], game: currentGame });
net.on('players', (m) => {
  if (net.isHost && net.isPublic) net.publish(!!game);
  if (!net.isHost && MAXL[m.mode]) { lobbyMode = m.mode; lobbyLevel[m.mode] = m.level || 1; }
  shareLb();
  if (screen === 'lobby') renderLobby();
  if (screen === 'lobby' || screen === 'garage') refreshShowroom();
  if (game) game.syncPlayers();
});
net.on('start', (m) => startGame(m.mode, m.level || 1, m.startAt));
net.on('lobby', () => toLobby());
net.on('state', (id, d) => { if (game) game.remotes.get(id)?.onState(d, game); });
net.on('ev', (m) => { if (m.k === 'lb') account.mergeLb(m.data); else if (game) game.onEvent(m); });
net.on('closed', () => { toast('החיבור למארח נותק'); quitToMenu(); });
const origLeave = net.leave.bind(net);
net.leave = () => { lbShared = 0; origLeave(); };

// ---------- הפעלה ----------
const room = new URLSearchParams(location.search).get('room');
if (room) { $('#code').value = room.toUpperCase().slice(0, 5); toast('הקלידו שם ולחצו "הצטרף"', 5000); }
resize();
loadUserSkin();
renderAccount();
account.restore();
show('menu');
refreshShowroom();
window.__nlReady = true;
$('#loading').classList.add('hidden');

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game) { game.frame(dt); render(game.scene); } else { showroom.update(dt); render(showroom.scene); }
  if (!game) input.read(); // כדי שכפתור התפריט בשלט יעבוד גם כשהקלט מושבת
  if (input.menu && game) setPause($('#pause').classList.contains('hidden'));
  input.endFrame();
}
requestAnimationFrame(loop);

// לבדיקות ולדיבוג מהקונסול
window.__nl = { get game() { return game; }, net, input, me, startGame, renderer, bloom, settings, camera, account };
