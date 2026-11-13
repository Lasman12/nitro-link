// מכונית: פיזיקה ארקיידית (מתלים בקרני-ריי, קפיצה, בוסט, שליטה באוויר) + מודל תלת-ממדי להתאמה אישית
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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
    this.steer = 0; this.spin = 0; this.boost = 100;
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
          let Fl = -vs * (P.mass / 4) * (drifting ? 5 : 32);
          const maxL = (drifting ? 0.55 : 2.4) * Math.max(Fs, P.mass * P.gravity * 0.15);
          Fl = clamp(Fl, -maxL, maxL);
          // הנעה / בלימה
          let Fd;
          if (th !== 0) {
            if (th * vfw >= 0 || Math.abs(vfw) < 1.5) {
              const lim = th > 0 ? (this.boosting ? P.boostSpeed : P.maxSpeed) : P.reverse;
              const a = Math.abs(vfw);
              Fd = th * P.engine * (a < lim * 0.75 ? 1 : Math.max(0, (lim - a) / (lim * 0.25)));
            } else Fd = th * P.brake;
          } else Fd = Math.abs(vfw) < 3 ? clamp(-vfw * 20, -25, 25) : -vfw * 0.5; // בלי גז ובמהירות נמוכה – בלם חניה, כדי שלא ייגרר
          if (locked) Fd = -vfw * 8;
          if (!this.boosting && Math.abs(vfw) > P.maxSpeed + 1) Fd -= Math.sign(vfw) * 5;
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
    if (grounded >= 2) {
      this.airT = 0; this.airJumps = 1;
      if (this.jumpT > 0.2) this.jumped = false;
    } else this.airT += dt;

    // הצמדה לקרקע (עוזר ברמפות)
    if (grounded >= 3) { nAvg.normalize(); b.force.vsub(nAvg.scale(P.mass * 6, tmp), b.force); }

    // בוסט
    if (this.boosting) {
      const f = clamp((P.boostSpeed + 2 - vel.dot(fwd)) / 6, 0, 1);
      b.force.vadd(fwd.scale(P.mass * P.boostAcc * f, tmp), b.force);
      this.boost = Math.max(0, this.boost - 28 * dt);
    } else if (grounded >= 2 && !inp.boost) this.boost = Math.min(100, this.boost + 9 * dt);

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
  types: ['וייפר', 'טיטאן', 'להב'],
  finishes: ['מבריק', 'מטאלי', 'מט', 'כרום'],
  wheels: ['קלאסי', 'ניאון', 'חישורים'],
  spoilers: ['ללא', 'כנף', 'כנף מירוץ', 'סנפיר'],
  toppers: ['ללא', 'אנטנה', 'כתר', 'קרניים', 'מדחף'],
  colors: ['#1e7bff', '#ff7a1a', '#ff2d55', '#22d38a', '#ffd21a', '#b14dff', '#00e5ff', '#ff5ad1', '#ffffff', '#20242e', '#8a5a2b', '#9be600'],
};
export const DEFAULT_SKIN = {
  type: 0, color: '#1e7bff', accent: '#ff7a1a', finish: 0, wheel: 1, rim: '#ffffff',
  spoiler: 1, topper: 0, glow: '#00e5ff', trail: '#ff9a2e',
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
];

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
    const paint = paintMat(s.color, s.finish);
    const accent = new THREE.MeshStandardMaterial({ color: s.accent, metalness: 0.5, roughness: 0.45, envMapIntensity: 0.7 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.4, roughness: 0.65 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x08121e, metalness: 0.8, roughness: 0.3, envMapIntensity: 0.8 });
    const W = T.width;

    add(extrude(T.body, W, 0.07), paint);
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
      const spokes = s.wheel === 2 ? 5 : 2;
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
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map && o.material.map !== glowTex) o.material.map.dispose(); o.material.dispose(); }
    });
    this.group.removeFromParent();
  }
}
