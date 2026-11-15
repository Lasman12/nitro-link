// בניית מסלולים: "צב" שמתקדם ומניח קטעים, רמפות, מכשולים זזים, כפתורים, שערים ומעליות
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G_WORLD, G_CAR, G_KIN } from './car.js';
import { tex } from './fx.js';

export const CHAIN_LEN = 14;

// ערכות נושא: צבעים, שמיים ותאורה. כל שלב מקבל ערכה + גוון + סוג קישוטים + ריצוף משלו, כך שאין שני שלבים זהים
const TH = [
  { n: 'ניאון', floor: 0x2c4f8f, ramp: 0xff8a2b, wall: 0x1c2c52, hazard: 0xff3355, trimA: 0x19d3ff, trimB: 0xff7a1a, sky: [0x0a1a5c, 0x6a3fb8, 0x05060f], sun: 0xfff0dc, sunI: 2.0, hemi: 0.9 },
  { n: 'לגונה', floor: 0x1f6f7a, ramp: 0xff4f9a, wall: 0x143c46, hazard: 0xffc21a, trimA: 0x3dffd0, trimB: 0xff5ab0, sky: [0x06284a, 0x2aa7a0, 0x040b12], sun: 0xe8fff8, sunI: 2.2, hemi: 1.0 },
  { n: 'הר געש', floor: 0x7a2f2f, ramp: 0xffc233, wall: 0x3a1616, hazard: 0x19d3ff, trimA: 0xff7a3d, trimB: 0xffe066, sky: [0x2a0612, 0xd0552a, 0x0a0406], sun: 0xffb070, sunI: 2.4, hemi: 0.7 },
  { n: 'קרחון', floor: 0x4a80bc, ramp: 0x2f5fe0, wall: 0x3f6a98, hazard: 0xff4fa0, trimA: 0xffffff, trimB: 0x4fd8ff, sky: [0x1a55b8, 0x7fbcf0, 0x3f70a8], sun: 0xffffff, sunI: 2.1, hemi: 0.95 },
  { n: 'מדבר', floor: 0x94702f, ramp: 0xd0452a, wall: 0x8a6a3a, hazard: 0x1e7bff, trimA: 0xfff0a0, trimB: 0xff5a1f, sky: [0x1f5fb0, 0xd89a58, 0x70501f], sun: 0xfff2d0, sunI: 2.3, hemi: 0.95 },
  { n: "ג'ונגל", floor: 0x2f6f3a, ramp: 0xffb41a, wall: 0x1c3a22, hazard: 0xff3355, trimA: 0x7dff5a, trimB: 0xffd21a, sky: [0x06301e, 0x3a9a6a, 0x030a06], sun: 0xf0ffd0, sunI: 2.0, hemi: 0.9 },
  { n: 'חלל', floor: 0x2a2a3a, ramp: 0xb14dff, wall: 0x14141e, hazard: 0x00e5ff, trimA: 0xb14dff, trimB: 0x00e5ff, sky: [0x000005, 0x0a0a25, 0x000000], sun: 0xd0d8ff, sunI: 1.8, hemi: 0.65 },
  { n: 'ממתקים', floor: 0xb84a88, ramp: 0x35b8c8, wall: 0x803068, hazard: 0xffe14d, trimA: 0xffffff, trimB: 0x7afcff, sky: [0x3a70d8, 0xe080b8, 0x903870], sun: 0xffffff, sunI: 2.0, hemi: 0.95 },
  { n: 'שקיעה', floor: 0x5a3a6a, ramp: 0xff5a3a, wall: 0x2a1a3a, hazard: 0xffd21a, trimA: 0xff9a3a, trimB: 0xff3a7a, sky: [0x2a1a5a, 0xff7a3a, 0x1a0a2a], sun: 0xff9a5a, sunI: 2.4, hemi: 0.8 },
  { n: 'מטריקס', floor: 0x0f2a16, ramp: 0x1fbf50, wall: 0x06140a, hazard: 0xffffff, trimA: 0x2bff7a, trimB: 0x9bffb0, sky: [0x000a04, 0x06301a, 0x000000], sun: 0xb0ffc8, sunI: 1.7, hemi: 0.65 },
];
const CHAIN_TH = [
  { n: 'סגול', floor: 0x4a3390, ramp: 0x1fbf80, wall: 0x2a1d55, hazard: 0xffb41a, trimA: 0xd65bff, trimB: 0x2bffb0, sky: [0x1a0a4c, 0xb8407a, 0x07050f], sun: 0xfff0dc, sunI: 2.0, hemi: 0.9 },
  { n: 'ירוק', floor: 0x2f5f3a, ramp: 0xff8a2b, wall: 0x183020, hazard: 0xff3355, trimA: 0x7dff5a, trimB: 0xffd21a, sky: [0x06301e, 0x3a9a6a, 0x030a06], sun: 0xf0ffd0, sunI: 2.0, hemi: 0.9 },
  TH[6], TH[8], TH[3],
];
const DECOR = ['cubes', 'towers', 'pyramids', 'planets', 'rings', 'pillars'];
const FLOORS = ['grid', 'tiles', 'lanes'];
const COLOR_KEYS = ['floor', 'ramp', 'wall', 'hazard', 'trimA', 'trimB'];
function themeFor(base, k) {
  const dh = ((k % 3) - 1) * 0.04, c = new THREE.Color(), T = { ...base };
  const sh = (hex) => c.setHex(hex).offsetHSL(dh, 0, 0).getHex();
  for (const key of COLOR_KEYS) T[key] = sh(base[key]);
  T.sky = base.sky.map(sh);
  T.decor = DECOR[k % DECOR.length];
  T.floorTex = FLOORS[k % FLOORS.length];
  return T;
}
export const RACE_LEVELS = 30, CHAIN_LEVELS = 20, VS_MAPS = 399, BATTLE_MAPS = 4;
// תת-קטגוריות של מירוץ החברים. מספר המפה מקודד: קטגוריה * 100 + מספר
export const VS_CATS = [{ n: 'רגיל', count: 30 }, { n: 'ארוך ומפותל', count: 6 }, { n: 'קרח', count: 6 }, { n: 'קארט · 3 הקפות', count: 6 }];
export const vsSplit = (level) => { const c = Math.max(0, Math.min(3, Math.floor(level / 100))); return [c, Math.max(1, Math.min(VS_CATS[c].count, level % 100))]; };
const ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
const hdr = (hex, k = 2.3) => new THREE.Color(hex).multiplyScalar(k);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function boxGeo(sx, sy, sz, tile = 4) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv, dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
  }
  return g;
}

class Builder {
  constructor(ctx, T, o = {}) {
    this.ctx = ctx;
    this.T = T;
    this.dry = !!ctx.dry; // ריצה "יבשה": רק מחשבים את צורת המסלול (לתמונת התצוגה המקדימה)
    this.arena = !!o.arena;
    this.p = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.buckets = {};
    this.group = new THREE.Group();
    this.cps = []; this.pads = []; this.dyn = []; this.buttons = []; this.finish = null; this.minY = 0;
    this.path = []; // נקודות לאורך המסלול – כדי שקישוטים לא יונחו עליו, ולזיהוי נפילה
    this.segs = [];
    this.route = []; // קו הנסיעה לבוטים: נקודות כל 8 מטר, עם סימון של פערים
    // בשרשרת הרצפות הן "מגדלים" עמוקים: מכונית שתלויה על השרשרת נשענת על הקיר ועולה לאורכו,
    // במקום להיסחף אל מתחת לפלטפורמה ולהיתקע שם
    this.thick = o.chain ? 24 : 1.2;
    this.mats = {};
    if (this.dry) return;
    const std = (m) => new THREE.MeshStandardMaterial({ metalness: 0.15, roughness: 0.72, envMapIntensity: 0.6, ...m });
    const ft = tex[T.floorTex || 'grid'];
    this.mats = {
      floor: std({ map: ft, color: T.floor }),
      ramp: std({ map: tex.grid, color: T.ramp }),
      wall: std({ color: T.wall, metalness: 0.3, roughness: 0.55 }),
      hazard: std({ map: tex.stripes, color: T.hazard, emissive: T.hazard, emissiveMap: tex.stripes, emissiveIntensity: 0.35 }),
      checker: std({ map: tex.checker, roughness: 0.6 }),
      trimA: new THREE.MeshBasicMaterial({ color: hdr(T.trimA) }),
      trimB: new THREE.MeshBasicMaterial({ color: hdr(T.trimB) }),
      pad: new THREE.MeshBasicMaterial({ map: tex.chevron, color: hdr(T.trimB, 2.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
  }

  F() { return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  Lf() { return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  at(a, l = 0, h = 0) {
    const v = this.p.clone().addScaledVector(this.F(), a).addScaledVector(this.Lf(), l);
    v.y = this.p.y + h;
    return v;
  }
  quat(pitch = 0, yawAdd = 0) { return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, this.yaw + yawAdd, 0, 'YXZ')); }

  addGeo(key, geo, c, q) {
    if (this.dry) return;
    geo.applyMatrix4(new THREE.Matrix4().compose(c, q, ONE));
    (this.buckets[key] ||= []).push(geo);
  }
  body(c, size, q) {
    if (this.dry) return;
    const b = new CANNON.Body({
      mass: 0, material: this.ctx.groundMat, shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
      position: new CANNON.Vec3(c.x, c.y, c.z), quaternion: new CANNON.Quaternion(q.x, q.y, q.z, q.w),
      collisionFilterGroup: G_WORLD, collisionFilterMask: G_CAR,
    });
    this.ctx.world.addBody(b);
  }
  solid(c, size, q, key, collide = true) {
    if (this.dry) return;
    this.addGeo(key, boxGeo(size[0], size[1], size[2]), c, q);
    if (collide) this.body(c, size, q);
    this.minY = Math.min(this.minY, c.y + size[1] / 2 - Math.min(size[1] * 1.5, 12));
  }

  // קטע משטח: len קדימה, rise עלייה
  seg(len, o = {}) {
    const { w = 14, rise = 0, off = 0, stay = false } = o;
    const thick = o.thick || (rise ? 1.2 : this.thick);
    const f = this.F(), l = this.Lf();
    const slope = Math.hypot(len, rise), q = this.quat(-Math.atan2(rise, len));
    const n = UP.clone().applyQuaternion(q);
    const mid = this.p.clone().addScaledVector(f, len / 2).addScaledVector(l, off);
    mid.y += rise / 2;
    this.segs.push({ x: mid.x, z: mid.z, yaw: this.yaw, w, len });
    this.solid(mid.clone().addScaledVector(n, -thick / 2), [w, thick, slope], q, rise ? 'ramp' : 'floor');
    for (const s of [-1, 1]) {
      this.addGeo(rise ? 'trimB' : 'trimA', new THREE.BoxGeometry(0.28, 0.1, slope), mid.clone().addScaledVector(l, s * (w / 2 - 0.14)).addScaledVector(n, 0.03), q);
    }
    this.mark(len, off, { stay, routeLen: o.routeLen, rise });
    if (!stay) { this.p.addScaledVector(f, len); this.p.y += rise; }
  }
  mark(len, off = 0, o = {}) {
    const f = this.F(), l = this.Lf();
    if (!o.stay) for (let d = 0, L = o.routeLen ?? len; d < L || d === 0; d += 8) {
      const pt = this.p.clone().addScaledVector(f, d).addScaledVector(l, off);
      pt.y += ((o.rise || 0) * d) / (len || 1);
      pt.gap = !!o.gap;
      this.route.push(pt);
    }
    for (let d = 0; d <= len; d += 8) this.path.push(this.p.clone().addScaledVector(f, d).addScaledVector(l, off));
  }
  gap(len, rise = 0) { this.mark(len, 0, { gap: true, rise }); this.p.addScaledVector(this.F(), len); this.p.y += rise; }

  block(a, l, size, key = 'hazard', yawAdd = 0) {
    this.solid(this.at(a, l, size[1] / 2), size, this.quat(0, yawAdd), key);
  }
  wall(a, l, size) {
    this.block(a, l, size, 'wall');
    this.addGeo('trimB', new THREE.BoxGeometry(size[0] + 0.04, 0.1, size[2] + 0.04), this.at(a, l, size[1] + 0.03), this.quat());
  }

  plaza(size, deg) {
    const f = this.F();
    const side = deg > 0 ? -1 : 1;
    this.wall(size - 0.4, 0, [size, 1.4, 0.8]);
    this.wall(size / 2, side * (size / 2 - 0.4), [0.8, 1.4, size]);
    this.seg(size, { w: size, routeLen: size / 2 });
    this.p.addScaledVector(f, -size / 2);
    this.yaw += (deg * Math.PI) / 180;
    this.p.addScaledVector(this.F(), size / 2);
  }

  arch(a, w, kind) {
    const q = this.quat();
    for (const s of [-1, 1]) {
      this.addGeo('wall', boxGeo(0.6, 7.5, 0.6), this.at(a, s * (w / 2 + 0.8), 3.75), q);
      this.addGeo('trimA', new THREE.BoxGeometry(0.16, 7.5, 0.7), this.at(a, s * (w / 2 + 0.8), 3.75), q);
    }
    this.addGeo('wall', boxGeo(w + 2.2, 0.6, 0.6), this.at(a, 0, 7.5), q);
    if (kind) this.addGeo('checker', boxGeo(w + 1, 1.8, 0.2, 1.8), this.at(a, 0, 6.2), q);
  }

  zone(a, w) { return { pos: this.at(a, 0, 0), f: this.F(), l: this.Lf(), yaw: this.yaw, w }; }

  cp(a, w = 14) {
    const z = this.zone(a, w);
    if (this.cps.length && !this.dry) {
      this.arch(a, w);
      z.mesh = new THREE.Mesh(new THREE.BoxGeometry(w + 1, 0.22, 0.72), new THREE.MeshBasicMaterial({ color: hdr(this.T.trimB, 1.4) }));
      z.mesh.position.copy(this.at(a, 0, 7.05));
      z.mesh.quaternion.copy(this.quat());
      this.group.add(z.mesh);
    }
    this.cps.push(z);
  }
  finishLine(a, w) {
    this.finish = this.zone(a, w);
    this.arch(a, w, 'finish');
    this.addGeo('checker', boxGeo(w, 0.06, 3, 1.5), this.at(a, 0, 0.03), this.quat());
  }

  pad(a, l = 0) {
    this.pads.push({ pos: this.at(a, l, 0), f: this.F(), l: this.Lf(), cd: 0 });
    this.addGeo('pad', new THREE.PlaneGeometry(3, 5).rotateX(Math.PI / 2), this.at(a, l, 0.05), this.quat());
  }

  // גוף קינמטי (זז לפי זמן או לפי מצב)
  kin(mesh, shapes, evalFn) {
    if (this.dry) return {};
    const body = new CANNON.Body({ mass: 0, type: CANNON.Body.KINEMATIC, material: this.ctx.kinMat, collisionFilterGroup: G_KIN, collisionFilterMask: G_CAR });
    for (const s of shapes) body.addShape(new CANNON.Box(new CANNON.Vec3(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2)), new CANNON.Vec3(...(s.off || [0, 0, 0])));
    this.ctx.world.addBody(body);
    mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.add(mesh);
    const d = { mesh, body, eval: evalFn, p: new THREE.Vector3(), q: new THREE.Quaternion(), p2: new THREE.Vector3(), q2: new THREE.Quaternion() };
    this.dyn.push(d);
    return d;
  }

  slider(a, l, size, o = {}) {
    const { amp = 4, period = 3, phase = 0, axis = 'l', flush = false, key = 'hazard' } = o;
    if (this.dry) return {};
    const base = this.at(a, l, flush ? -size[1] / 2 : size[1] / 2), q = this.quat();
    const ax = axis === 'l' ? this.Lf() : axis === 'f' ? this.F() : UP.clone();
    const mesh = new THREE.Mesh(boxGeo(...size), this.mats[key]);
    if (flush) {
      for (const s of [-1, 1]) {
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, size[2]), this.mats.trimB);
        t.position.set(s * (size[0] / 2 - 0.14), size[1] / 2 + 0.03, 0);
        mesh.add(t);
      }
    }
    this.minY = Math.min(this.minY, base.y - 2);
    return this.kin(mesh, [{ size }], (t, p, qq) => { p.copy(base).addScaledVector(ax, amp * Math.sin((t * Math.PI * 2) / period + phase)); qq.copy(q); });
  }

  spinner(a, l, o = {}) {
    const { len = 20, speed = 1.4, phase = 0, h = 0.75 } = o;
    if (this.dry) return {};
    const c = this.at(a, l, h), yaw0 = this.yaw;
    const mesh = new THREE.Mesh(boxGeo(len, 0.8, 0.8, 2), this.mats.hazard);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 1.3, 16), this.mats.wall);
    mesh.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16), this.mats.trimB);
    cap.position.y = 0.7;
    mesh.add(cap);
    return this.kin(mesh, [{ size: [len, 0.8, 0.8] }, { size: [1.6, 1.3, 1.6] }], (t, p, q) => { p.copy(c); q.setFromAxisAngle(UP, yaw0 + phase + speed * t); });
  }

  hammer(a, o = {}) {
    const { arm = 7.2, amp = 0.62, period = 3.2, phase = 0, span = 9 } = o;
    if (this.dry) return {};
    const pivot = this.at(a, 0, arm + 1.5), qy = this.quat(), qz = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1);
    for (const s of [-1, 1]) this.addGeo('wall', boxGeo(0.5, arm + 3.2, 0.5), this.at(a, s * span / 2, (arm + 3.2) / 2 - 1.2), qy);
    this.addGeo('wall', boxGeo(span + 0.5, 0.5, 0.5), pivot, qy);
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.BoxGeometry(0.3, arm, 0.3), this.mats.wall);
    rod.position.y = -arm / 2;
    const head = new THREE.Mesh(boxGeo(2.6, 2.2, 1.6, 2), this.mats.hazard);
    head.position.y = -arm;
    g.add(rod, head);
    return this.kin(g, [{ size: [2.6, 2.2, 1.6], off: [0, -arm, 0] }], (t, p, q) => {
      p.copy(pivot);
      q.copy(qy).multiply(qz.setFromAxisAngle(Z, amp * Math.sin((t * Math.PI * 2) / period + phase)));
    });
  }

  button(a, l) {
    const pos = this.at(a, l, 0);
    if (this.dry) { this.buttons.push({ pos }); return this.buttons.length - 1; }
    const mat = new THREE.MeshStandardMaterial({ color: 0x222833, emissive: 0xff5a1f, emissiveIntensity: 1.6, roughness: 0.4 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.14, 28), mat);
    mesh.position.copy(pos).y += 0.07;
    this.group.add(mesh);
    this.addGeo('trimB', new THREE.TorusGeometry(2.5, 0.07, 6, 32).rotateX(Math.PI / 2), this.at(a, l, 0.06), this.quat());
    this.buttons.push({ pos, r: 2.5, pressed: false, mesh });
    return this.buttons.length - 1;
  }

  // גוף שנע בין מצב 0 ל-1 לפי פונקציית בקרה
  stateful(d, rate, ctrl) { d.s = 0; d.next = 0; d.rate = rate; d.ctrl = ctrl; d.timer = 0; return d; }

  gate(a, o = {}) {
    const { w = 16, open = 6.5, h = 8, inputs = [], logic = 'or', hold = 0 } = o;
    if (this.dry) return {};
    const sideW = (w - open) / 2 + 1.5, dh = h - 1.2;
    for (const s of [-1, 1]) this.block(a, s * (open / 2 + sideW / 2), [sideW, h, 1.2], 'wall');
    this.solid(this.at(a, 0, h - 0.6), [open, 1.2, 1.2], this.quat(), 'wall');
    this.addGeo('trimA', new THREE.BoxGeometry(w + 3.1, 0.12, 1.3), this.at(a, 0, h + 0.05), this.quat());
    const base = this.at(a, 0, dh / 2), q = this.quat(), btn = this.buttons, solo = this.ctx.solo;
    const mesh = new THREE.Mesh(boxGeo(open - 0.1, dh, 0.8, 2), this.mats.hazard);
    const d = this.kin(mesh, [{ size: [open - 0.1, dh, 0.8] }], (t, p, qq, k) => { p.copy(base); p.y -= (k ? d.next : d.s) * (dh + 0.3); qq.copy(q); });
    return this.stateful(d, 1.3, (t, H) => {
      if (solo) return true;
      const on = logic === 'and' ? inputs.every((i) => btn[i].pressed) : inputs.some((i) => btn[i].pressed);
      if (!hold) return on;
      d.timer = on ? hold : d.timer - H;
      return d.timer > 0;
    });
  }

  elevator(a, o = {}) {
    const { w = 8, len = 7, rise = 7, inputs = [] } = o;
    if (this.dry) return {};
    const base = this.at(a + len / 2, 0, -0.4), q = this.quat(), btn = this.buttons, solo = this.ctx.solo;
    const mesh = new THREE.Mesh(boxGeo(w, 0.8, len), this.mats.ramp);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.14, len + 0.1), this.mats.trimB);
    rim.position.y = 0.3;
    rim.scale.set(1, 1, 1);
    mesh.add(rim);
    const top = new THREE.Mesh(boxGeo(w - 0.5, 0.06, len - 0.5), this.mats.ramp);
    top.position.y = 0.41;
    mesh.add(top);
    this.minY = Math.min(this.minY, base.y - 2);
    const d = this.kin(mesh, [{ size: [w, 0.8, len] }], (t, p, qq, k) => { p.copy(base); p.y += (k ? d.next : d.s) * rise; qq.copy(q); });
    return this.stateful(d, 3.5 / rise, (t) => (solo ? ((t % 10) + 10) % 10 > 5 : inputs.some((i) => btn[i].pressed)));
  }

  decor() {
    let seed = 7 + (this.T.floor % 97);
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts = [...this.cps, this.finish].filter(Boolean), kind = this.T.decor || 'cubes';
    const yq = new THREE.Quaternion();
    for (const z of pts) {
      for (let i = 0; i < 9; i++) {
        const side = rnd() > 0.5 ? 1 : -1, s = 4 + rnd() * 12;
        const c = z.pos.clone().addScaledVector(z.l, side * (38 + rnd() * 70)).addScaledVector(z.f, rnd() * 90 - 45);
        c.y += rnd() * 70 - 50;
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        if (this.path.some((pt) => Math.hypot(pt.x - c.x, pt.z - c.z) < 26 + s * 1.6)) continue;
        const trim = r1 > 0.5 ? 'trimA' : 'trimB';
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r1, r2 * 3, r3));
        yq.setFromAxisAngle(UP, r2 * 3);
        if (kind === 'towers') {
          const h = 70 + r1 * 130;
          c.y += 10 - h / 2;
          this.addGeo('wall', boxGeo(s, h, s), c, yq);
          for (let k = 0; k < 3; k++) this.addGeo(trim, new THREE.BoxGeometry(s * 1.04, 0.5, s * 1.04), c.clone().setY(c.y + h / 2 - 2 - k * 9), yq);
        } else if (kind === 'pyramids') {
          this.addGeo('wall', new THREE.ConeGeometry(s, s * 1.6, 4), c.clone().setY(c.y + s * 0.8), yq);
          this.addGeo('wall', new THREE.ConeGeometry(s, s * 1.6, 4).rotateX(Math.PI), c.clone().setY(c.y - s * 0.8), yq);
          this.addGeo(trim, new THREE.TorusGeometry(s * 1.02, 0.18, 4, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4), c, yq);
        } else if (kind === 'planets') {
          this.addGeo('wall', new THREE.SphereGeometry(s * 0.9, 14, 10), c, q);
          this.addGeo(trim, new THREE.TorusGeometry(s * 1.5, 0.22, 5, 36).rotateX(Math.PI / 2), c, q);
        } else if (kind === 'rings') {
          this.addGeo(trim, new THREE.TorusGeometry(s * 1.5, 0.3, 6, 32), c, q);
          this.addGeo('wall', new THREE.TorusGeometry(s * 1.5 + 1.2, 0.7, 6, 32), c, q);
        } else if (kind === 'pillars') {
          const h = 60 + r1 * 100;
          c.y += 8 - h / 2;
          this.addGeo('wall', new THREE.CylinderGeometry(s * 0.45, s * 0.6, h, 10), c, yq);
          this.addGeo(trim, new THREE.TorusGeometry(s * 0.62, 0.3, 5, 20).rotateX(Math.PI / 2), c.clone().setY(c.y + h / 2), yq);
          this.addGeo('wall', new THREE.SphereGeometry(s * 0.38, 10, 8), c.clone().setY(c.y + h / 2 + s * 0.7), yq);
        } else {
          this.addGeo('wall', boxGeo(s, s * (0.5 + r3 * 2), s), c, q);
          this.addGeo(trim, new THREE.BoxGeometry(s * 1.03, 0.25, s * 1.03), c, q);
        }
      }
      if (this.arena) continue;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(z.w / 2 + 9, 0.35, 8, 48), this.mats.trimA);
      ring.position.copy(z.pos).y += 3;
      ring.quaternion.copy(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, z.yaw, 0)));
      this.group.add(ring);
    }
  }

  build() {
    this.decor();
    for (const key in this.buckets) {
      const m = new THREE.Mesh(mergeGeometries(this.buckets[key]), this.mats[key]);
      for (const g of this.buckets[key]) g.dispose();
      const solid = !key.startsWith('trim') && key !== 'pad';
      m.castShadow = solid; m.receiveShadow = solid;
      this.group.add(m);
    }
    this.ctx.scene.add(this.group);
    const { cps, pads, dyn, buttons, finish, group, mats, path, T, route } = this;
    const tq = new THREE.Quaternion();
    const green = hdr(0x2bff7a, 1.4), idle = hdr(this.T.trimB, 1.4);
    return {
      sky: T.sky, look: T, path, route, group, cps, pads, dyn, buttons, finish, killY: this.minY - 40,

      inZone(z, p) {
        const dx = p.x - z.pos.x, dy = p.y - z.pos.y, dz = p.z - z.pos.z;
        return Math.abs(dx * z.f.x + dz * z.f.z) < 3.5 && Math.abs(dx * z.l.x + dz * z.l.z) < z.w / 2 + 1.5 && dy > -1 && dy < 9;
      },
      inPad(pd, p) {
        const dx = p.x - pd.pos.x, dy = p.y - pd.pos.y, dz = p.z - pd.pos.z;
        return Math.abs(dx * pd.f.x + dz * pd.f.z) < 3 && Math.abs(dx * pd.l.x + dz * pd.l.z) < 2 && dy > -0.5 && dy < 2.2;
      },
      // גובה המסלול הקרוב ביותר – כדי לזהות נפילה מהר, גם בחלקים גבוהים של המסלול
      floorNear(p) {
        let best = 1e18, y = 0;
        for (const pt of path) { const dd = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2; if (dd < best) { best = dd; y = pt.y; } }
        return y;
      },
      spawn(i, slot, count = 1) {
        // במסלול צר מסדרים את המכוניות בפחות טורים, כדי שאף אחת לא תתחיל על השפה
        const z = cps[clamp(i, 0, cps.length - 1)], cols = Math.max(1, Math.min(4, count, Math.floor((z.w - 1) / 2.8)));
        const col = slot % cols, row = Math.floor(slot / cols);
        const pos = z.pos.clone().addScaledVector(z.l, ((cols - 1) / 2 - col) * 3.6).addScaledVector(z.f, 5 - row * 6.5);
        pos.y += 1.1;
        return { pos, yaw: z.yaw };
      },

      // צעד פיזיקה: t = זמן המירוץ המסונכרן, cars = מיקומי כל המכוניות
      step(t, H, cars) {
        for (const b of buttons) {
          b.pressed = false;
          for (const c of cars) if (Math.hypot(c.x - b.pos.x, c.z - b.pos.z) < b.r && Math.abs(c.y - b.pos.y - 0.7) < 1.6) { b.pressed = true; break; }
        }
        for (const d of dyn) {
          if (d.ctrl) {
            const tgt = d.ctrl(t, H) ? 1 : 0;
            d.next = clamp(d.s + Math.sign(tgt - d.s) * d.rate * H, 0, 1);
          }
          d.eval(t, d.p, d.q, 0);
          d.eval(t + H, d.p2, d.q2, 1);
          if (d.ctrl) d.s = d.next;
          const b = d.body;
          b.position.set(d.p.x, d.p.y, d.p.z);
          b.quaternion.set(d.q.x, d.q.y, d.q.z, d.q.w);
          b.velocity.set((d.p2.x - d.p.x) / H, (d.p2.y - d.p.y) / H, (d.p2.z - d.p.z) / H);
          tq.copy(d.q).invert().premultiply(d.q2);
          if (tq.w < 0) tq.set(-tq.x, -tq.y, -tq.z, -tq.w);
          const s = Math.sqrt(Math.max(0, 1 - tq.w * tq.w));
          if (s > 1e-6) { const k = (2 * Math.acos(clamp(tq.w, -1, 1))) / (s * H); b.angularVelocity.set(tq.x * k, tq.y * k, tq.z * k); } else b.angularVelocity.set(0, 0, 0);
          b.aabbNeedsUpdate = true;
        }
      },

      // עדכון ויזואלי פעם בפריים
      update(dt, reached) {
        tex.chevron.offset.y -= dt * 1.6;
        for (const d of dyn) { d.mesh.position.copy(d.body.position); d.mesh.quaternion.copy(d.body.quaternion); }
        for (const b of buttons) {
          b.mesh.material.emissive.setHex(b.pressed ? 0x2bff7a : 0xff5a1f);
          b.mesh.position.y = b.pos.y + (b.pressed ? 0.01 : 0.07);
        }
        for (let i = 1; i < cps.length; i++) cps[i].mesh.material.color.copy(i <= reached ? green : idle);
      },

      dispose() {
        group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        for (const k in mats) mats[k].dispose();
        for (const b of buttons) b.mesh.material.dispose();
        for (const c of cps) c.mesh?.material.dispose();
        group.removeFromParent();
      },
    };
  }
}

// ---------- מצב 1: מסלול מכשולים ----------
function raceCourse(b) {
  b.cp(14, 20); b.arch(27, 20, 'start');
  b.seg(34, { w: 20 });
  b.pad(12, -4); b.pad(12, 4); b.pad(36, 0);
  b.seg(50);
  // קפיצה ראשונה
  b.seg(14, { rise: 3.5 }); b.gap(13, -1.5);
  b.cp(10);
  b.block(26, 0, [14, 1, 1.2]);
  b.block(42, -3.5, [3.5, 5, 3.5]); b.block(54, 3.5, [3.5, 5, 3.5]); b.block(66, -3.5, [3.5, 5, 3.5]);
  b.block(80, 0, [14, 1, 1.2]);
  b.seg(94);
  b.plaza(26, -90);
  // בלוקים מחליקים
  b.cp(8);
  b.slider(22, 0, [5, 3.2, 2], { amp: 4.5, period: 3.2 });
  b.slider(36, 0, [5, 3.2, 2], { amp: 4.5, period: 2.6, phase: 1.5 });
  b.slider(50, 0, [5, 3.2, 2], { amp: 4.5, period: 3.0, phase: 3 });
  b.pad(62, 0);
  b.seg(70);
  // מדרגות
  for (let i = 0; i < 4; i++) { b.gap(3, 1.4); b.seg(15); }
  // קפיצת ענק
  b.cp(8); b.pad(16, 0); b.pad(32, 0);
  b.seg(48);
  b.seg(18, { rise: 6 }); b.gap(24, -3.5);
  b.seg(62, { w: 18 });
  b.plaza(26, 90);
  // זירת מטאטאים
  b.cp(8, 24);
  b.spinner(32, 0, { len: 22, speed: 1.4 });
  b.spinner(60, 0, { len: 22, speed: -1.7, phase: 1 });
  b.seg(80, { w: 24 });
  // גשר הפטישים
  b.cp(8); b.seg(16);
  b.hammer(10, { phase: 0 }); b.hammer(24, { phase: 1.3 }); b.hammer(38, { phase: 2.6 });
  b.seg(48, { w: 6 });
  // פלטפורמות נעות
  b.cp(8); b.seg(16);
  b.slider(7, 0, [9, 1, 10], { amp: 5, period: 4.5, flush: true, key: 'floor' });
  b.slider(19, 0, [9, 1, 10], { amp: 5, period: 4.5, phase: 2.1, flush: true, key: 'floor' });
  b.slider(31, 0, [9, 1, 10], { amp: 5, period: 4.5, phase: 4.2, flush: true, key: 'floor' });
  b.gap(38);
  // מסילות וקפיצת הסיום
  b.cp(8); b.pad(20, -4); b.pad(20, 4);
  b.seg(26);
  b.seg(36, { w: 4.6, off: 4, stay: true }); b.seg(36, { w: 4.6, off: -4 });
  b.pad(6, 0); b.pad(20, 0);
  b.seg(34);
  b.seg(20, { rise: 7 }); b.gap(28, -5);
  b.finishLine(28, 24);
  b.wall(65, 0, [24, 2, 0.8]);
  b.seg(66, { w: 24 });
}

// ---------- מצב 2: מחוברים בשרשרת ----------
function chainCourse(b) {
  b.cp(12, 18); b.arch(25, 18, 'start');
  b.seg(30, { w: 18 });
  b.pad(8, 0);
  b.seg(20, { w: 16 });
  // נתיבים תאומים עם משוכות
  b.block(14, 4.2, [4.4, 0.9, 1]); b.block(30, -4.2, [4.4, 0.9, 1]);
  b.seg(46, { w: 4.4, off: 4.2, stay: true }); b.seg(46, { w: 4.4, off: -4.2 });
  b.cp(8, 16);
  b.seg(20, { w: 16 });
  b.gap(8);
  b.seg(22, { w: 16 });
  for (let i = 0; i < 3; i++) { b.gap(3, 1.4); b.seg(14, { w: 16 }); }
  // שער ראשון: כפתור לפני וכפתור אחרי
  b.cp(8, 16);
  const A = b.button(17, 5), B = b.button(28, 5);
  b.gate(22.5, { w: 16, inputs: [A, B] });
  b.seg(42, { w: 16 });
  // מעלית
  b.cp(8, 16);
  b.seg(22, { w: 16 });
  const ins = [b.button(3.5, 6.5)];
  b.seg(7, { w: 5, off: 6.5, stay: true });
  b.elevator(0, { w: 8, len: 7, rise: 7, inputs: ins });
  b.solid(b.at(7.6, 0, 3.4), [16, 6.9, 1.2], b.quat(), 'wall');
  b.gap(7, 7);
  ins.push(b.button(4.5, 0));
  b.cp(15, 16);
  b.seg(30, { w: 16 });
  // גשר עם מטאטא ובלוק מחליק
  b.spinner(16, 0, { len: 11, speed: 1.3 });
  b.slider(34, 0, [4, 3, 2], { amp: 3.5, period: 3 });
  b.seg(44, { w: 12 });
  // שער שני: שני כפתורים בו-זמנית
  const C = b.button(10, 5.5), D = b.button(10, -5.5);
  b.gate(24, { w: 16, inputs: [C, D], logic: 'and', hold: 9 });
  b.cp(34, 16);
  b.seg(46, { w: 16 });
  // הטיפוס האחרון
  b.seg(22, { rise: 6, w: 16 });
  b.plaza(22, 90);
  b.seg(24, { rise: 6, w: 4.6, off: 4, stay: true }); b.seg(24, { rise: 6, w: 4.6, off: -4 });
  b.cp(8, 16);
  b.seg(18, { w: 16 });
  b.gap(9);
  b.finishLine(16, 20);
  b.wall(35, 0, [20, 2, 0.8]);
  b.seg(36, { w: 20 });
}

// ---------- מחולל שלבים ----------
// כל שלב נבנה ממספר השלב בלבד (זרע קבוע), כך שכל השחקנים בחדר מקבלים בדיוק אותו מסלול.
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// קטעי מירוץ: d = קושי 0..1, r = אקראי, w = רוחב המסלול
const R = {
  straight(b, d, r, w) { b.pad(8, 0); if (r() > 0.5) b.pad(26, (r() - 0.5) * w * 0.5); b.seg(40, { w }); },
  hurdles(b, d, r, w) {
    const n = 1 + Math.round(d * 2 + r() * 0.8), sp = lerp(22, 14, d);
    for (let i = 0; i < n; i++) b.block(14 + i * sp, 0, [w, lerp(0.8, 1.2, d), 1.2]);
    b.seg(14 + n * sp + 6, { w });
  },
  rampJump(b, d, r, w) { b.pad(6, 0); b.seg(22, { w }); b.seg(14, { rise: 3.5, w }); b.gap(lerp(7, 16, d), -1.5); b.seg(34, { w: w + 2 }); },
  pillars(b, d, r, w) {
    const n = 3 + Math.round(d * 3), sp = lerp(16, 10, d);
    let side = r() > 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) { b.block(12 + i * sp, side * w * 0.22, [w * 0.28, 5, 3]); side = -side; }
    b.seg(12 + n * sp + 8, { w });
  },
  sliders(b, d, r, w) {
    const n = 2 + Math.round(d * 3), sp = lerp(16, 11, d);
    for (let i = 0; i < n; i++) b.slider(14 + i * sp, 0, [w * 0.36, 3.2, 2], { amp: w * 0.32, period: lerp(4, 2.2, d) + r() * 0.6, phase: r() * 6.28 });
    b.seg(14 + n * sp + 8, { w });
  },
  stairs(b, d, r, w) {
    const n = 2 + Math.round(d * 3);
    for (let i = 0; i < n; i++) { b.gap(lerp(2, 3.5, d), lerp(1.0, 1.5, d)); b.seg(lerp(18, 13, d), { w }); }
  },
  bigJump(b, d, r, w) { b.pad(4, 0); b.pad(20, 0); b.seg(40, { w }); b.seg(18, { rise: 6, w }); b.gap(lerp(16, 28, d), -3.5); b.seg(62, { w: w + 4 }); },
  sweepers(b, d, r, w) {
    const W = Math.max(w + 8, 22), n = 1 + Math.round(d * 2);
    for (let i = 0; i < n; i++) b.spinner(24 + i * 26, 0, { len: W - 2, speed: (i % 2 ? -1 : 1) * lerp(1.0, 2.1, d), phase: r() * 6 });
    b.seg(24 + n * 26, { w: W });
  },
  rails(b, d, r, w) {
    const rw = lerp(5.5, 3.2, d), off = rw / 2 + 1.2 + d, len = lerp(28, 40, d);
    b.seg(len, { w: rw, off, stay: true }); b.seg(len, { w: rw, off: -off });
  },
  hammers(b, d, r, w) {
    const n = 2 + Math.round(d * 2), bw = lerp(8, 5, d);
    for (let i = 0; i < n; i++) b.hammer(10 + i * 14, { period: lerp(3.6, 2.4, d), phase: r() * 6, span: bw + 3 });
    b.seg(10 + n * 14, { w: bw });
  },
  movers(b, d, r, w) {
    const n = 2 + Math.round(d * 2);
    for (let i = 0; i < n; i++) b.slider(7 + i * 12, 0, [9, 1, 10], { amp: lerp(3, 6, d), period: lerp(5.5, 3.8, d), phase: r() * 6.28, flush: true, key: 'floor' });
    b.gap(2 + n * 12);
  },
  // איים: פלטפורמות מוסטות הצידה – צריך לקפוץ ולכוון באוויר
  islands(b, d, r, w) {
    const n = 3 + Math.round(d * 3);
    for (let i = 0; i < n; i++) {
      b.gap(lerp(5, 9, d));
      b.seg(12, { w: lerp(12, 8, d), off: (i % 2 ? 1 : -1) * lerp(1.5, 5, d) * (0.6 + r() * 0.4) });
    }
    b.gap(lerp(5, 8, d));
  },
};
Object.assign(R, {
  bumps(b, d, r, w) {
    const n = 2 + Math.round(d * 2);
    for (let i = 0; i < n; i++) { b.seg(7, { w, rise: 1.5 }); b.seg(7, { w, rise: -1.5 }); b.seg(lerp(10, 5, d), { w }); }
  },
  climb(b, d, r, w) { b.pad(4, 0); b.seg(36, { w, rise: lerp(6, 10, d) }); b.seg(16, { w }); },
  downhill(b, d, r, w) { b.seg(12, { w }); b.seg(30, { w, rise: -lerp(4, 8, d) }); b.pad(6, 0); b.seg(26, { w }); },
  // שיקאן: קירות שחוסמים חצי מסלול, פעם מימין ופעם משמאל
  chicane(b, d, r, w) {
    const n = 3 + Math.round(d * 3), sp = lerp(20, 13, d);
    let side = r() > 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) { b.wall(12 + i * sp, side * w * 0.21, [w * 0.58, 3, 1.4]); side = -side; }
    b.seg(12 + n * sp + 8, { w });
  },
  narrow(b, d, r, w) { b.seg(lerp(26, 42, d), { w: lerp(6, 3.4, d) }); b.seg(8, { w }); },
  dropJump(b, d, r, w) { b.pad(6, 0); b.seg(18, { w }); b.gap(lerp(6, 12, d), -lerp(3, 6, d)); b.seg(32, { w: w + 2 }); },
  zigzag(b, d, r, w) {
    const zw = lerp(8, 5.5, d), n = 4 + Math.round(d * 3);
    for (let i = 0; i < n; i++) b.seg(13, { w: zw, off: (i % 2 ? 1 : -1) * zw * 0.3 });
    b.seg(8, { w });
  },
});
const R_UNLOCK = { straight: 1, hurdles: 1, rampJump: 1, pillars: 2, bumps: 3, climb: 3, sliders: 4, stairs: 5, downhill: 5, bigJump: 6, chicane: 6, sweepers: 7, rails: 8, narrow: 8, hammers: 9, dropJump: 9, movers: 11, islands: 12, zigzag: 13 };

// מסלול מירוץ כללי. פניות: המסלול פונה רק ימינה/שמאלה ביחס לכיוון ההתחלה ולעולם לא חוזר אחורה, כך שהוא לא חוצה את עצמו
function genTrack(b, o) {
  const { r, d, n, w, pool, fresh = [], cpEvery = 1, turns = true, combo = 0, turnMin = 2, turnVar = 3 } = o;
  b.cp(14, w + 4); b.arch(27, w + 4, 'start');
  b.seg(34, { w: w + 4 });
  b.pad(10, 0);
  b.seg(30, { w });
  let last = '', h = 0, since = 0, nextTurn = turnMin + Math.floor(r() * turnVar);
  for (let i = 0; i < n; i++) {
    let k;
    if (i < fresh.length) k = fresh[i]; // קטע חדש מוצג בתחילת השלב שבו הוא נפתח
    else do { k = pool[Math.floor(r() * pool.length)]; } while (k === last || (k === 'straight' && d > 0.5));
    last = k;
    if (i % cpEvery === 0) b.cp(8, w);
    if (r() < combo) b.block(10, 0, [w, 1, 1.2]); // בשלבים הקשים: משוכה גם בקטעי החיבור
    b.seg(18, { w });
    R[k](b, d, r, w);
    since++;
    if (turns && since >= nextTurn && i < n - 1) {
      const sgn = h === 0 ? (r() > 0.5 ? 1 : -1) : -h;
      b.seg(12, { w });
      b.plaza(Math.max(26, w + 10), 90 * sgn);
      h += sgn; since = 0; nextTurn = turnMin + Math.floor(r() * turnVar);
    }
  }
  b.seg(20, { w });
  b.finishLine(28, w + 8);
  b.wall(63, 0, [w + 8, 2, 0.8]);
  b.seg(64, { w: w + 8 });
}

// קושי: עד שלב 10 עלייה מתונה, ומשם והלאה עקומה תלולה יותר
const raceDiff = (L) => (L <= 10 ? ((L - 1) / 9) * 0.42 : 0.47 + 0.53 * Math.pow((L - 10) / (RACE_LEVELS - 10), 0.75));
function genRace(b, L) {
  const d = raceDiff(L), r = rng(L * 7919 + 13);
  genTrack(b, {
    r, d, w: Math.round(lerp(18, 10, d)), n: Math.round(lerp(4, 15, d)), turns: L >= 2,
    pool: Object.keys(R_UNLOCK).filter((k) => R_UNLOCK[k] <= L),
    fresh: Object.keys(R_UNLOCK).filter((k) => R_UNLOCK[k] === L && k !== 'straight'),
    cpEvery: d < 0.55 ? 1 : 2, combo: L > 10 ? (d - 0.4) * 0.8 : 0,
  });
}

// מפות מירוץ החברים: 1–10 קצרות, 11–20 בינוניות, 21–30 ארוכות
const VS_SIZES = ['קצר', 'בינוני', 'ארוך'];
const vsSize = (M) => Math.min(2, Math.floor((M - 1) / 10));
function genVs(b, M) {
  const r = rng(M * 9973 + 5), d = 0.12 + r() * 0.5;
  genTrack(b, { r, d, w: Math.round(lerp(20, 14, d)), n: [4, 8, 13][vsSize(M)], pool: Object.keys(R_UNLOCK).filter((k) => k !== 'narrow' && k !== 'rails') });
}

const EASY_POOL = ['straight', 'hurdles', 'rampJump', 'pillars', 'bumps', 'sliders', 'downhill', 'chicane', 'sweepers', 'dropJump', 'climb'];
function genTwisty(b, i) {
  const r = rng(i * 6151 + 3);
  genTrack(b, { r, d: 0.2 + r() * 0.4, w: 16, n: 16, pool: Object.keys(R_UNLOCK).filter((k) => k !== 'narrow' && k !== 'rails'), turnMin: 1, turnVar: 2 });
}
function genIce(b, i) {
  const r = rng(i * 3301 + 9);
  b.ice = true;
  genTrack(b, { r, d: 0.1 + r() * 0.3, w: 20, n: 5 + i, pool: EASY_POOL, turnMin: 1, turnVar: 2 });
}

// מסלולי קארט: מעגל סגור ושטוח (3 הקפות) עם תיבות הפתעה. כל צלע: [אורך ביחידות, כיוון הפנייה בסופה]
const KART_SHAPES = [
  [[2, 1], [1.2, 1], [2, 1], [1.2, 1]],
  [[1.4, 1], [2.2, 1], [1.4, 1], [2.2, 1]],
  [[2, 1], [1, 1], [1, -1], [1, 1], [1, 1], [2, 1]],
  [[2, 1], [1, 1], [1, -1], [1, -1], [1, 1], [1, 1], [2, 1], [3, 1]],
  [[2, -1], [1, -1], [1, 1], [1, -1], [1, -1], [2, -1]],
  [[3, 1], [1, 1], [1, -1], [1, -1], [1, 1], [1, 1], [3, 1], [3, 1]].map(([a, t]) => [a === 3 ? 3 : a, t]),
];
function genKart(b, i) {
  const r = rng(i * 4447 + 21), shape = KART_SHAPES[(i - 1) % KART_SHAPES.length], w = 18, S = 32, U = 92;
  b.laps = 3; b.boxes = [];
  const kinds = ['pads', 'hurdles', 'pillars', 'sliders', 'chicane', 'bump', 'pads'];
  shape.forEach(([units, turn], leg) => {
    const L = units * U - S;
    if (leg === 0) { b.cp(4, w); b.finishLine(22, w); b.pad(34, -4); b.pad(34, 4); } else {
      b.cp(5, w);
      const k = kinds[Math.floor(r() * kinds.length)], m = L / 2;
      if (k === 'pads') { b.pad(m - 8, (r() - 0.5) * 8); b.pad(m + 8, (r() - 0.5) * 8); }
      else if (k === 'hurdles') { b.block(m - 9, 0, [w, 0.9, 1.2]); if (L > 80) b.block(m + 12, 0, [w, 0.9, 1.2]); }
      else if (k === 'pillars') { for (let j = 0; j < 3; j++) b.block(m - 14 + j * 14, (j % 2 ? 1 : -1) * w * 0.22, [w * 0.28, 5, 3]); }
      else if (k === 'sliders') { b.slider(m - 8, 0, [w * 0.34, 3.2, 2], { amp: w * 0.3, period: 3.4, phase: r() * 6 }); b.slider(m + 10, 0, [w * 0.34, 3.2, 2], { amp: w * 0.3, period: 2.8, phase: r() * 6 }); }
      else if (k === 'chicane') { b.wall(m - 10, w * 0.21, [w * 0.56, 3, 1.4]); b.wall(m + 10, -w * 0.21, [w * 0.56, 3, 1.4]); }
      if (leg % 2 === 1 || shape.length <= 4) for (const l of [-w / 4, 0, w / 4]) b.boxes.push(b.at(L > 80 ? 18 : 14, l, 1.3));
      if (k === 'bump') { b.seg(m - 7, { w }); b.seg(7, { w, rise: 1.5 }); b.seg(7, { w, rise: -1.5 }); b.seg(L - m - 7, { w }); b.plaza(S, 90 * turn); return; }
    }
    b.seg(L, { w });
    b.plaza(S, 90 * turn);
  });
}

// ---------- זירות קרב ----------
const ARENAS = [
  { n: 'הזירה', R: 24 }, { n: 'הטבעת', R: 27 }, { n: 'האיים', R: 9 }, { n: 'המגדל', R: 30 },
];
function plat(b, x, z, sx, sz, y = 0) { b.yaw = 0; b.p.set(x, y, z - sz / 2); b.seg(sz, { w: sx, stay: true }); }
function put(b, x, z, yaw = 0, y = 0) { b.p.set(x, y, z); b.yaw = yaw; }
function genArena(b, A) {
  if (A === 1) {
    plat(b, 0, 0, 72, 72);
    put(b, 0, 0); b.block(0, 0, [14, 1.2, 14], 'ramp');
    put(b, -21, 0); b.spinner(0, 0, { len: 20, speed: 0.9 });
    put(b, 21, 0); b.spinner(0, 0, { len: 20, speed: -0.9 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      put(b, sx * 35.4, sz * 24); b.wall(0, 0, [0.8, 1.4, 22]);
      put(b, sx * 24, sz * 35.4); b.wall(0, 0, [22, 1.4, 0.8]);
    }
    put(b, 0, -24); b.pad(0, 0); put(b, 0, 24, Math.PI); b.pad(0, 0);
  } else if (A === 2) {
    plat(b, 0, -27, 78, 24); plat(b, 0, 27, 78, 24); plat(b, -27, 0, 24, 30); plat(b, 27, 0, 24, 30);
    plat(b, 0, 0, 5, 30);
    put(b, -27, -27); b.spinner(0, 0, { len: 16, speed: 1.1 });
    put(b, 27, 27); b.spinner(0, 0, { len: 16, speed: -1.1 });
    put(b, 27, -27, -Math.PI / 2); b.pad(0, 0); put(b, -27, 27, Math.PI / 2); b.pad(0, 0);
  } else if (A === 3) {
    plat(b, 0, 0, 30, 30);
    for (const [x, z] of [[36, 0], [-36, 0], [0, 36], [0, -36]]) {
      plat(b, x, z, 20, 20);
      plat(b, x * 0.57, z * 0.57, x ? 11 : 5, x ? 5 : 11);
      put(b, x, z, Math.atan2(-x, -z)); b.pad(0, 0);
    }
    put(b, 0, 0); b.spinner(0, 0, { len: 18, speed: 1.0 });
  } else {
    plat(b, 0, 0, 80, 80);
    put(b, 0, 0); b.block(0, 0, [40, 1.3, 40], 'floor');
    put(b, 0, 0, 0, 1.3); b.block(0, 0, [16, 1.3, 16], 'ramp');
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      put(b, -Math.sin(a) * 28, -Math.cos(a) * 28, a); b.seg(8, { w: 8, rise: 1.3, stay: true });
      put(b, -Math.sin(a + 0.78) * 44, -Math.cos(a + 0.78) * 44, a + 0.78 + Math.PI / 2); b.pad(0, 0);
    }
    put(b, 0, 0);
  }
  put(b, 0, 0);
  b.cps.push(b.zone(0, 20));
  b.finish = b.zone(0, 1);
}

// קטעי שרשרת (רוחב 16, מתאים לשתי מכוניות זו לצד זו)
const C = {
  straight(b) { b.pad(8, 0); b.seg(30, { w: 16 }); },
  gap(b, d) { b.seg(10, { w: 16 }); b.gap(lerp(5, 10, d)); b.seg(16, { w: 16 }); },
  lanes(b, d) {
    const lw = lerp(5, 3.8, d), off = lw / 2 + lerp(1.5, 3, d);
    b.block(12, off, [lw, 0.9, 1]); b.block(26, -off, [lw, 0.9, 1]);
    b.seg(40, { w: lw, off, stay: true }); b.seg(40, { w: lw, off: -off });
  },
  stairs(b, d) {
    const n = 2 + Math.round(d * 2);
    for (let i = 0; i < n; i++) { b.gap(lerp(2, 3.5, d), lerp(1.0, 1.5, d)); b.seg(14, { w: 16 }); }
  },
  gateOr(b, d, r) {
    const side = r() > 0.5 ? 5 : -5;
    const A = b.button(9, side), B = b.button(20, side);
    b.gate(14.5, { w: 16, inputs: [A, B] });
    b.seg(30, { w: 16 });
  },
  sweeper(b, d) {
    b.spinner(14, 0, { len: 11, speed: lerp(1, 1.9, d) });
    if (d > 0.3) b.slider(30, 0, [4, 3, 2], { amp: 3.5, period: lerp(3.6, 2.4, d) });
    b.seg(40, { w: 12 });
  },
  elevator(b) {
    b.seg(14, { w: 16 });
    const ins = [b.button(3.5, 6.5)];
    b.seg(7, { w: 5, off: 6.5, stay: true });
    b.elevator(0, { w: 8, len: 7, rise: 7, inputs: ins });
    b.solid(b.at(7.6, 0, 3.4), [16, 6.9, 1.2], b.quat(), 'wall');
    b.gap(7, 7);
    ins.push(b.button(4.5, 0));
    b.seg(22, { w: 16 });
  },
  gateAnd(b, d) {
    const A = b.button(8, 5.5), B = b.button(8, -5.5);
    b.gate(20 + lerp(0, 6, d), { w: 16, inputs: [A, B], logic: 'and', hold: lerp(10, 6, d) });
    b.seg(38, { w: 16 });
  },
  twinRamps(b, d) {
    const lw = lerp(5.5, 4, d);
    b.seg(24, { rise: 6, w: lw, off: 4, stay: true }); b.seg(24, { rise: 6, w: lw, off: -4 });
    b.seg(12, { w: 16 });
  },
  islands(b, d, r) {
    const n = 2 + Math.round(d * 2);
    for (let i = 0; i < n; i++) { b.gap(lerp(4, 7, d)); b.seg(12, { w: lerp(14, 10, d), off: (i % 2 ? 1 : -1) * lerp(1, 3, d) * (0.6 + r() * 0.4) }); }
    b.gap(lerp(4, 6, d));
  },
};
const C_UNLOCK = { straight: 1, gap: 1, lanes: 1, stairs: 2, gateOr: 2, sweeper: 3, elevator: 4, gateAnd: 5, twinRamps: 5, islands: 7 };

function genChain(b, L) {
  const d = (L - 1) / (CHAIN_LEVELS - 1), r = rng(L * 104729 + 7);
  const pool = Object.keys(C_UNLOCK).filter((k) => C_UNLOCK[k] <= L);
  const fresh = Object.keys(C_UNLOCK).filter((k) => C_UNLOCK[k] === L && k !== 'straight');
  const n = Math.round(lerp(3, 9, d));
  b.cp(12, 18); b.arch(25, 18, 'start');
  b.seg(30, { w: 18 });
  let last = '', dir = 1, since = 0;
  for (let i = 0; i < n; i++) {
    let k;
    if (i < fresh.length) k = fresh[i];
    else do { k = pool[Math.floor(r() * pool.length)]; } while (k === last || (k === 'straight' && d > 0.4));
    last = k;
    b.cp(8, 16);
    b.seg(18, { w: 16 });
    C[k](b, d, r);
    since++;
    if (L >= 3 && since >= 3 && i < n - 1) { b.seg(10, { w: 16 }); b.plaza(24, 90 * dir); dir = -dir; since = 0; }
  }
  b.seg(18, { w: 16 });
  b.finishLine(16, 20);
  b.wall(35, 0, [20, 2, 0.8]);
  b.seg(36, { w: 20 });
}

// שלב 10 במירוץ ושלב 6 בשרשרת הם המסלולים המקוריים שנבנו ידנית
const HAND_RACE = 10, HAND_CHAIN = 6;

function make(mode, level, ctx) {
  let L = Math.round(level) || 1, b;
  if (mode === 'chain') {
    L = clamp(L, 1, CHAIN_LEVELS);
    b = new Builder(ctx, themeFor(CHAIN_TH[(L - 1) % CHAIN_TH.length], L), { chain: true });
    if (L === HAND_CHAIN) chainCourse(b); else genChain(b, L);
  } else if (mode === 'vs') {
    const [c, i] = vsSplit(L);
    L = c * 100 + i;
    if (c === 1) { b = new Builder(ctx, themeFor(TH[(i * 7 + 2) % TH.length], i + 1)); genTwisty(b, i); }
    else if (c === 2) { b = new Builder(ctx, { ...themeFor(TH[3], i), decor: DECOR[i % DECOR.length] }); genIce(b, i); }
    else if (c === 3) { b = new Builder(ctx, themeFor(TH[(i * 3) % TH.length], i + 3)); genKart(b, i); }
    else { b = new Builder(ctx, themeFor(TH[(i * 3 + 1) % TH.length], i + 2)); genVs(b, i); }
  } else if (mode === 'battle') {
    L = clamp(L, 1, BATTLE_MAPS);
    b = new Builder(ctx, themeFor(TH[[2, 6, 1, 8][L - 1]], L), { arena: true });
    genArena(b, L);
  } else {
    L = clamp(L, 1, RACE_LEVELS);
    b = new Builder(ctx, themeFor(TH[(L - 1) % TH.length], L));
    if (L === HAND_RACE) raceCourse(b); else genRace(b, L);
  }
  return { b, L };
}

export function buildLevel(mode, level, ctx) {
  const { b, L } = make(mode, level, ctx);
  const lv = b.build();
  lv.level = L;
  lv.ice = !!b.ice; lv.laps = b.laps || 0; lv.boxes = b.boxes || [];
  if (mode === 'battle') {
    const R = ARENAS[L - 1].R;
    lv.finish.pos.y = -1e6;
    lv.killY = -16;
    lv.spawn = (i, slot, count = 1) => {
      const a = (slot / Math.max(1, count)) * Math.PI * 2 + (i || 0);
      return { pos: new THREE.Vector3(Math.sin(a) * R, L === 4 ? 1.2 : 1.2, Math.cos(a) * R), yaw: a + Math.PI };
    };
  }
  return lv;
}

// שם ואורך של מפה (ללובי)
export function mapInfo(mode, level) {
  if (mode === 'battle') return { name: ARENAS[clamp(level, 1, BATTLE_MAPS) - 1].n, size: '' };
  const [c, i] = vsSplit(level);
  if (c === 1) return { name: `פיתולים ${i}`, size: 'ארוך' };
  if (c === 2) return { name: `קרח ${i}`, size: 'חלקלק' };
  if (c === 3) return { name: `קארט ${i}`, size: '3 הקפות' };
  return { name: `${TH[(i * 3 + 1) % TH.length].n} ${i}`, size: VS_SIZES[vsSize(i)] };
}

// צורת המסלול מלמעלה, לציור תמונת התצוגה המקדימה
export function trackShape(mode, level) {
  const { b } = make(mode, level, { dry: true, solo: true });
  const css = (hex) => '#' + new THREE.Color(hex).getHexString();
  return { segs: b.segs, start: b.cps[0].pos, finish: mode === 'battle' ? null : b.finish.pos, floor: css(b.T.floor), trim: css(b.T.trimA), sky: css(b.T.sky[1]) };
}
