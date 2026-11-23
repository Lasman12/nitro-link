// בוטים: מכוניות שהמארח מריץ בעצמו (פיזיקה + נהיגה אוטומטית) ומשדר לשאר השחקנים כאילו היו שחקנים רגילים.
// לבוט יש אותו ממשק כמו Remote (שחקן מרוחק), כך ששאר המשחק לא מבדיל ביניהם.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { CarPhysics, CarVisual, P as CP, G_WORLD, G_CAR, G_KIN, G_REMOTE } from './car.js?v=1795464850';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const res = new CANNON.RaycastResult(), from = new CANNON.Vec3(), to = new CANNON.Vec3();
const RAY = { collisionFilterMask: G_WORLD | G_KIN, skipBackfaces: true };
const _f = new THREE.Vector3(), _q = new THREE.Quaternion();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const BOT_NAMES = ['טורבו', 'ברק', 'פיסטון', 'ספידי', 'בולט', 'ניטרון'];
export function botSkin(i) {
  const cols = ['#ff2d55', '#22d38a', '#ffd21a', '#b14dff', '#ff7a1a', '#00e5ff'];
  return { type: i % 3, color: cols[i % cols.length], accent: '#20242e', finish: 1, wheel: 2, rim: '#ffffff', spoiler: (i % 3) + 1, topper: 1, glow: cols[i % cols.length], trail: cols[(i + 2) % cols.length] };
}

export class Bot {
  constructor(game, pl) {
    this.isBot = true;
    this.id = pl.id; this.name = pl.name;
    this.lvl = clamp(Math.round(pl.lvl) || 4, 1, 7);
    this.k = (this.lvl - 1) / 6; // 0 = הכי קל, 1 = הכי קשה
    this.vis = new CarVisual(pl.skin, pl.name);
    game.scene.add(this.vis.group);
    this.car = new CarPhysics(game.world, game.carMat);
    this.body = this.car.body;
    this.body.collisionFilterMask = G_WORLD | G_KIN | G_REMOTE | G_CAR;
    this.body.remote = this;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion(); this.attach = new THREE.Vector3();
    this.nv = this.cv = this.body.velocity;
    this.has = true; this.gone = false; this.inWorld = true; this.supported = true; this.boosting = false;
    this.lives = 3; this.kos = 0; this.out = 0; this.cp = 0; this.lap = 0; this.prog = 0; this.fin = 0;
    this.inp = { throttle: 0, steer: 0, jump: false, jumpHeld: false, boost: false, drift: false, pitch: 0, roll: 0 };
    this.ri = 0; this.thinkT = Math.random() * 0.1; this.stuckT = 0; this.fails = 0; this.holdT = 0; this.padT = 0; this.sendT = Math.random() * 0.03;
    this.revT = 0; this.revS = 1; this.forceJump = false; this.idleT = 0; this.anchor = new THREE.Vector3();
    this.hitT = -99; this.lastHitId = -1; this.lastHitT = -99; this.wob = Math.random() * 10; this.side = 0; this.sideT = 0; this.seq = 0;
    if (game.battle) this.car.regen = 16;
    if (game.level.ice) this.car.grip = 0.3;
    this.respawn(game);
  }

  onState() {}

  respawn(game, random) {
    const slot = Math.max(0, game.order.indexOf(this.id));
    const s = game.level.spawn(game.battle ? (random ? Math.random() * 6.28 : 0) : this.cp, slot, game.order.length);
    if (random) s.pos.y += 3;
    this.car.reset(s.pos, s.yaw);
    this.stuckT = 0;
    // חוזרים לנקודה במסלול שהכי קרובה לנקודת הביקורת
    const route = game.level.route;
    let best = 1e18;
    for (let i = 0; i < route.length; i++) { const d = (route[i].x - s.pos.x) ** 2 + (route[i].z - s.pos.z) ** 2 + (route[i].y - s.pos.y) ** 2 * 4; if (d < best) { best = d; this.ri = i; } }
    this.sync();
  }

  setGone(game, v) {
    if (this.gone === v) return;
    this.gone = v;
    this.vis.group.visible = !v;
    if (v) game.world.removeBody(this.body); else game.world.addBody(this.body);
    this.inWorld = !v;
  }

  sync() {
    const b = this.body;
    this.pos.set(b.position.x, b.position.y, b.position.z);
    this.quat.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    this.attach.set(0, 0.3, 0).applyQuaternion(this.quat).add(this.pos);
    this.supported = this.car.supported;
    this.boosting = this.car.boosting;
  }

  // ---------- החלטות נהיגה ----------
  // קרן מהמכונית אל נקודה: מחזירה מה חוסם בדרך (נמוך = אפשר לקפוץ מעליו, גבוה = צריך לעקוף)
  probe(game, tx, tz, dy) {
    const p = this.body.position;
    from.set(p.x, p.y + dy, p.z); to.set(tx, p.y + dy, tz);
    res.reset();
    game.world.raycastClosest(from, to, RAY, res);
    return res.hasHit && res.hitNormalWorld.y < 0.5 ? res : null;
  }

  thinkRace(game) {
    const route = game.level.route, n = route.length, b = this.body, p = b.position, v = b.velocity, inp = this.inp, k = this.k;
    const speed = Math.hypot(v.x, v.z);
    // התקדמות לאורך המסלול
    let best = 1e18, bi = this.ri;
    for (let j = 0; j < 14; j++) {
      const i = game.laps ? (this.ri + j) % n : Math.min(n - 1, this.ri + j), r = route[i];
      const d = (r.x - p.x) ** 2 + (r.z - p.z) ** 2 + (r.y - p.y) ** 2 * 3;
      if (d < best) { best = d; bi = i; }
    }
    this.ri = bi;
    const at = (j) => route[game.laps ? (bi + j) % n : Math.min(n - 1, bi + j)];
    const T = at(1 + Math.ceil((5 + speed * 0.4) / 8));
    let tx = T.x, tz = T.z;
    // מכשולים בדרך אל הנקודה
    const dist = Math.hypot(tx - p.x, tz - p.z) || 1, reach = Math.min(dist, 5 + speed * 0.3);
    const px = p.x + ((tx - p.x) / dist) * reach, pz = p.z + ((tz - p.z) / dist) * reach;
    let wantJump = false, tall = false;
    if (this.car.supported) {
      const low = this.probe(game, px, pz, -0.2);
      if (low) {
        const hb = low.body;
        if (this.probe(game, px, pz, 1.4)) {
          // מכשול גבוה: עוקפים מהצד הרחוק ממרכז המכשול
          tall = true;
          if (this.sideT <= 0 && hb) {
            const cr = (tx - p.x) * (hb.position.z - p.z) - (tz - p.z) * (hb.position.x - p.x);
            this.side = cr > 0 ? -1 : 1; this.sideT = 0.7;
          }
        } else if (low.distance < 2.5 + speed * 0.16) wantJump = true;
      }
    }
    if (this.sideT > 0) { const ox = -(tz - p.z) / dist, oz = (tx - p.x) / dist; tx += ox * 6 * this.side; tz += oz * 6 * this.side; }
    // פערים במסלול: קופצים ממש בקצה, ולפני כן צוברים מהירות
    let gapNear = false;
    for (let j = 0; j < 5; j++) {
      const r = at(j);
      if (!r.gap) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d < 34) gapNear = true;
      if (this.car.supported && d < 1.8 + speed * 0.13 && !at(0).gap) wantJump = true;
      break;
    }
    // מלכודות לפניי: קרן נמוכה – קופצים; לייזר דולק / מכבש למטה / אריח כבוי – מחכים
    let hold = false;
    if (this.lvl >= 2 && game.level.danger) {
      for (const dd of [2.5, 6, 10, 15]) {
        const px2 = p.x + ((tx - p.x) / dist) * dd, pz2 = p.z + ((tz - p.z) / dist) * dd;
        const hz = game.level.danger(px2, pz2, p.y, game.tRace + dd / Math.max(speed, 6));
        if (hz === 'jump' && this.car.supported && dd <= 2.5 + speed * 0.16) wantJump = true;
        if (hz === 'stop' && this.lvl >= 3) { hold = true; break; }
      }
    }
    // היגוי
    _f.set(0, 0, 1).applyQuaternion(_q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
    const diff = wrap(Math.atan2(tx - p.x, tz - p.z) - Math.atan2(_f.x, _f.z));
    this.wob += 0.09;
    inp.steer = clamp(diff * 2.4 + Math.sin(this.wob) * (1 - k) * 0.22, -1, 1);
    // מהירות לפי רמת הקושי, והאטה בפניות
    // מאטים מראש לפני פנייה: מחפשים את הפנייה הבאה במסלול ומחשבים כמה מהר אפשר להגיע אליה
    const maxV = lerp(14, 45, k), turn = Math.min(1, Math.abs(diff) / 0.9);
    let want = Math.max(11, maxV * (1 - 0.6 * turn));
    const a0 = at(0), a1 = at(1), h0 = Math.atan2(a1.x - a0.x, a1.z - a0.z);
    for (let j = 1; j < 10; j++) {
      const c = at(j), d = at(j + 1);
      if (c === d) break;
      if (Math.abs(wrap(Math.atan2(d.x - c.x, d.z - c.z) - h0)) > 0.6) {
        const cv = lerp(12, 26, k), dd = Math.max(0, Math.hypot(c.x - p.x, c.z - p.z) - 6);
        want = Math.min(want, Math.sqrt(cv * cv + 2 * 16 * dd));
        break;
      }
    }
    if (tall) want = Math.min(want, 13);
    if (gapNear) want = 60;
    if (game.mode === 'chain') want = Math.min(want, this.chainPace(game));
    if (hold) want = 0;
    inp.throttle = speed < want ? 1 : speed > want + 4 ? -1 : 0;
    if (Math.abs(diff) > 2.2 && speed < 4) inp.throttle = -1; // פונים לכיוון ההפוך – רוורס
    this.unstick();
    inp.boost = (gapNear && turn < 0.3) || (this.lvl >= 3 && turn < 0.18 && want > 30 && speed < want && this.car.boost > 25);
    this.jumpIf(wantJump, v, T);
  }

  // תקוע מול משהו: נוסעים קצת אחורה עם היגוי, ואז מנסים שוב
  unstick() {
    if (this.stuckT > 1 && this.revT <= 0) { this.revT = 0.9; this.revS = Math.random() > 0.5 ? 1 : -1; this.stuckT = 0.3; this.forceJump = true; }
    if (this.revT > 0) { this.inp.throttle = -1; this.inp.steer = this.revS; this.inp.boost = false; }
  }

  // בשרשרת: לא בורחים מהשותפים
  chainPace(game) {
    let far = 0;
    for (const nid of game.neighborsOf(this.id)) { const o = game.who(nid); if (o && o.has) far = Math.max(far, o.attach.distanceTo(this.attach)); }
    const lead = this.prog > game.progress() + 5;
    return far > 9 && lead ? 0 : far > 6 && lead ? 8 : 26;
  }

  jumpIf(want, v, T) {
    const inp = this.inp;
    inp.jump = false;
    if ((want || this.forceJump) && this.holdT <= 0) { inp.jump = true; this.holdT = 0.3; this.forceJump = false; }
    // קפיצה שנייה באוויר כשנופלים מתחת לגובה המסלול
    else if (!this.car.supported && this.car.airJumps > 0 && v.y < -3 && T && this.body.position.y < T.y + 0.4 && this.holdT <= 0) { inp.jump = true; this.holdT = 0.3; }
    inp.jumpHeld = this.holdT > 0.05;
  }

  thinkBattle(game) {
    const b = this.body, p = b.position, v = b.velocity, inp = this.inp, k = this.k;
    const speed = Math.hypot(v.x, v.z);
    // מטרה: המכונית החיה הקרובה ביותר
    let tx = 0, tz = 0, bd = 1e9;
    const consider = (o) => {
      if (!o || o === this || !o.has || o.gone || o.lives <= 0) return;
      const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
      if (d < bd && o.pos.y > -3) { bd = d; tx = o.pos.x + (o.nv.x || 0) * 0.3 * k; tz = o.pos.z + (o.nv.z || 0) * 0.3 * k; }
    };
    // במיני גיימס יש לבוט מטרה משלו: לרדוף אחרי מישהו, ללכת לכתר, או לברוח
    const goal = game.botGoal(this);
    let flee = false;
    if (goal) {
      bd = Math.hypot(goal.x - p.x, goal.z - p.z);
      flee = !!goal.flee;
      if (flee) { tx = p.x + (p.x - goal.x) * 4; tz = p.z + (p.z - goal.z) * 4; } else { tx = goal.x; tz = goal.z; }
    } else { consider(game.meProxy); for (const r of game.remotes.values()) consider(r); }
    _f.set(0, 0, 1).applyQuaternion(_q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w));
    // שפת הזירה: אם אין רצפה לפניי – חוזרים למרכז
    const ahead = 4 + speed * (0.55 - 0.2 * k);
    from.set(p.x + _f.x * ahead, p.y + 2, p.z + _f.z * ahead); to.set(from.x, p.y - 5, from.z);
    res.reset();
    game.world.raycastClosest(from, to, RAY, res);
    const edge = !res.hasHit;
    if (edge || bd > 1e8) { tx = 0; tz = 0; }
    // מכשולים בזירה בדרך אל המטרה: נמוך – קופצים, גבוה – עוקפים
    let wantJump = false;
    const dist = Math.hypot(tx - p.x, tz - p.z) || 1, reach = Math.min(dist, 5 + speed * 0.3);
    if (this.car.supported && !edge) {
      const px = p.x + ((tx - p.x) / dist) * reach, pz = p.z + ((tz - p.z) / dist) * reach;
      const low = this.probe(game, px, pz, -0.2);
      if (low) {
        if (this.probe(game, px, pz, 1.4)) { if (this.sideT <= 0) { this.side = Math.random() > 0.5 ? 1 : -1; this.sideT = 0.8; } }
        else if (low.distance < 3 + speed * 0.16) wantJump = true;
      }
    }
    if (this.sideT > 0) { const ox = -(tz - p.z) / dist, oz = (tx - p.x) / dist; tx += ox * 7 * this.side; tz += oz * 7 * this.side; }
    const diff = wrap(Math.atan2(tx - p.x, tz - p.z) - Math.atan2(_f.x, _f.z));
    this.wob += 0.09;
    inp.steer = clamp(diff * 2.4 + Math.sin(this.wob) * (1 - k) * 0.3, -1, 1);
    const want = edge ? 7 : lerp(11, 34, k) * (1 - 0.5 * Math.min(1, Math.abs(diff)));
    inp.throttle = edge && speed > 9 ? -1 : speed < want ? 1 : 0;
    if (Math.abs(diff) > 2.2 && speed < 4) inp.throttle = -1;
    inp.boost = !edge && this.lvl >= 3 && bd < 10 + 22 * k && Math.abs(diff) < (flee ? 0.6 : 0.2) && this.car.boost > 15 && game.holder !== this.id;
    this.unstick();
    this.jumpIf(wantJump, v, null);
  }

  // צעד פיזיקה (נקרא לפני world.step)
  step(H, locked, game) {
    if (this.gone) return;
    this.thinkT -= H; this.holdT -= H; this.sideT -= H; this.revT -= H;
    if (this.thinkT <= 0) {
      this.thinkT = lerp(0.14, 0.04, this.k); // בוט קשה מגיב מהר יותר
      if (game.battle) this.thinkBattle(game); else this.thinkRace(game);
    }
    this.car.step(H, this.inp, locked || !!this.fin);
    this.inp.jump = false;
    this.attach.set(0, 0.3, 0).applyQuaternion(_q.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w)).add(this.body.position);
    this.supported = this.car.supported;
    if (game.mode === 'chain') game.applyChain(this.car, this.id);
  }

  // אחרי הפיזיקה: נקודות ביקורת, הקפות, סיום, נפילה ושידור
  post(dt, game, tRace, net) {
    const lv = game.level, b = this.body;
    if (!this.gone) {
      this.sync();
      const p = this.pos;
      this.car.grip = lv.ice || lv.onIce(p) ? 0.3 : 1;
      if (!game.battle) {
        for (let i = Math.min(lv.cps.length - 1, this.cp + 2); i > this.cp; i--) if (lv.inZone(lv.cps[i], p)) { this.cp = i; this.fails = 0; break; }
        if (game.mode === 'chain') this.cp = Math.max(this.cp, game.cp);
        const inFin = tRace > 0 && lv.inZone(lv.finish, p);
        if (game.laps && !this.fin && inFin && this.cp === lv.cps.length - 1) { this.lap++; this.cp = 0; }
        if (!this.fin && (game.laps ? this.lap >= game.laps : inFin)) this.fin = Math.max(1, Math.round(tRace * 1000));
        this.prog = Math.round(game.progress(p, this.cp, this.lap));
        this.padT -= dt;
        if (this.padT <= 0) for (const pd of lv.pads) if (lv.inPad(pd, p)) {
          this.padT = 1; this.car.boost = 100;
          const kick = clamp(46 - (b.velocity.x * pd.f.x + b.velocity.z * pd.f.z), 0, 12);
          b.velocity.x += pd.f.x * kick; b.velocity.z += pd.f.z * kick;
          break;
        }
        if (tRace > 0 && !this.fin && lv.hazards(b, tRace, dt) === 1) { game.burst(this.pos, 30, 12, [0xff2d1a, 0xffd21a], 0.6); game.botFall(this); }
      }
      // תקוע במקום – חוזרים לנקודת הביקורת
      if (tRace > 1 && !this.fin && Math.hypot(b.velocity.x, b.velocity.z) < 1.2 && this.inp.throttle !== 0) this.stuckT += dt; else this.stuckT = 0;
      // לא זז כמה שניות (נתקע, התהפך או נתלה על שפה) – מתחיל מחדש מנקודת הביקורת
      if (p.distanceTo(this.anchor) > 4 || tRace < 1 || this.fin || this.inp.throttle === 0) { this.anchor.copy(p); this.idleT = 0; } else this.idleT += dt;
      if (this.idleT > 4) { this.idleT = 0; if (game.battle) this.respawn(game, true); else game.botFall(this); }
      const kill = game.battle ? lv.killY : Math.max(lv.killY, lv.floorNear(p) - 38);
      if (p.y < kill) game.botFall(this);
    }
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / 30;
      const q = b.quaternion, v = b.velocity, p = b.position, r2 = (x) => Math.round(x * 100) / 100, r3 = (x) => Math.round(x * 1000) / 1000;
      net.sendBotState(this.id, [r2(p.x), r2(p.y), r2(p.z), r3(q.x), r3(q.y), r3(q.z), r3(q.w), r2(v.x), r2(v.y), r2(v.z),
        (this.boosting ? 1 : 0) | (this.supported ? 0 : 2) | (this.gone ? 4 : 0), game.battle ? this.lives : this.cp, game.battle ? this.kos : this.prog, game.battle ? this.out : this.fin, game.gid]);
    }
  }

  // עדכון ויזואלי (נקרא פעם בפריים, כמו אצל שחקן מרוחק)
  update(dt, t) {
    if (this.gone) return;
    this.vis.group.position.copy(this.pos);
    this.vis.group.quaternion.copy(this.quat);
    this.vis.update(this.car.steer, this.car.wheels, this.car.spin, this.boosting, t);
  }

  dispose(game) {
    this.vis.dispose();
    if (this.inWorld) game.world.removeBody(this.body);
  }
}
