// NITRO LINK – הקובץ הראשי: רינדור, לולאת המשחק, מצלמה, HUD, לובי ומוסך
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CarPhysics, CarVisual, carShape, addForce, P as CP, DEFAULT_SKIN, SKIN_OPTS, G_CAR, G_REMOTE } from './car.js';
import { buildLevel, CHAIN_LEN, RACE_LEVELS, CHAIN_LEVELS } from './level.js';
import { Account, rankOf, AuthError } from './account.js';
import { Sky, Particles, ChainVisual, tex } from './fx.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';

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

const settings = { quality: store.get('quality', 'high'), sound: store.get('sound', true) };
const me = { name: store.get('name', ''), skin: { ...DEFAULT_SKIN, ...store.get('skin', {}) } };
me.uid = null;
const account = new Account();
const net = new Net();
const input = new Input();
const sfx = new Sfx(settings.sound);
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
    this.cars.forEach((c, i) => { c.group.rotation.y = this.t * 0.45 + i * 0.7; c.update(0.25 * Math.sin(this.t), null, this.t * 2, false, this.t); });
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
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.np = new THREE.Vector3(); this.nq = new THREE.Quaternion(); this.nv = new THREE.Vector3();
    this.attach = new THREE.Vector3();
    this.has = false; this.age = 0; this.cp = 0; this.prog = 0; this.fin = 0; this.boosting = false; this.spin = 0;
    this.supported = true; this.cv = new THREE.Vector3();
  }

  onState(d, game) {
    this.np.set(d[0], d[1], d[2]);
    this.nq.set(d[3], d[4], d[5], d[6]).normalize();
    this.nv.set(d[7], d[8], d[9]);
    this.boosting = !!(d[10] & 1);
    this.supported = !(d[10] & 2);
    this.cp = d[11]; this.prog = d[12]; this.fin = d[13];
    this.age = 0;
    if (!this.has || this.pos.distanceTo(this.np) > 14) { this.pos.copy(this.np); this.quat.copy(this.nq); }
    if (!this.has) { this.has = true; this.vis.group.visible = true; game.world.addBody(this.body); }
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
    if (this.has) game.world.removeBody(this.body);
  }
}

// ---------- המשחק ----------
const H = 1 / 120;
const CHAIN_K = 6000, CHAIN_C = 900;
const ATT = new CANNON.Vec3(0, 0.3, 0), cr = new CANNON.Vec3(), cv = new CANNON.Vec3(), cf = new CANNON.Vec3();
const hud = {
  timer: $('#timer'), rank: $('#rank'), board: $('#board'), ring: $('#ring'), spd: $('#spd'),
  chain: $('#chainHud'), height: $('#height'), tension: $('#tension'), msg: $('#msg'), count: $('#countdown'),
};
let msgTimer = 0;
function showMsg(text, ms = 1600) {
  hud.msg.textContent = text;
  hud.msg.classList.add('show');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => hud.msg.classList.remove('show'), ms);
}

class Game {
  constructor(mode, level, startAt) {
    this.mode = mode; this.startAt = startAt; this.credit = null; this.teamTime = 0;
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

    this.level = buildLevel(mode, level, { scene, world, groundMat, kinMat, solo: net.players.length < 2 });
    this.lvl = this.level.level;
    const [top, mid, bot] = this.level.sky;
    this.sky = new Sky(scene, top, mid, bot);
    scene.fog = new THREE.Fog(mid, 260, 1500);
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3a80, 0.9));
    this.sun = new THREE.DirectionalLight(0xfff0dc, 2.0);
    this.sun.castShadow = settings.quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    const grid = new THREE.GridHelper(6000, 150, 0x19d3ff, mode === 'chain' ? 0x8a3fd0 : 0x2a5fd0);
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
    this.syncPlayers();
    this.respawn();
    hud.chain.classList.toggle('hidden', mode !== 'chain');
    hud.rank.classList.toggle('hidden', mode !== 'race');
    $('#lvlTag').textContent = (mode === 'chain' ? 'שרשרת · ' : '') + 'שלב ' + this.lvl;
  }

  syncPlayers() {
    const ids = new Set(net.players.map((p) => p.id));
    for (const [id, r] of this.remotes) if (!ids.has(id)) { r.dispose(this); this.remotes.delete(id); }
    for (const p of net.players) if (p.id !== net.myId && !this.remotes.has(p.id)) this.remotes.set(p.id, new Remote(this, p));
    this.order = [...ids].sort((a, b) => a - b);
    this.slot = Math.max(0, this.order.indexOf(net.myId));
    this.neighbors = [this.order[this.slot - 1], this.order[this.slot + 1]].filter((x) => x !== undefined);
    for (const c of this.chains) c.vis.dispose();
    this.chains = [];
    if (this.mode === 'chain') for (let i = 0; i + 1 < this.order.length; i++) this.chains.push({ a: this.order[i], b: this.order[i + 1], vis: new ChainVisual(this.scene, CHAIN_LEN) });
  }

  respawn() {
    const s = this.level.spawn(this.cp, this.slot, this.order.length);
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
    showMsg('חוזרים לנקודת הביקורת');
  }

  fall() {
    sfx.fall();
    if (this.mode === 'chain') this.teamRespawn(true); else this.respawn();
  }

  onEvent(m) { if (m.k === 'rs' && this.mode === 'chain') this.teamRespawn(false); }

  applyChain() {
    const car = this.car, b = car.body;
    let maxT = 0;
    b.quaternion.vmult(ATT, cr);
    for (const nid of this.neighbors) {
      const r = this.remotes.get(nid);
      if (!r || !r.has) continue;
      const dx = r.attach.x - b.position.x - cr.x, dy = r.attach.y - b.position.y - cr.y, dz = r.attach.z - b.position.z - cr.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > CHAIN_LEN * 2.5 || dist < 1e-3) continue;
      const stretch = dist - CHAIN_LEN;
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
      const F = clamp(CHAIN_K * stretch * soft + CHAIN_C * Math.max(rate, 0), 0, CP.mass * 110);
      addForce(b, cf.set(ux * F, uy * F, uz * F), cr);
      if (stretch > 2.2 && rate > 0) { b.velocity.x += ux * rate * 0.5; b.velocity.y += uy * rate * 0.5; b.velocity.z += uz * rate * 0.5; }
    }
    this.tension = maxT;
  }

  progress() {
    const cps = this.level.cps, cur = cps[this.cp].pos;
    const next = this.cp + 1 < cps.length ? cps[this.cp + 1].pos : this.level.finish.pos;
    const total = cur.distanceTo(next) || 1;
    return this.cp * 1000 + (clamp(total - this.phys.distanceTo(next), 0, total) / total) * 999;
  }

  standings() {
    const list = [{ id: net.myId, name: me.name || 'אני', fin: this.fin, prog: this.fin ? 1e9 : this.progress(), me: true }];
    for (const r of this.remotes.values()) list.push({ id: r.id, name: r.name, fin: r.fin, prog: r.fin ? 1e9 : r.prog });
    return list.sort((a, b) => (a.fin && b.fin ? a.fin - b.fin : b.prog - a.prog));
  }

  frame(dt) {
    this.time += dt;
    const tRace = (net.now() - this.startAt) / 1000;
    const locked = tRace < 0;
    const inp = input.read();
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
      car.step(H, inp, locked);
      if (car.didJump) sfx.jump();
      if (this.mode === 'chain') this.applyChain();
      this.world.step(H);
    }
    this.phys.copy(body.position);
    const p = this.phys;

    // משטחי בוסט
    for (const pd of level.pads) {
      pd.cd -= dt;
      if (pd.cd <= 0 && level.inPad(pd, p)) {
        pd.cd = 1;
        car.boost = 100;
        const along = body.velocity.x * pd.f.x + body.velocity.z * pd.f.z;
        const kick = clamp(46 - along, 0, 12);
        body.velocity.x += pd.f.x * kick; body.velocity.z += pd.f.z * kick;
        sfx.pad();
      }
    }
    // נקודות ביקורת, סיום ונפילה
    for (let i = level.cps.length - 1; i > this.cp; i--) {
      if (level.inZone(level.cps[i], p)) { this.cp = i; sfx.checkpoint(); showMsg('נקודת ביקורת!'); break; }
    }
    if (this.mode === 'chain') for (const r of this.remotes.values()) if (r.cp > this.cp) { this.cp = r.cp; showMsg('נקודת ביקורת!'); }
    if (!this.fin && !locked && level.inZone(level.finish, p)) {
      this.fin = Math.max(1, Math.round(tRace * 1000));
      sfx.finish();
      if (this.mode === 'race') {
        this.credit = account.finishRace(this.lvl, this.fin);
        showMsg((this.credit.newPb && !this.credit.first ? 'שיא חדש! ' : 'סיימת! ') + fmt(this.fin), 3000);
        setTimeout(() => { if (game === this) showResults(); }, 1500);
      } else showMsg(this.remotes.size ? 'הגעת! מחכים לשאר הקבוצה…' : 'סיימת! ' + fmt(this.fin), 3000);
    }
    if (this.mode === 'chain' && this.fin && !this.teamDone && [...this.remotes.values()].every((r) => r.fin)) {
      this.teamDone = true;
      this.teamTime = Math.max(this.fin, ...[...this.remotes.values()].map((r) => r.fin));
      // שלב בשרשרת נחשב רק כשמשחקים אותו לפחות שניים
      if (this.remotes.size) this.credit = account.finishChain(this.lvl, this.teamTime, net.players.map((pl) => ({ name: pl.name, uid: pl.uid })));
      setTimeout(() => { if (game === this) showResults(); }, 1200);
    }
    if (p.y < level.killY) this.fall();
    else if (inp.respawn && !locked) { if (this.mode === 'chain') this.teamRespawn(true); else this.respawn(); }

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
    if (car.boosting) emit(this.pos, this.quat, body.velocity, this.vis.trailColor);
    for (const r of this.remotes.values()) if (r.has && r.boosting) emit(r.pos, r.quat, r.nv, r.vis.trailColor);
    this.particles.update(dt);

    // שרשראות
    for (const c of this.chains) {
      const a = this.attachOf(c.a, _v), b = this.attachOf(c.b, _v2);
      c.vis.update(a || _v, b || _v2, !!(a && b) && _v.distanceTo(_v2) < CHAIN_LEN * 2.5);
    }

    level.update(dt, this.cp);
    this.updateCamera(dt);
    this.sun.position.set(this.pos.x + 12, this.pos.y + 90, this.pos.z - 45);
    this.sun.target.position.copy(this.pos);
    this.sky.update(camera);
    const speed = body.velocity.length();
    sfx.engine(speed, inp.throttle, car.boosting, true);

    // שליחת מצב לרשת
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 30;
      const q = body.quaternion, v = body.velocity, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
      net.sendState([r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(v.x), r2(v.y), r2(v.z), (car.boosting ? 1 : 0) | (car.supported ? 0 : 2), this.cp, Math.round(this.progress()), this.fin]);
    }

    this.updateHud(dt, tRace, speed);
  }

  attachOf(id, out) {
    if (id === net.myId) return out.set(0, 0.3, 0).applyQuaternion(this.quat).add(this.pos);
    const r = this.remotes.get(id);
    return r && r.has ? out.copy(r.attach) : null;
  }

  updateCamera(dt) {
    const v = this.car.body.velocity, hs = Math.hypot(v.x, v.z);
    _v.set(0, 0, 1).applyQuaternion(this.quat);
    let yawT = this.camYaw;
    if (this.car.grounded >= 2) { if (Math.hypot(_v.x, _v.z) > 0.3) yawT = Math.atan2(_v.x, _v.z); } else if (hs > 6) yawT = Math.atan2(v.x, v.z);
    let d = yawT - this.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * (1 - Math.exp(-dt * 5));
    const sp = v.length(), dist = 8.5 + sp * 0.06, sn = Math.sin(this.camYaw), cs = Math.cos(this.camYaw);
    this.camPos.x = this.pos.x - sn * dist;
    this.camPos.z = this.pos.z - cs * dist;
    this.camPos.y += (this.pos.y + 3.5 - this.camPos.y) * (1 - Math.exp(-dt * 7));
    camera.position.copy(this.camPos);
    camera.lookAt(this.pos.x + sn * 5, this.pos.y + 1.3, this.pos.z + cs * 5);
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
    hud.timer.textContent = fmt(this.fin || Math.max(0, tRace * 1000));
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
      if (this.mode === 'race') hud.rank.innerHTML = `${st.findIndex((x) => x.me) + 1}<small>/${st.length}</small>`;
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
  }
}

// ---------- ממשק ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const showroom = new Showroom();
let game = null, currentGame = null, lobbyMode = 'race', screen = 'menu', garageFrom = 'menu';
const lobbyLevel = { race: 1, chain: 1 };
const maxLevel = (mode) => (mode === 'chain' ? CHAIN_LEVELS : RACE_LEVELS);
const unlocked = (mode) => Math.min(maxLevel(mode), (account.profile[mode] || 0) + 1);

function toast(text, ms = 2600) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function show(name) {
  screen = name;
  for (const s of ['menu', 'garage', 'lobby', 'auth', 'lb']) $('#' + s).classList.toggle('hidden', s !== name);
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
function renderAccount() {
  const box = $('#acct'), r = rankOf(account.profile.xp || 0);
  const badge = `<span class="rankBadge">רמה ${r.lvl} · ${r.title}</span>`;
  if (account.loggedIn) {
    box.innerHTML = `<div class="top"><b>${esc(account.user.name)}</b>${badge}<button id="btnLogout" class="chip">התנתק</button></div>${xpHtml()}`;
    $('#btnLogout').onclick = () => { account.logout(); };
    $('#name').value = account.user.name;
  } else {
    box.innerHTML = `<div class="top">${account.profile.xp ? badge : '<b>אורח</b>'}<button id="btnAuth" class="chip">התחברות / הרשמה</button></div>`
      + (account.profile.xp ? xpHtml() : '') + '<small>הירשמו כדי לשמור התקדמות ולהופיע בטבלת השיאים</small>';
    $('#btnAuth').onclick = () => { $('#authErr').textContent = ''; $('#authName').value = $('#name').value.trim(); $('#authPass').value = ''; show('auth'); };
  }
  $('#name').readOnly = account.loggedIn;
  $('#authNote').textContent = account.online
    ? 'שם המשתמש יופיע בטבלת השיאים העולמית. ההתקדמות, השיאים וה‑XP נשמרים בחשבון.'
    : 'החשבון נשמר במכשיר הזה. טבלת השיאים מתעדכנת בין חברים שמשחקים יחד באותו חדר.';
}
account.onChange = () => { readName(); renderAccount(); if (screen === 'lobby') renderLobby(); };
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
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === lbTab));
  const list = $('#lbList');
  if (!lbData) { list.innerHTML = '<li>טוען…</li>'; return; }
  const rows = lbData[lbTab], myName = account.loggedIn ? account.user.name : null;
  if (!rows.length) list.innerHTML = '<li>עדיין אין כאן אף אחד. סיימו שלב כשאתם מחוברים לחשבון כדי להופיע ראשונים!</li>';
  else if (lbTab === 'race') list.innerHTML = rows.map((e, i) => `<li class="${e.name === myName ? 'me' : ''}"><span class="n">${i + 1}</span>${esc(e.name)}<span class="v"><em>${e.xp} XP</em><b>שלב ${e.level}</b></span></li>`).join('');
  else list.innerHTML = rows.map((e, i) => `<li class="${myName && e.names.split(' + ').includes(myName) ? 'me' : ''}"><span class="n">${i + 1}</span>${esc(e.names)}<span class="v"><em>${fmt(e.time)}</em><b>שלב ${e.level}</b></span></li>`).join('');
  $('#lbNote').textContent = account.online ? '' : 'הטבלה שמורה במכשיר ומתמזגת עם חברים שמשחקים איתכם באותו חדר.';
}
async function openLb() {
  lbData = null;
  show('lb');
  renderLb();
  try { lbData = await account.leaderboard(); } catch { lbData = { race: [], chain: [] }; }
  renderLb();
}

function errText(e) {
  const t = e?.type || e?.message || '';
  if (t === 'peer-unavailable') return 'לא נמצא חדר עם הקוד הזה';
  if (t === 'full') return 'החדר מלא';
  if (t === 'nolib') return 'ספריית הרשת לא נטענה – בדקו את החיבור לאינטרנט';
  return 'בעיית חיבור, נסו שוב';
}

// מוסך
let skinTimer = 0;
function skinChanged() {
  store.set('skin', me.skin);
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
      b.className = 'chip' + (me.skin[key] === i ? ' on' : '');
      b.textContent = n;
      b.onclick = () => { me.skin[key] = i; box.querySelectorAll('.chip').forEach((c, j) => c.classList.toggle('on', j === i)); skinChanged(); };
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
  chips('גימור צבע', 'finish', SKIN_OPTS.finishes);
  colors('צבע משני', 'accent');
  chips('גלגלים', 'wheel', SKIN_OPTS.wheels);
  colors('צבע חישוקים', 'rim');
  chips('ספוילר', 'spoiler', SKIN_OPTS.spoilers);
  chips('קישוט גג', 'topper', SKIN_OPTS.toppers);
  colors('זוהר ניאון', 'glow');
  colors('שובל בוסט', 'trail');
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
  $('#players').innerHTML = net.players.map((p) => `<li><i style="background:${esc(p.skin?.color || '#fff')}"></i>${esc(p.name)}<em>${p.id === 0 ? 'מארח' : ''}${p.id === net.myId ? ' (אני)' : ''}</em></li>`).join('');
  document.querySelectorAll('.mode').forEach((b) => { b.classList.toggle('on', b.dataset.mode === lobbyMode); b.disabled = !net.isHost; });
  $('#btnStart').classList.toggle('hidden', !net.isHost);
  $('#lobbyWait').classList.toggle('hidden', net.isHost);
  // בחירת שלב: פתוחים כל השלבים שהושלמו ועוד אחד
  const mode = lobbyMode, open = unlocked(mode), best = mode === 'chain' ? account.profile.bestChain : account.profile.bestRace;
  if (net.isHost) lobbyLevel[mode] = clamp(lobbyLevel[mode], 1, open);
  const sel = lobbyLevel[mode];
  $('#levelsTitle').textContent = `שלב ${sel} מתוך ${maxLevel(mode)}` + (mode === 'chain' && net.players.length < 2 ? ' · לבד זה רק אימון – שלב נחשב כשמשחקים בשניים' : '');
  let html = '';
  for (let i = 1; i <= maxLevel(mode); i++) {
    const lock = i > open;
    html += `<button class="lv${i === sel ? ' on' : ''}${lock ? ' lock' : ''}${best[i] ? ' done' : ''}" data-l="${i}" ${!net.isHost || lock ? 'disabled' : ''}><b>${i}</b><small>${best[i] ? fmt(best[i]) : lock ? '🔒' : ''}</small></button>`;
  }
  $('#levels').innerHTML = html;
  $('#levels').querySelectorAll('.lv').forEach((b) => (b.onclick = () => { lobbyLevel[lobbyMode] = Number(b.dataset.l); net.syncLobby(); }));
  $('#levels').querySelector('.lv.on')?.scrollIntoView({ block: 'nearest' });
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
  show('game');
}

function hostStart(mode, level) {
  if (!net.isHost) return;
  level = clamp(level, 1, maxLevel(mode));
  lobbyMode = mode; lobbyLevel[mode] = level;
  const startAt = net.now() + 4200;
  currentGame = { mode, level, startAt };
  net.hostCmd({ t: 'start', mode, level, startAt });
  startGame(mode, level, startAt);
}

function toLobby() {
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
  const st = game.standings(), c = game.credit, chain = game.mode === 'chain';
  if (chain) {
    const done = st.every((x) => x.fin);
    $('#resTitle').textContent = done ? `שלב ${game.lvl} – עברתם יחד!` : 'תוצאות';
    $('#resList').innerHTML = done
      ? `<li>זמן קבוצתי<span>${fmt(game.teamTime || Math.max(...st.map((x) => x.fin)))}</span></li>` + st.map((x) => `<li>${esc(x.name)}</li>`).join('')
      : st.map((x) => `<li>${esc(x.name)}<span>${x.fin ? 'בסיום' : 'בדרך'}</span></li>`).join('');
  } else {
    $('#resTitle').textContent = `שלב ${game.lvl} – תוצאות`;
    $('#resList').innerHTML = st.map((x) => `<li>${esc(x.name)}<span>${x.fin ? fmt(x.fin) : 'עדיין במירוץ'}</span></li>`).join('');
  }
  // שיא אישי ו-XP
  let info = '';
  if (c) {
    const best = (chain ? account.profile.bestChain : account.profile.bestRace)[game.lvl];
    if (c.first) info += '<div class="pb">שלב חדש הושלם!</div>';
    else if (c.newPb) info += `<div class="pb">שיא אישי חדש! (הקודם: ${fmt(c.prev)})</div>`;
    else info += `<div>השיא האישי שלך: ${fmt(best)}</div>`;
    info += `<div class="xp">+${c.xp} XP</div>${xpHtml()}`;
    if (!c.saved) info += '<small>שיחקת כאורח – הירשמו בתפריט הראשי כדי לשמור התקדמות ולהופיע בטבלת השיאים.</small>';
  } else if (chain && game.teamDone) info = '<small>שיחקת לבד, אז זה נחשב אימון. שחקו בשניים כדי להתקדם בשלבי השרשרת.</small>';
  $('#resInfo').innerHTML = info;
  const canNext = net.isHost && game.lvl < maxLevel(game.mode) && game.lvl < unlocked(game.mode);
  $('#btnNext').classList.toggle('hidden', !canNext);
  $('#btnRetry').classList.toggle('hidden', !net.isHost);
  $('#btnResLobby').classList.toggle('hidden', !net.isHost);
}
function showResults() { fillResults(); $('#results').classList.remove('hidden'); }

function setPause(on) {
  if (!game) return;
  $('#pause').classList.toggle('hidden', !on);
  input.enabled = !on;
  $('#btnToLobby').classList.toggle('hidden', !net.isHost);
  $('#btnQuality span').textContent = 'גרפיקה: ' + (settings.quality === 'high' ? 'גבוהה' : 'מהירה');
  $('#btnSound span').textContent = 'סאונד: ' + (settings.sound ? 'פועל' : 'כבוי');
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
    const w = await net.join(code, me);
    $('#menuErr').textContent = '';
    lobbyMode = w.mode || 'race';
    lobbyLevel[lobbyMode] = w.level || 1;
    enterLobby();
    shareLb();
    if (w.game) startGame(w.game.mode, w.game.level || 1, w.game.startAt);
  } catch (e) { $('#menuErr').textContent = errText(e); }
};
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
$('#btnLb').onclick = openLb;
$('#btnLbBack').onclick = () => show('menu');
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => { lbTab = t.dataset.tab; renderLb(); }));
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
$('#btnRespawn').onclick = () => { setPause(false); if (game) { if (game.mode === 'chain') game.teamRespawn(true); else game.respawn(); } };
$('#btnQuit').onclick = quitToMenu;
$('#btnQuality').onclick = () => {
  settings.quality = settings.quality === 'high' ? 'low' : 'high';
  store.set('quality', settings.quality);
  if (game) game.sun.castShadow = settings.quality === 'high';
  resize();
  setPause(true);
};
$('#btnSound').onclick = () => { settings.sound = !settings.sound; store.set('sound', settings.sound); sfx.setEnabled(settings.sound); setPause(true); };
$('#tMenu').onclick = () => setPause(true);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game) setPause($('#pause').classList.contains('hidden'));
  if (e.code === 'KeyM' && game && e.target.tagName !== 'INPUT') { settings.sound = !settings.sound; sfx.setEnabled(settings.sound); }
});

// אירועי רשת
net.getInfo = () => ({ mode: lobbyMode, level: lobbyLevel[lobbyMode], game: currentGame });
net.on('players', (m) => {
  if (!net.isHost && m.mode) { lobbyMode = m.mode; lobbyLevel[m.mode] = m.level || 1; }
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
  input.endFrame();
}
requestAnimationFrame(loop);

// לבדיקות ולדיבוג מהקונסול
window.__nl = { get game() { return game; }, net, input, me, startGame, renderer, bloom, settings, camera, account };
