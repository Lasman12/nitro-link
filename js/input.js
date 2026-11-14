// קלט: מקלדת (לפי מיקום המקש, כך שעובד גם בפריסה עברית), מגע וגיימפד
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, gas: false, brake: false, boost: false, jump: false };
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

  setupTouch() {
    const stick = document.getElementById('stick');
    if (!stick) return;
    const knob = stick.querySelector('i');
    let id = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      dx = Math.max(-1, Math.min(1, dx));
      this.touch.steer = -dx; // שמאלה = חיובי
      knob.style.transform = `translateX(${dx * 44}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); move(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const end = (e) => { if (e.pointerId === id) { id = null; this.touch.steer = 0; knob.style.transform = ''; } };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    document.querySelectorAll('#tBtns .tb').forEach((b) => {
      const k = b.dataset.k;
      const set = (v) => (e) => {
        e.preventDefault();
        if (k === 'jump' && v) this.pressed.add('TouchJump');
        this.touch[k] = v;
        b.classList.toggle('on', v);
      };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('pointerleave', set(false));
    });
  }

  hit(code) { return this.pressed.has(code); }

  read() {
    const k = this.keys, s = this.state, t = this.touch;
    const d = (a, b) => (k.has(a) || k.has(b) ? 1 : 0);
    s.throttle = d('KeyW', 'ArrowUp') - d('KeyS', 'ArrowDown');
    s.steer = d('KeyA', 'ArrowLeft') - d('KeyD', 'ArrowRight');
    s.boost = k.has('ShiftLeft') || k.has('ShiftRight');
    s.drift = k.has('KeyX') || k.has('KeyC'); // בלי Ctrl – כדי ש-Ctrl+W לא יסגור את הלשונית
    s.pitch = (k.has('KeyI') ? 1 : 0) - (k.has('KeyK') ? 1 : 0);
    s.roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    s.jump = this.pressed.has('Space') || this.pressed.has('TouchJump');
    s.respawn = this.pressed.has('KeyR');
    this.next = this.pressed.has('Space') || this.pressed.has('TouchJump') || this.pressed.has('ArrowRight') || this.pressed.has('KeyD');
    s.jumpHeld = k.has('Space') || t.jump;

    if (t.gas) s.throttle = 1;
    if (t.brake) s.throttle = -1;
    if (t.steer) s.steer = t.steer;
    if (t.boost) s.boost = true;

    // שלט: מקל שמאלי / חיצים – היגוי · RT – גז · LT – ברקס/רוורס · A – קפיצה · B או RB – ניטרו
    //       X – דריפט · Y – חזרה לנקודת ביקורת · Start – תפריט
    this.menu = false;
    const edge = (name, on) => { const hit = on && !this.padPrev[name]; this.padPrev[name] = on; return hit; };
    // ממזגים את כל השלטים המחוברים (למשל שני Joy-Con נפרדים של נינטנדו)
    let px = 0, rt = 0, lt = 0, jump = false, resp = false, menu = false, any = false;
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
      jump ||= b(0); resp ||= b(3); menu ||= b(9);
    }
    if (any) {
      if (Math.abs(px) > 0.18) s.steer = -Math.sign(px) * Math.min(1, (Math.abs(px) - 0.18) / 0.7);
      if (rt > 0.08 || lt > 0.08) s.throttle = rt - lt;
      if (jump) s.jumpHeld = true;
      if (edge('jump', jump)) { s.jump = true; this.next = true; }
      if (edge('respawn', resp)) s.respawn = true;
      if (edge('menu', menu)) this.menu = true;
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
