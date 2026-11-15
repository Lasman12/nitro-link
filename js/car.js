// מכונית: פיזיקה ארקיידית (מתלים בקרני-ריי, קפיצה, בוסט, שליטה באוויר) + מודל תלת-ממדי להתאמה אישית
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GRADS, FEATHERS } from './items.js';

export const G_WORLD = 1, G_CAR = 2, G_KIN = 4, G_REMOTE = 8;

export const P = {
  mass: 180, half: [0.92, 0.36, 1.98], boxY: 0.08,
  wheelX: 0.86, wheelZf: 1.32, wheelZr: -1.28, mountY: 0.05,
  rest: 0.5, radius: 0.36, k: 7000, c: 620,
  engine: 17, brake: 32, maxSpeed: 30, boostSpeed: 45, reverse: 14, boostAcc: 21,
  jumpV: 8.8, airJumpV: 8.5, gravity: 24, jumpHold: 13, holdTime: 0.2, airTurn: 1.35, airAcc: 7,
};
const RAY = P.rest + P.radius;

const AX = new CANNON.Vec3(1, 0, 0), AY = new CANNON.Vec3(0, 1, 0), AZ = new CANNON.Vec3(0, 0, 1);
const left = new CANNON.Vec3(), up = new CANNON.Vec3(), fwd = new CANNON.Vec3();
const r = new CANNON.Vec3(), rApp = new CANNON.Vec3(), mount = new CANNON.Vec3(), to = new CANNON.Vec3();
const pv = new CANNON.Vec3(), gv = new CANNON.Vec3(), tmp = new CANNON.Vec3(), tmp2 = new CANNON.Vec3();
const wf = new CANNON.Vec3(), ws = new CANNON.Vec3(), F = new CANNON.Vec3(), nAvg = new CANNON.Vec3();
const wl = new CANNON.Vec3(), D = new CANNON.Vec3(), qi = new CANNON.Quaternion();
const res = new CANNON.RaycastResult();
const RAYOPT = { collisionFilterMask: G_WORLD | G_KIN, skipBackfaces: true };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function addForce(b, f, rel) {
  b.force.vadd(f, b.force);
  rel.cross(f, tmp2);
  b.torque.vadd(tmp2, b.torque);
}

export function carShape() {
  return new CANNON.Box(new CANNON.Vec3(P.half[0], P.half[1], P.half[2]));
}

export class CarPhysics {
  constructor(world, material) {
    this.world = world;
    const b = (this.body = new CANNON.Body({ mass: P.mass, material, angularDamping: 0.25, linearDamping: 0.01 }));
    b.addShape(carShape(), new CANNON.Vec3(0, P.boxY, 0));
    b.collisionFilterGroup = G_CAR;
    b.collisionFilterMask = G_WORLD | G_KIN | G_REMOTE;
    b.allowSleep = false;
    world.addBody(b);
    this.wheels = [
      [P.wheelX, P.wheelZf, true], [-P.wheelX, P.wheelZf, true],
      [P.wheelX, P.wheelZr, false], [-P.wheelX, P.wheelZr, false],
    ].map(([x, z, front]) => ({ local: new CANNON.Vec3(x, P.mountY, z), front, len: RAY - 0.13, hit: false }));
    this.steer = 0; this.spin = 0; this.boost = 100; this.regen = 9; this.grip = 1; this.speedMul = 1;
    this.grounded = 0; this.airT = 0; this.jumpT = 1; this.jumped = false; this.airJumps = 1;
    this.boosting = false; this.flipT = 0; this.didJump = false; this.jumpBuf = 0; this.holdT = 0; this.supported = true;
  }

  reset(pos, yaw) {
    const b = this.body;
    b.position.set(pos.x, pos.y, pos.z);
    b.quaternion.setFromAxisAngle(AY, yaw);
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
    b.force.set(0, 0, 0);
    b.torque.set(0, 0, 0);
    this.steer = 0; this.airT = 0; this.jumpT = 1; this.jumped = false; this.airJumps = 1; this.flipT = 0;
    this.jumpBuf = 0; this.holdT = 0;
  }

  // inp: {throttle, steer, jump, jumpHeld, boost, drift, pitch, roll}; locked = ספירה לאחור
  step(dt, inp, locked) {
    const b = this.body, q = b.quaternion, vel = b.velocity, av = b.angularVelocity;
    q.vmult(AX, left); q.vmult(AY, up); q.vmult(AZ, fwd);
    const th = locked ? 0 : inp.throttle;
    const vf0 = vel.dot(fwd), sp = Math.abs(vf0);
    const maxSteer = 0.5 - 0.37 * Math.min(1, sp / 38);
    this.steer += (inp.steer * maxSteer - this.steer) * Math.min(1, dt * 12);
    this.jumpT += dt;
    // סיבוב במקום: במהירות נמוכה ההיגוי מסובב את המכונית עצמה, כדי להתיישר מהר בלי תמרונים
    const pivot = inp.steer && !locked ? clamp(1 - sp / 7, 0, 1) : 0;
    this.boosting = !locked && inp.boost && this.boost > 0;
    const suspActive = this.jumpT > 0.12;
    let grounded = 0;
    nAvg.set(0, 0, 0);
    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      q.vmult(w.local, r);
      b.position.vadd(r, mount);
      mount.vsub(up.scale(RAY, tmp), to);
      res.reset();
      this.world.raycastClosest(mount, to, RAYOPT, res);
      w.hit = false;
      if (res.hasHit && suspActive) {
        const n = res.hitNormalWorld;
        if (n.dot(up) > 0.35) {
          const comp = RAY - res.distance;
          av.cross(r, pv); pv.vadd(vel, pv);
          const hb = res.body;
          if (hb && hb.type !== CANNON.Body.STATIC) {
            res.hitPointWorld.vsub(hb.position, tmp);
            hb.angularVelocity.cross(tmp, gv); gv.vadd(hb.velocity, gv);
            pv.vsub(gv, pv);
          }
          // מתלה
          let Fs = P.k * comp - P.c * pv.dot(n);
          if (comp > 0.42) Fs += (comp - 0.42) * P.k * 6;
          Fs = clamp(Fs, 0, P.mass * 90);
          addForce(b, n.scale(Fs, F), r);
          // כיווני הצמיג
          if (w.front) { wf.set(fwd.x * cs + left.x * sn, fwd.y * cs + left.y * sn, fwd.z * cs + left.z * sn); } else wf.copy(fwd);
          wf.vsub(n.scale(wf.dot(n), tmp), wf); wf.normalize();
          n.cross(wf, ws);
          const vfw = pv.dot(wf), vs = pv.dot(ws);
          // אחיזה צידית
          const drifting = inp.drift && !w.front;
          let Fl = -vs * (P.mass / 4) * (drifting ? 5 : 32) * (1 - 0.85 * pivot) * this.grip;
          const maxL = (drifting ? 0.55 : 2.4) * Math.max(Fs, P.mass * P.gravity * 0.15) * this.grip;
          Fl = clamp(Fl, -maxL, maxL);
          // הנעה / בלימה
          let Fd;
          if (th !== 0) {
            if (th * vfw >= 0 || Math.abs(vfw) < 1.5) {
              const lim = (th > 0 ? (this.boosting ? P.boostSpeed : P.maxSpeed) : P.reverse) * this.speedMul;
              const a = Math.abs(vfw);
              Fd = th * P.engine * this.speedMul * (a < lim * 0.75 ? 1 : Math.max(0, (lim - a) / (lim * 0.25)));
            } else Fd = th * P.brake * (0.4 + 0.6 * this.grip);
          } else Fd = Math.abs(vfw) < 3 ? clamp(-vfw * 20, -25, 25) : -vfw * 0.5; // בלי גז ובמהירות נמוכה – בלם חניה, כדי שלא ייגרר
          if (locked) Fd = -vfw * 8;
          if (!this.boosting && Math.abs(vfw) > P.maxSpeed * this.speedMul + 1) Fd -= Math.sign(vfw) * 5;
          Fd *= P.mass / 4;
          F.set(wf.x * Fd + ws.x * Fl, wf.y * Fd + ws.y * Fl, wf.z * Fd + ws.z * Fl);
          r.vadd(up.scale(-0.1 - P.mountY, tmp), rApp);
          addForce(b, F, rApp);
          grounded++;
          nAvg.vadd(n, nAvg);
          w.hit = true;
          w.len = res.distance;
        }
      }
      if (!w.hit) w.len += (RAY - 0.02 - w.len) * Math.min(1, dt * 12);
    }
    this.spin += (vf0 / P.radius) * dt;
    this.grounded = grounded;

    // "תקוע על הבטן" – השלדה נוגעת במשהו אבל הגלגלים באוויר (למשל על שפת פלטפורמה)
    let beached = false;
    if (grounded < 2 && up.y > 0.3) {
      const cs2 = this.world.contacts;
      for (let i = 0; i < cs2.length; i++) {
        const c = cs2[i]; // רק מגע שהמכונית "נחה" עליו (נורמל כלפי מעלה) – לא קיר
        if ((c.bi === b && -c.ni.y > 0.7) || (c.bj === b && c.ni.y > 0.7)) { beached = true; break; }
      }
    }
    if (beached) {
      if (this.jumpT > 0.4) { this.jumped = false; this.airJumps = 1; }
      if (th !== 0 && sp < 8) { const fh2 = Math.hypot(fwd.x, fwd.z) || 1; b.force.x += (fwd.x / fh2) * th * P.mass * 7; b.force.z += (fwd.z / fh2) * th * P.mass * 7; }
    }

    this.supported = grounded >= 2 || beached;
    if (pivot > 0 && this.supported) {
      const want = inp.steer * 2.7 * pivot * (th < 0 ? -1 : 1);
      av.vadd(up.scale((want - av.dot(up)) * Math.min(1, dt * 14), tmp), av);
    }
    if (grounded >= 2) {
      this.airT = 0; this.airJumps = 1;
      if (this.jumpT > 0.2) this.jumped = false;
    } else this.airT += dt;

    // הצמדה לקרקע (עוזר ברמפות)
    if (grounded >= 3) { nAvg.normalize(); b.force.vsub(nAvg.scale(P.mass * 6, tmp), b.force); }

    // בוסט
    if (this.boosting) {
      const f = clamp((P.boostSpeed * this.speedMul + 2 - vel.dot(fwd)) / 6, 0, 1);
      b.force.vadd(fwd.scale(P.mass * P.boostAcc * f, tmp), b.force);
      this.boost = Math.max(0, this.boost - 28 * dt);
    } else if (grounded >= 2 && !inp.boost) this.boost = Math.min(100, this.boost + this.regen * dt);

    // קפיצה: לחיצה קצרה = קפיצה נמוכה, החזקה = גבוהה. לחיצה רגע לפני הנחיתה נזכרת (buffer)
    this.didJump = false;
    if (inp.jump) this.jumpBuf = 0.14; else this.jumpBuf -= dt;
    if (this.jumpBuf > 0 && !locked) {
      if (beached && !this.jumped) {
        vel.y = Math.max(vel.y, 0) + P.jumpV * 0.9;
        this.jumped = true; this.jumpT = 0; this.didJump = true; this.jumpBuf = 0; this.holdT = P.holdTime;
      } else if (this.airT < 0.12 && !this.jumped) {
        const vu = vel.dot(up); // קפיצה מלאה גם מיד אחרי נחיתה
        if (vu < 0) vel.vsub(up.scale(vu, tmp), vel);
        vel.vadd(up.scale(P.jumpV, tmp), vel);
        this.jumped = true; this.jumpT = 0; this.airT = 0.12; this.didJump = true; this.jumpBuf = 0; this.holdT = P.holdTime;
      } else if (inp.jump && this.airJumps > 0) {
        vel.y = Math.max(vel.y, P.airJumpV);
        vel.x += up.x * 3; vel.z += up.z * 3;
        this.airJumps--; this.didJump = true; this.jumpBuf = 0; this.holdT = 0;
      }
    }
    if (this.holdT > 0) {
      this.holdT -= dt;
      if (inp.jumpHeld && !locked) vel.y += P.jumpHold * dt; else this.holdT = 0;
    }

    // שליטה וייצוב באוויר
    if (grounded === 0) {
      q.conjugate(qi);
      qi.vmult(av, wl);
      wl.x += inp.pitch * 16 * dt; wl.z += inp.roll * 18 * dt;
      wl.x *= 1 - (inp.pitch ? 0.5 : 3) * dt;
      wl.z *= 1 - (inp.roll ? 0.5 : 3) * dt;
      wl.y *= 1 - 3 * dt;
      const m = wl.length();
      if (m > 6.5) wl.scale(6.5 / m, wl);
      q.vmult(wl, av);
      if (!beached) {
        // היגוי באוויר: מסובב את כיוון התנועה עצמו – אפשר לעקוף מעל התהום ולחזור למסלול
        if (inp.steer) {
          const a = inp.steer * P.airTurn * dt, ca = Math.cos(a), sa = Math.sin(a), vx = vel.x, vz = vel.z;
          vel.x = vx * ca + vz * sa; vel.z = -vx * sa + vz * ca;
          av.y += (inp.steer * P.airTurn * 1.15 - av.y) * Math.min(1, 10 * dt);
        }
        // גז/ברקס באוויר: שליטה עדינה במרחק הקפיצה
        const fhh = Math.hypot(fwd.x, fwd.z);
        if (th && fhh > 0.3) {
          const fx = fwd.x / fhh, fz = fwd.z / fhh, along = vel.x * fx + vel.z * fz;
          if ((th > 0 && along < P.maxSpeed) || (th < 0 && along > -P.reverse)) {
            const a = th * (th > 0 ? P.airAcc : P.airAcc * 1.4) * dt;
            vel.x += fx * a; vel.z += fz * a;
          }
        }
      }
      if (!inp.pitch && !inp.roll && this.airT > 0.2) {
        const s = vel.length();
        D.set(0, 1, 0);
        const fh = Math.hypot(fwd.x, fwd.z);
        if (s > 4 && fh > 0.2) {
          const tilt = clamp(-vel.y / s, -0.7, 0.7) * 0.3;
          D.set((fwd.x / fh) * tilt, 1, (fwd.z / fh) * tilt);
          D.normalize();
        }
        up.cross(D, tmp);
        if (up.dot(D) < 0) { if (tmp.length() < 1e-3) tmp.copy(fwd); tmp.normalize(); }
        av.vadd(tmp.scale(14 * dt, tmp), av);
      }
      // הפוך ותקוע – מתהפך חזרה
      if (up.y < 0.3 && vel.length() < 4) this.flipT += dt; else this.flipT = 0;
      if (this.flipT > 0.8) { vel.y = 6.5; av.vadd(fwd.scale(5.5, tmp), av); this.flipT = 0; }
    } else this.flipT = 0;
  }
}

// ---------- מראה המכונית ----------

export const SKIN_OPTS = {
  types: ['וייפר', 'טיטאן', 'להב', 'נקניקייה', 'בננה', 'ארגז קרטון', 'גבינה', 'ברווז ענק', 'אסלה', 'נעל'],
  finishes: ['מבריק', 'מטאלי', 'מט', 'כרום'],
  wheels: ['קלאסי', 'ניאון', 'חישורים', 'דיסק מלא', 'טבעות ניאון'],
  spoilers: ['ללא', 'כנף', 'כנף מירוץ', 'סנפיר'],
  toppers: ['ללא', 'אנטנה', 'כתר', 'קרניים', 'מדחף', 'הילה', 'ברווז גומי'],
  colors: ['#1e7bff', '#ff7a1a', '#ff2d55', '#22d38a', '#ffd21a', '#b14dff', '#00e5ff', '#ff5ad1', '#ffffff', '#20242e', '#8a5a2b', '#9be600'],
};
export const DEFAULT_SKIN = {
  type: 0, color: '#1e7bff', accent: '#ff7a1a', finish: 0, wheel: 1, rim: '#ffffff',
  spoiler: 1, topper: 0, glow: '#00e5ff', trail: '#ff9a2e', wrap: 0, grad: 0, feather: 0, tfx: 0, horn: 1,
};

const TYPES = [
  { // וייפר – ספורטיבית נמוכה
    body: [[-1.95, -0.3], [1.85, -0.3], [2.05, -0.12], [2.0, 0.02], [0.9, 0.2], [-1.2, 0.3], [-1.95, 0.34], [-2.02, 0.1]],
    width: 1.62, cabin: [[0.85, 0.18], [0.15, 0.6], [-0.75, 0.6], [-1.45, 0.28]], cabW: 1.3, wheelR: 0.37,
    head: [-0.02, 1.96], tail: [0.34, -1.72], roof: [0.62, -0.3],
  },
  { // טיטאן – שרירית וגבוהה
    body: [[-1.95, -0.3], [1.9, -0.3], [2.02, -0.05], [1.98, 0.3], [0.8, 0.36], [-1.9, 0.42], [-2.0, 0.1]],
    width: 1.72, cabin: [[0.8, 0.34], [0.5, 0.82], [-0.9, 0.84], [-1.15, 0.4]], cabW: 1.5, wheelR: 0.43,
    head: [0.14, 1.97], tail: [0.42, -1.7], roof: [0.86, -0.2],
  },
  { // להב – טריז עתידני
    body: [[-1.95, -0.3], [1.6, -0.3], [2.1, -0.22], [2.05, -0.12], [0.6, 0.1], [-0.9, 0.22], [-1.9, 0.42], [-2.0, 0.05]],
    width: 1.5, cabin: [[0.5, 0.08], [-0.1, 0.46], [-0.7, 0.48], [-1.3, 0.26]], cabW: 0.92, wheelR: 0.36,
    head: [-0.16, 2.02], tail: [0.42, -1.7], roof: [0.5, -0.4],
  },
  // רכבי מם (נקנים בחנות): במקום מרכב רגיל נבנה מהם פסל קטן על גלגלים
  { meme: 'hotdog', width: 1.6, wheelR: 0.37, tail: [0.62, -1.5], roof: [0.72, 0] },
  { meme: 'banana', width: 1.5, wheelR: 0.37, tail: [0.95, -1.7], roof: [0.35, 0] },
  { meme: 'box', width: 1.7, wheelR: 0.37, tail: [0.62, -1.6], roof: [0.62, 0] },
  { meme: 'cheese', width: 1.6, wheelR: 0.37, tail: [1.0, -1.8], roof: [0.55, -0.4] },
  { meme: 'duck', width: 1.7, wheelR: 0.4, tail: [0.75, -1.5], roof: [1.72, 0.9] },
  { meme: 'toilet', width: 1.5, wheelR: 0.37, tail: [1.05, -1.25], roof: [1.05, -1.25] },
  { meme: 'shoe', width: 1.5, wheelR: 0.37, tail: [1.15, -1.5], roof: [1.15, -1.1] },
];

function buildMeme(kind, add, s, accent, dark) {
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.6, ...o });
  const black = mat(0x111111, { roughness: 0.3 });
  const eyes = (y, z, dx = 0.3, r = 0.09) => { for (const sx of [-1, 1]) add(new THREE.SphereGeometry(r, 10, 8), black, sx * dx, y, z); };
  if (kind === 'hotdog') {
    const bun = mat(0xd9a55a), cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14).rotateX(Math.PI / 2);
    for (const sx of [-1, 1]) add(cap(0.42, 2.7), bun, sx * 0.4, 0.02, 0);
    add(cap(0.36, 3.3), mat(0xb5332a, { roughness: 0.35 }), 0, 0.34, 0);
    const mustard = mat(0xffd21a, { roughness: 0.3 });
    for (let i = 0; i < 9; i++) add(new THREE.BoxGeometry(0.34, 0.07, 0.12), mustard, 0, 0.71, -1.2 + i * 0.3).rotation.y = i % 2 ? 0.8 : -0.8;
  } else if (kind === 'banana') {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.95, -2.1), new THREE.Vector3(0, -0.75, 0), new THREE.Vector3(0, 0.95, 2.1));
    add(new THREE.TubeGeometry(curve, 24, 0.5, 10), mat(0xffe135, { roughness: 0.4 })).scale.x = 1.35;
    const tip = mat(0x4a3210);
    add(new THREE.ConeGeometry(0.2, 0.5, 8), tip, 0, 1.12, 2.22).rotation.x = 0.9;
    add(new THREE.CylinderGeometry(0.12, 0.2, 0.5, 8), tip, 0, 1.12, -2.22).rotation.x = -0.9;
    eyes(0.36, 1.55, 0.26);
  } else if (kind === 'box') {
    const card = mat(0xc49a6c, { roughness: 0.9 });
    add(new THREE.BoxGeometry(1.7, 0.9, 3.7), card, 0, 0.15, 0);
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.75, 0.04, 3.7), card, sx * 1.12, 0.78, 0).rotation.z = sx * 0.55;
    add(new THREE.BoxGeometry(0.22, 0.02, 3.72), mat(0xe9dcb8), 0, 0.61, 0);
    eyes(0.3, 1.86, 0.4, 0.13);
    add(new THREE.BoxGeometry(0.6, 0.07, 0.04), black, 0, -0.02, 1.86);
  } else if (kind === 'cheese') {
    const ch = mat(0xffc83d, { roughness: 0.45 });
    add(extrude([[-2, -0.3], [2, -0.3], [-2, 1.05]], 1.6, 0.05), ch);
    const hole = mat(0xd98a1a);
    for (const [z, y, r] of [[-1.3, 0.25, 0.26], [-0.3, 0.05, 0.2], [0.6, -0.08, 0.13], [-1.5, 0.7, 0.14], [-0.7, 0.42, 0.11]]) {
      for (const sx of [-1, 1]) add(new THREE.CircleGeometry(r, 16).rotateY((sx * Math.PI) / 2), hole, sx * 0.81, y, z).castShadow = false;
    }
  } else if (kind === 'duck') {
    const yel = mat(0xffd21a, { roughness: 0.3 });
    add(new THREE.SphereGeometry(1, 20, 14), yel, 0, 0.3, -0.2).scale.set(0.95, 0.72, 1.75);
    add(new THREE.SphereGeometry(0.6, 18, 12), yel, 0, 1.12, 0.9);
    add(new THREE.ConeGeometry(0.42, 0.9, 10), yel, 0, 0.75, -1.85).rotation.x = -0.9;
    add(new THREE.ConeGeometry(0.24, 0.5, 10).rotateX(Math.PI / 2), mat(0xff7a1a), 0, 1.02, 1.6).scale.set(1.5, 0.6, 1);
    eyes(1.3, 1.36, 0.25, 0.08);
  } else if (kind === 'toilet') {
    const white = mat(0xf4f6fa, { roughness: 0.2 });
    add(new THREE.BoxGeometry(1.3, 0.3, 3.5), white, 0, -0.18, 0);
    add(new THREE.CylinderGeometry(0.78, 0.5, 0.8, 18), white, 0, 0.35, 0.55);
    add(new THREE.TorusGeometry(0.62, 0.12, 8, 22).rotateX(Math.PI / 2), white, 0, 0.78, 0.55);
    add(new THREE.CircleGeometry(0.55, 18).rotateX(-Math.PI / 2), mat(0x4fb8ff, { roughness: 0.1 }), 0, 0.7, 0.55).castShadow = false;
    add(new THREE.BoxGeometry(1.35, 1.05, 0.6), white, 0, 0.5, -1.25);
    add(new THREE.BoxGeometry(1.45, 0.1, 0.7), white, 0, 1.05, -1.25);
    add(new THREE.BoxGeometry(0.22, 0.06, 0.06), mat(0xb8c2d0, { metalness: 0.9, roughness: 0.3 }), 0.5, 0.85, -0.93);
  } else if (kind === 'shoe') {
    const col = mat(s.color, { roughness: 0.6 }), white = mat(0xf2f2f2);
    add(new THREE.BoxGeometry(1.55, 0.22, 4), white, 0, -0.22, 0);
    add(new THREE.CapsuleGeometry(0.68, 1.5, 6, 14).rotateX(Math.PI / 2), col, 0, 0.2, 0.7).scale.set(1.08, 0.72, 1);
    add(new THREE.BoxGeometry(1.45, 1.25, 1.5), col, 0, 0.52, -1.1);
    add(new THREE.TorusGeometry(0.55, 0.1, 8, 18).rotateX(Math.PI / 2), white, 0, 1.16, -1.1);
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.9, 0.05, 0.08), white, 0, 0.7 - i * 0.03, -0.2 + i * 0.36);
  }
  // פנס אחורי קטן, כדי שיהיה ברור לאן הרכב נוסע
  add(new THREE.BoxGeometry(0.9, 0.07, 0.06), new THREE.MeshBasicMaterial({ color: hdr(0xff1a2e, 2.2) }), 0, -0.22, -2.02);
  add(new THREE.BoxGeometry(1.2, 0.1, 3.4), dark, 0, -0.36, 0);
}

function extrude(pts, width, bevel) {
  const shape = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2);
  return g;
}

function paintMat(color, finish) {
  const o = [
    { metalness: 0.2, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.22 },
    { metalness: 0.85, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 },
    { metalness: 0.1, roughness: 0.85, clearcoat: 0 },
    { metalness: 1, roughness: 0.2, clearcoat: 0 },
  ][finish] || {};
  return new THREE.MeshPhysicalMaterial({ color, envMapIntensity: 1.1, ...o });
}
const hdr = (hex, k = 2.4) => new THREE.Color(hex).multiplyScalar(k);

// טקסטורת צבע למרכב: צבע/גרדיאנט + טפט. u = לאורך המכונית (1 = חזית), v = לרוחב
function paintTex(s) {
  const c = document.createElement('canvas'), W = (c.width = 256), H = (c.height = 128);
  const g = c.getContext('2d'), G = GRADS[s.grad], a = s.accent;
  if (G) { const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, G.b); gr.addColorStop(1, G.a); g.fillStyle = gr; } else g.fillStyle = s.color;
  g.fillRect(0, 0, W, H);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = a; g.strokeStyle = a;
  switch (s.wrap) {
    case 1: g.fillRect(0, H * 0.39, W, H * 0.08); g.fillRect(0, H * 0.53, W, H * 0.08); break;
    case 2: {
      const gr = g.createLinearGradient(W, 0, W - 170, 0);
      gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.35, '#ffb21a'); gr.addColorStop(1, '#ff2d00');
      g.fillStyle = gr;
      for (let i = 0; i < 8; i++) {
        const y = (i * H) / 8, len = 70 + rnd() * 100;
        g.beginPath(); g.moveTo(W, y - 3); g.quadraticCurveTo(W - len * 0.5, y + H / 16 - 8, W - len, y + H / 16); g.quadraticCurveTo(W - len * 0.4, y + H / 16 + 6, W, y + H / 8 + 3); g.fill();
      }
      break;
    }
    case 3:
      for (let i = 0; i < 46; i++) {
        g.fillStyle = ['rgba(0,0,0,.3)', 'rgba(255,255,255,.16)', a][i % 3];
        g.globalAlpha = i % 3 === 2 ? 0.45 : 1;
        g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 8 + rnd() * 22, 5 + rnd() * 12, rnd() * 3, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      break;
    case 4:
      for (let y = 0; y < 8; y++) for (let x = 0; x < 7; x++) if ((x + y) % 2) { g.globalAlpha = 1 - x / 8; g.fillRect(x * 16, y * 16, 16, 16); }
      g.globalAlpha = 1;
      break;
    case 5:
      for (const y0 of [0.2, 0.5, 0.8]) for (const [lw, col] of [[7, a], [2.5, '#ffffff']]) {
        seed = 5 + y0 * 100;
        g.lineWidth = lw; g.strokeStyle = col; g.lineJoin = 'miter';
        g.beginPath(); g.moveTo(W, y0 * H);
        for (let x = W - 26; x > 10; x -= 26) g.lineTo(x, y0 * H + (rnd() - 0.5) * 30);
        g.stroke();
      }
      break;
    case 6:
      for (let x = -H; x < W; x += 30) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 13, H); g.lineTo(x + 13 + H * 0.7, 0); g.lineTo(x + H * 0.7, 0); g.fill(); }
      break;
    case 7:
      g.lineWidth = 2.5; g.globalAlpha = 0.85;
      for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) {
        const cx = x * 18 + (y % 2 ? 9 : 0), cy = y * 15.6;
        g.beginPath();
        for (let k = 0; k < 6; k++) { const an = (k / 6) * Math.PI * 2 + Math.PI / 6; g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(an) * 9.5, cy + Math.sin(an) * 9.5); }
        g.closePath(); g.stroke();
      }
      g.globalAlpha = 1;
      break;
    default:
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function projectUV(geo, W) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    uv.setXY(i, clamp((p.getZ(i) + 2.1) / 4.2, 0, 1), clamp(0.5 + (x / W) * 0.4 + Math.sign(x) * Math.max(0, 0.3 - y) * 0.25, 0.01, 0.99));
  }
}

let glowTex = null;
function getGlowTex() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export class CarVisual {
  constructor(skin, name) {
    this.group = new THREE.Group();
    this.wheels = [];
    this.flames = [];
    this.prop = null;
    this.feathers = [];
    this.skin = { ...DEFAULT_SKIN, ...skin };
    this.build();
    if (name) this.setName(name);
  }

  build() {
    const s = this.skin, T = TYPES[s.type] || TYPES[0], g = this.group;
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    const G = GRADS[s.grad], fancy = !!(G || s.wrap);
    const paint = paintMat(G ? new THREE.Color(G.a).lerp(new THREE.Color(G.b), 0.5) : s.color, s.finish);
    let bodyPaint = paint;
    if (fancy) { bodyPaint = paintMat(0xffffff, s.finish); bodyPaint.map = paintTex(s); }
    const accent = new THREE.MeshStandardMaterial({ color: s.accent, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.4, roughness: 0.65 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x08121e, metalness: 0.8, roughness: 0.3, envMapIntensity: 0.8 });
    const W = T.width;

    if (T.meme) buildMeme(T.meme, add, s, accent, dark); else {
    const bodyGeo = extrude(T.body, W, 0.07);
    if (fancy) projectUV(bodyGeo, W);
    add(bodyGeo, bodyPaint);
    add(extrude(T.cabin, T.cabW, 0.05), glass);
    add(new THREE.BoxGeometry(W + 0.14, 0.12, 2.3), accent, 0, -0.3, 0);          // סף צד
    add(new THREE.BoxGeometry(W + 0.1, 0.06, 0.5), accent, 0, -0.33, 1.82);       // ספליטר
    add(new THREE.BoxGeometry(W * 0.7, 0.16, 0.2), dark, 0, -0.2, -1.98);         // דיפיוזר
    // פנסים
    const headMat = new THREE.MeshBasicMaterial({ color: hdr(0xfff2c8, 2.2) });
    const tailMat = new THREE.MeshBasicMaterial({ color: hdr(0xff1a2e, 2.2) });
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.34, 0.08, 0.08), headMat, sx * (W / 2 - 0.3), T.head[0], T.head[1]);
    add(new THREE.BoxGeometry(W * 0.82, 0.07, 0.06), tailMat, 0, T.tail[0] - 0.14, -2.0);
    // כנפיים מעל הגלגלים
    for (const [x, z] of [[P.wheelX, P.wheelZf], [-P.wheelX, P.wheelZf], [P.wheelX, P.wheelZr], [-P.wheelX, P.wheelZr]]) {
      add(new THREE.BoxGeometry(0.36, 0.07, 0.95), paint, x, -0.32 + T.wheelR + 0.07, z);
    }
    }

    // גלגלים
    const R = T.wheelR;
    const tireGeo = new THREE.CylinderGeometry(R, R, 0.34, 22).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.36, 14).rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: s.rim, metalness: 0.8, roughness: 0.4, envMapIntensity: 0.7 });
    const neonMat = new THREE.MeshBasicMaterial({ color: hdr(s.glow, 2.2) });
    this.wheels = [];
    for (const [x, z, front] of [[P.wheelX, P.wheelZf, 1], [-P.wheelX, P.wheelZf, 1], [P.wheelX, P.wheelZr, 0], [-P.wheelX, P.wheelZr, 0]]) {
      const pivot = new THREE.Group(), spin = new THREE.Group();
      pivot.position.set(x, P.mountY - (RAY - 0.13) + P.radius, z);
      pivot.add(spin);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      spin.add(tire, new THREE.Mesh(rimGeo, rimMat));
      if (s.wheel === 1) {
        for (const sx of [-1, 1]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.78, 0.03, 6, 24).rotateY(Math.PI / 2), neonMat);
          ring.position.x = sx * 0.175;
          spin.add(ring);
        }
      }
      if (s.wheel === 3) {
        spin.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.9, R * 0.9, 0.37, 22).rotateZ(Math.PI / 2), rimMat));
        spin.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.22, R * 0.22, 0.4, 12).rotateZ(Math.PI / 2), neonMat));
      } else if (s.wheel === 4) {
        for (const sx of [-1, 1]) for (const k of [0.45, 0.68, 0.9]) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(R * k, 0.025, 6, 24).rotateY(Math.PI / 2), neonMat);
          ring.position.x = sx * 0.178;
          spin.add(ring);
        }
      }
      const spokes = s.wheel === 2 ? 5 : s.wheel === 3 ? 0 : 2;
      for (let i = 0; i < spokes; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.38, R * 1.5, 0.07), s.wheel === 2 ? rimMat : dark);
        sp.rotation.x = (i / spokes) * Math.PI;
        spin.add(sp);
      }
      g.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }

    // ספוילר
    const [ty, tz] = T.tail;
    if (s.spoiler === 1 || s.spoiler === 2) {
      const big = s.spoiler === 2, h = big ? 0.52 : 0.28;
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.07, h, 0.22), dark, sx * 0.5, ty + h / 2, tz);
      add(new THREE.BoxGeometry(W + (big ? 0.5 : 0.1), 0.05, big ? 0.6 : 0.42), accent, 0, ty + h, tz - 0.05).rotation.x = 0.12;
      if (big) for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.3, 0.66), paint, sx * (W / 2 + 0.25), ty + h, tz - 0.05);
    } else if (s.spoiler === 3) {
      const fin = new THREE.Shape();
      fin.moveTo(0.5, 0); fin.lineTo(-0.45, 0); fin.lineTo(-0.6, 0.62); fin.lineTo(-0.3, 0.62); fin.closePath();
      const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.07, bevelEnabled: false }).translate(0, 0, -0.035).rotateY(-Math.PI / 2);
      add(fg, accent, 0, ty - 0.03, tz + 0.2);
    }

    // קישוט גג
    const [ry, rz] = T.roof;
    if (s.topper === 1) {
      add(new THREE.CylinderGeometry(0.015, 0.02, 0.95, 6), dark, 0.4, ry + 0.45, rz - 0.3);
      add(new THREE.SphereGeometry(0.08, 12, 8), neonMat, 0.4, ry + 0.95, rz - 0.3);
    } else if (s.topper === 2) {
      const gold = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.2 });
      add(new THREE.CylinderGeometry(0.26, 0.24, 0.14, 10, 1, true), gold, 0, ry + 0.07, rz).material.side = THREE.DoubleSide;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.07, 0.2, 5), gold, Math.cos(a) * 0.25, ry + 0.23, rz + Math.sin(a) * 0.25);
      }
    } else if (s.topper === 3) {
      const bone = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.5 });
      for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.09, 0.5, 8), bone, sx * 0.36, ry + 0.18, rz).rotation.z = -sx * 0.6;
    } else if (s.topper === 4) {
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6), dark, 0, ry + 0.13, rz);
      this.prop = add(new THREE.BoxGeometry(1.0, 0.025, 0.12), accent, 0, ry + 0.27, rz);
    }

    else if (s.topper === 5) {
      const halo = add(new THREE.TorusGeometry(0.3, 0.035, 8, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: hdr(0xffe27a, 2.6) }), 0, ry + 0.42, rz);
      halo.castShadow = false;
    } else if (s.topper === 6) {
      const yel = new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.35 });
      add(new THREE.SphereGeometry(0.2, 14, 10), yel, 0, ry + 0.16, rz).scale.set(1, 0.8, 1.25);
      add(new THREE.SphereGeometry(0.13, 12, 9), yel, 0, ry + 0.38, rz + 0.14);
      add(new THREE.ConeGeometry(0.05, 0.14, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 }), 0, ry + 0.36, rz + 0.3);
    }

    // נוצות זנב
    this.feathers = [];
    const FT = FEATHERS[s.feather];
    if (FT) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.quadraticCurveTo(0.2, 0.45, 0.05, 1.02); sh.lineTo(0, 1.14); sh.lineTo(-0.05, 1.02); sh.quadraticCurveTo(-0.2, 0.45, 0, 0);
      const fg = new THREE.ShapeGeometry(sh, 6), n = 7;
      for (let i = 0; i < n; i++) {
        const k = i - (n - 1) / 2, col = FT.c[i % FT.c.length];
        const m = add(fg, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3, side: THREE.DoubleSide, roughness: 0.6 }), k * 0.11, ty - 0.02, tz - 0.12 - Math.abs(k) * 0.02);
        m.rotation.set(-0.75, 0, -k * 0.24);
        m.scale.setScalar(1 - Math.abs(k) * 0.07);
        this.feathers.push(m);
      }
    }

    // זוהר תחתי
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 5.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: getGlowTex(), color: hdr(s.glow, 1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.position.y = -0.52;
    g.add(glow);

    // להבות בוסט
    const flameMat = new THREE.MeshBasicMaterial({ color: hdr(s.trail, 3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flames = [];
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.3, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.65), flameMat);
      f.position.set(sx * 0.38, -0.12, -2.02);
      f.visible = false;
      g.add(f);
      this.flames.push(f);
    }
    this.trailColor = new THREE.Color(s.trail);
  }

  setName(name) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.font = '800 34px Rubik, Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 7; x.strokeStyle = 'rgba(0,0,0,.75)';
    x.strokeText(name, 128, 34);
    x.fillStyle = '#fff';
    x.fillText(name, 128, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    sp.scale.set(3.4, 0.85, 1);
    sp.position.y = 2.2;
    this.group.add(sp);
  }

  // סימון מעל המכונית (למשל "התופס" בתופסת)
  setMark(on) {
    if (!!this.mark === !!on) return;
    if (this.mark) { this.mark.geometry.dispose(); this.mark.material.dispose(); this.mark.removeFromParent(); this.mark = null; return; }
    this.mark = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: hdr(0xff1a2e, 3) }));
    this.mark.position.y = 3.2;
    this.group.add(this.mark);
  }

  // אימוג'י שצף מעל המכונית לכמה שניות
  emote(txt) {
    if (this.emo) { this.emo.material.map.dispose(); this.emo.material.dispose(); this.emo.removeFromParent(); }
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.font = '96px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(txt, 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = (this.emo = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })));
    sp.scale.set(2.2, 2.2, 1);
    sp.position.y = 3.6;
    this.group.add(sp);
    clearTimeout(this.emoT);
    this.emoT = setTimeout(() => { if (this.emo === sp) { sp.material.map.dispose(); sp.material.dispose(); sp.removeFromParent(); this.emo = null; } }, 2600);
  }

  // lens = מרחק קרן לכל גלגל (null = מנוחה)
  update(steer, lens, spin, boosting, t) {
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const len = lens ? lens[i].len : RAY - 0.13;
      w.pivot.position.y = P.mountY - len + P.radius;
      if (w.front) w.pivot.rotation.y = steer;
      w.spin.rotation.x = spin;
    }
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.6);
    }
    if (this.prop) this.prop.rotation.y = t * 18;
    for (let i = 0; i < this.feathers.length; i++) this.feathers[i].rotation.x = -0.75 + Math.sin(t * 5 + i * 0.9) * 0.07 - (boosting ? 0.25 : 0);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map && o.material.map !== glowTex) o.material.map.dispose(); o.material.dispose(); }
    });
    this.group.removeFromParent();
  }
}
