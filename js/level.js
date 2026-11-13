// בניית מסלולים: "צב" שמתקדם ומניח קטעים, רמפות, מכשולים זזים, כפתורים, שערים ומעליות
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G_WORLD, G_CAR, G_KIN } from './car.js';
import { tex } from './fx.js';

export const CHAIN_LEN = 14;

const THEMES = {
  race: { floor: 0x2c4f8f, ramp: 0xff8a2b, wall: 0x1c2c52, hazard: 0xff3355, trimA: 0x19d3ff, trimB: 0xff7a1a, sky: [0x0a1a5c, 0x6a3fb8, 0x05060f] },
  race2: { floor: 0x1f6f7a, ramp: 0xff4f9a, wall: 0x143c46, hazard: 0xffc21a, trimA: 0x3dffd0, trimB: 0xff5ab0, sky: [0x06284a, 0x2aa7a0, 0x040b12] },
  race3: { floor: 0x7a2f2f, ramp: 0xffc233, wall: 0x3a1616, hazard: 0x19d3ff, trimA: 0xff7a3d, trimB: 0xffe066, sky: [0x2a0612, 0xd0552a, 0x0a0406] },
  chain: { floor: 0x4a3390, ramp: 0x1fbf80, wall: 0x2a1d55, hazard: 0xffb41a, trimA: 0xd65bff, trimB: 0x2bffb0, sky: [0x1a0a4c, 0xb8407a, 0x07050f] },
  chain2: { floor: 0x2f5f3a, ramp: 0xff8a2b, wall: 0x183020, hazard: 0xff3355, trimA: 0x7dff5a, trimB: 0xffd21a, sky: [0x06301e, 0x3a9a6a, 0x030a06] },
};
const RACE_THEMES = ['race', 'race2', 'race3'], CHAIN_THEMES = ['chain', 'chain2'];
export const RACE_LEVELS = 30, CHAIN_LEVELS = 20;
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
  constructor(ctx, theme) {
    this.ctx = ctx;
    this.theme = theme;
    const T = (this.T = THEMES[theme]);
    this.p = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.buckets = {};
    this.group = new THREE.Group();
    this.cps = []; this.pads = []; this.dyn = []; this.buttons = []; this.finish = null; this.minY = 0;
    this.path = []; // נקודות לאורך המסלול – כדי שקישוטים לא יונחו עליו
    const std = (o) => new THREE.MeshStandardMaterial({ metalness: 0.15, roughness: 0.72, envMapIntensity: 0.6, ...o });
    this.mats = {
      floor: std({ map: tex.grid, color: T.floor }),
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
    geo.applyMatrix4(new THREE.Matrix4().compose(c, q, ONE));
    (this.buckets[key] ||= []).push(geo);
  }
  body(c, size, q) {
    const b = new CANNON.Body({
      mass: 0, material: this.ctx.groundMat, shape: new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)),
      position: new CANNON.Vec3(c.x, c.y, c.z), quaternion: new CANNON.Quaternion(q.x, q.y, q.z, q.w),
      collisionFilterGroup: G_WORLD, collisionFilterMask: G_CAR,
    });
    this.ctx.world.addBody(b);
  }
  solid(c, size, q, key, collide = true) {
    this.addGeo(key, boxGeo(size[0], size[1], size[2]), c, q);
    if (collide) this.body(c, size, q);
    this.minY = Math.min(this.minY, c.y - size[1]);
  }

  // קטע משטח: len קדימה, rise עלייה
  seg(len, o = {}) {
    const { w = 14, rise = 0, off = 0, thick = 1.2, stay = false } = o;
    const f = this.F(), l = this.Lf();
    const slope = Math.hypot(len, rise), q = this.quat(-Math.atan2(rise, len));
    const n = UP.clone().applyQuaternion(q);
    const mid = this.p.clone().addScaledVector(f, len / 2).addScaledVector(l, off);
    mid.y += rise / 2;
    this.solid(mid.clone().addScaledVector(n, -thick / 2), [w, thick, slope], q, rise ? 'ramp' : 'floor');
    for (const s of [-1, 1]) {
      this.addGeo(rise ? 'trimB' : 'trimA', new THREE.BoxGeometry(0.28, 0.1, slope), mid.clone().addScaledVector(l, s * (w / 2 - 0.14)).addScaledVector(n, 0.03), q);
    }
    this.mark(len, off);
    if (!stay) { this.p.addScaledVector(f, len); this.p.y += rise; }
  }
  mark(len, off = 0) {
    const f = this.F(), l = this.Lf();
    for (let d = 0; d <= len; d += 8) this.path.push(this.p.clone().addScaledVector(f, d).addScaledVector(l, off));
  }
  gap(len, rise = 0) { this.mark(len); this.p.addScaledVector(this.F(), len); this.p.y += rise; }

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
    this.seg(size, { w: size });
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
    if (this.cps.length) {
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
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pts = [...this.cps, this.finish].filter(Boolean);
    for (const z of pts) {
      for (let i = 0; i < 9; i++) {
        const side = rnd() > 0.5 ? 1 : -1, s = 4 + rnd() * 12;
        const c = z.pos.clone().addScaledVector(z.l, side * (38 + rnd() * 70)).addScaledVector(z.f, rnd() * 90 - 45);
        c.y += rnd() * 70 - 50;
        if (this.path.some((pt) => Math.hypot(pt.x - c.x, pt.z - c.z) < 24 + s)) continue;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 3, rnd()));
        this.addGeo('wall', boxGeo(s, s * (0.5 + rnd() * 2), s), c, q);
        this.addGeo(rnd() > 0.5 ? 'trimA' : 'trimB', new THREE.BoxGeometry(s * 1.03, 0.25, s * 1.03), c, q);
      }
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
    const { cps, pads, dyn, buttons, finish, group, mats, theme } = this;
    const tq = new THREE.Quaternion();
    const green = hdr(0x2bff7a, 1.4), idle = hdr(this.T.trimB, 1.4);
    return {
      theme, sky: this.T.sky, group, cps, pads, dyn, buttons, finish, killY: this.minY - 40,

      inZone(z, p) {
        const dx = p.x - z.pos.x, dy = p.y - z.pos.y, dz = p.z - z.pos.z;
        return Math.abs(dx * z.f.x + dz * z.f.z) < 3.5 && Math.abs(dx * z.l.x + dz * z.l.z) < z.w / 2 + 1.5 && dy > -1 && dy < 9;
      },
      inPad(pd, p) {
        const dx = p.x - pd.pos.x, dy = p.y - pd.pos.y, dz = p.z - pd.pos.z;
        return Math.abs(dx * pd.f.x + dz * pd.f.z) < 3 && Math.abs(dx * pd.l.x + dz * pd.l.z) < 2 && dy > -0.5 && dy < 2.2;
      },
      spawn(i, slot, count = 1) {
        const z = cps[clamp(i, 0, cps.length - 1)], cols = Math.min(4, count);
        const col = slot % 4, row = Math.floor(slot / 4);
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
const R_UNLOCK = { straight: 1, hurdles: 1, rampJump: 1, pillars: 2, sliders: 4, stairs: 5, bigJump: 6, sweepers: 7, rails: 8, hammers: 9, movers: 11, islands: 12 };

function genRace(b, L) {
  const d = (L - 1) / (RACE_LEVELS - 1), r = rng(L * 7919 + 13), w = Math.round(lerp(18, 11, d));
  const pool = Object.keys(R_UNLOCK).filter((k) => R_UNLOCK[k] <= L);
  const fresh = Object.keys(R_UNLOCK).filter((k) => R_UNLOCK[k] === L && k !== 'straight');
  const n = Math.round(lerp(4, 13, d));
  b.cp(14, w + 4); b.arch(27, w + 4, 'start');
  b.seg(34, { w: w + 4 });
  b.pad(10, 0);
  b.seg(30, { w });
  let last = '', dir = -1, since = 0;
  for (let i = 0; i < n; i++) {
    let k;
    if (i < fresh.length) k = fresh[i]; // קטע חדש מוצג בתחילת השלב שבו הוא נפתח
    else do { k = pool[Math.floor(r() * pool.length)]; } while (k === last || (k === 'straight' && d > 0.5));
    last = k;
    if (d < 0.55 || i % 2 === 0) b.cp(8, w);
    b.seg(18, { w });
    R[k](b, d, r, w);
    since++;
    if (L >= 2 && since >= 3 && i < n - 1) {
      b.seg(12, { w });
      b.plaza(Math.max(26, w + 10), 90 * dir);
      dir = -dir; since = 0;
    }
  }
  b.seg(20, { w });
  b.finishLine(28, w + 8);
  b.wall(63, 0, [w + 8, 2, 0.8]);
  b.seg(64, { w: w + 8 });
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

export function buildLevel(mode, level, ctx) {
  const chain = mode === 'chain';
  const L = clamp(Math.round(level) || 1, 1, chain ? CHAIN_LEVELS : RACE_LEVELS);
  const themes = chain ? CHAIN_THEMES : RACE_THEMES;
  const b = new Builder(ctx, themes[Math.floor((L - 1) / 3) % themes.length]);
  if (chain) { if (L === HAND_CHAIN) chainCourse(b); else genChain(b, L); } else if (L === HAND_RACE) raceCourse(b); else genRace(b, L);
  const lv = b.build();
  lv.level = L;
  return lv;
}
