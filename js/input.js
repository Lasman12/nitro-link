// קלט: מקלדת (לפי מיקום המקש, כך שעובד גם בפריסה עברית), מגע וגיימפד
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, throttle: 0, boost: false, jump: false };
    this.touchMenu = false;
    this.enabled = true;
    this.state = { throttle: 0, steer: 0, jump: false, jumpHeld: false, boost: false, drift: false, pitch: 0, roll: 0, respawn: false };
    this.padPrev = {};
    this.padBase = {};
    this.menu = false;

    const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.pressed.clear(); });
    this.setupTouch();
  }

  // מגע: ג'ויסטיק אחד (למעלה = גז, למטה = רוורס, צדדים = היגוי), כפתור בוסט מעליו, וכפתור קפיצה בצד השני.
  // לחיצה ארוכה על הקפיצה פותחת את התפריט.
  setupTouch() {
    const stick = document.getElementById('stick');
    if (!stick) return;
    const knob = stick.querySelector('i'), t = this.touch;
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      const dz = (v, d) => (Math.abs(v) < d ? 0 : Math.sign(v) * Math.min(1, (Math.abs(v) - d) / (0.8 - d)));
      t.steer = -dz(dx, 0.16); // שמאלה = חיובי
      t.throttle = -dz(dy, 0.22);
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => { if (e.pointerId === id) { id = null; t.steer = 0; t.throttle = 0; knob.style.transform = ''; } };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    let holdTimer = 0;
    document.querySelectorAll('#touch .tb').forEach((b) => {
      const k = b.dataset.k;
      const set = (v) => (e) => {
        e.preventDefault();
        if (k === 'jump') {
          clearTimeout(holdTimer);
          if (v) {
            this.pressed.add('TouchJump');
            holdTimer = setTimeout(() => { this.touchMenu = true; t.jump = false; b.classList.remove('on'); }, 800);
          }
        }
        t[k] = v;
        b.classList.toggle('on', v);
      };
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); set(true)(e); });
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  hit(code) { return this.pressed.has(code); }

  read() {
    const k = this.keys, s = this.state, t = this.touch;
    const d = (a, b) => (k.has(a) || k.has(b) ? 1 : 0);
    s.throttle = d('KeyW', 'ArrowUp') - (k.has('KeyS') ? 1 : 0); // חץ מטה שמור לשימוש בחפץ
    s.steer = d('KeyA', 'ArrowLeft') - d('KeyD', 'ArrowRight');
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    s.drift = k.has('KeyX') || k.has('KeyC'); // בלי Ctrl – כדי ש-Ctrl+W לא יסגור את הלשונית
    s.pitch = (k.has('KeyI') ? 1 : 0) - (k.has('KeyK') ? 1 : 0);
    s.roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    s.jump = this.pressed.has('Space') || this.pressed.has('TouchJump');
    s.respawn = this.pressed.has('KeyR');
    this.horn = this.pressed.has('Tab');
    this.item = this.pressed.has('ArrowDown') || this.pressed.has('KeyF') || this.pressed.has('TouchItem');
    this.next = this.pressed.has('Space') || this.pressed.has('TouchJump') || this.pressed.has('ArrowRight') || this.pressed.has('KeyD');
    s.jumpHeld = k.has('Space') || t.jump;

    if (t.throttle) s.throttle = t.throttle;
    if (t.steer) s.steer = t.steer;
    if (t.boost) s.boost = true;

    // שלט: מקל שמאלי / חיצים – היגוי · RT – גז · LT – ברקס/רוורס · A – קפיצה · B או RB – ניטרו
    //       X – דריפט · Y – חזרה לנקודת ביקורת · Start – תפריט
    this.menu = this.touchMenu; this.touchMenu = false;
    const edge = (name, on) => { const hit = on && !this.padPrev[name]; this.padPrev[name] = on; return hit; };
    // ממזגים את כל השלטים המחוברים (למשל שני Joy-Con נפרדים של נינטנדו)
    let px = 0, rt = 0, lt = 0, jump = false, resp = false, menu = false, any = false, itemBtn = false, hornBtn = false;
    for (const gp of this.pads()) {
      any = true;
      const std = gp.mapping === 'standard';
      const b = (i) => !!gp.buttons[i]?.pressed, v = (i) => gp.buttons[i]?.value || 0;
      const base = (this.padBase[gp.index] ||= Array.from(gp.axes));
      // מקל: ציר 0 תמיד; בשלטים לא סטנדרטיים (חלק משלטי נינטנדו) בודקים גם צירים אחרים שנחים באמצע
      const cand = std ? [0, 2] : [0, 2, 4];
      for (const i of cand) {
        if (i >= gp.axes.length || Math.abs(base[i] || 0) > 0.5) continue;
        const a = gp.axes[i] || 0;
        if (Math.abs(a) > Math.abs(px) && Math.abs(a) > 0.18) px = a;
      }
      // חיצים: ככפתורים (סטנדרטי) או כ"כובע" על ציר אחד (נינטנדו / שלטים ישנים)
      if (b(14)) px = -1; else if (b(15)) px = 1;
      if (!std) {
        for (const i of [9, gp.axes.length - 1]) {
          const h = gp.axes[i];
          if (h === undefined || i < 4) continue;
          const k = Math.round((h + 1) * 3.5);
          if (Math.abs(h - (k / 3.5 - 1)) < 0.06 && k >= 0 && k <= 7 && Math.abs(h) > 0.1) { if (k >= 1 && k <= 3) px = 1; else if (k >= 5) px = -1; }
        }
      }
      rt = Math.max(rt, v(7)); lt = Math.max(lt, v(6));
      if (b(1) || b(5)) s.boost = true;
      if (b(2)) s.drift = true;
      jump ||= b(0); resp ||= b(3); menu ||= b(9); itemBtn ||= b(4); hornBtn ||= b(10) || b(11);
    }
    if (any) {
      if (Math.abs(px) > 0.18) s.steer = -Math.sign(px) * Math.min(1, (Math.abs(px) - 0.18) / 0.7);
      if (rt > 0.08 || lt > 0.08) s.throttle = rt - lt;
      if (jump) s.jumpHeld = true;
      if (edge('jump', jump)) { s.jump = true; this.next = true; }
      if (edge('respawn', resp)) s.respawn = true;
      if (edge('menu', menu)) this.menu = true;
      if (edge('item', itemBtn)) this.item = true;
      if (edge('horn', hornBtn)) this.horn = true;
    }
    if (!this.enabled) { s.throttle = 0; s.steer = 0; s.jump = false; s.jumpHeld = false; s.boost = false; s.drift = false; s.pitch = 0; s.roll = 0; s.respawn = false; }
    return s;
  }

  pads() {
    const out = [];
    if (!navigator.getGamepads) return out;
    for (const g of navigator.getGamepads()) if (g && g.connected && g.buttons.length >= 2) out.push(g);
    return out;
  }

  endFrame() { this.pressed.clear(); }
}
