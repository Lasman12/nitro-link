// קלט: מקלדת (לפי מיקום המקש, כך שעובד גם בפריסה עברית), מגע וגיימפד
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, gas: false, brake: false, boost: false, jump: false };
    this.enabled = true;
    this.state = { throttle: 0, steer: 0, jump: false, jumpHeld: false, boost: false, drift: false, pitch: 0, roll: 0, respawn: false };
    this.padPrev = {};
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
    s.jumpHeld = k.has('Space') || t.jump;

    if (t.gas) s.throttle = 1;
    if (t.brake) s.throttle = -1;
    if (t.steer) s.steer = t.steer;
    if (t.boost) s.boost = true;

    // שלט: מקל שמאלי / חיצים – היגוי · RT – גז · LT – ברקס/רוורס · A – קפיצה · B או RB – ניטרו
    //       X – דריפט · Y – חזרה לנקודת ביקורת · Start – תפריט
    const gp = this.pad();
    this.menu = false;
    if (gp) {
      const b = (i) => !!gp.buttons[i]?.pressed, v = (i) => gp.buttons[i]?.value || 0;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.18) s.steer = -Math.sign(ax) * Math.min(1, (Math.abs(ax) - 0.18) / 0.7);
      if (b(14)) s.steer = 1; else if (b(15)) s.steer = -1;
      const rt = v(7), lt = v(6);
      if (rt > 0.08 || lt > 0.08) s.throttle = rt - lt;
      if (b(1) || b(5)) s.boost = true;
      if (b(2)) s.drift = true;
      const edge = (name, on) => { const hit = on && !this.padPrev[name]; this.padPrev[name] = on; return hit; };
      if (b(0)) s.jumpHeld = true;
      if (edge('jump', b(0))) s.jump = true;
      if (edge('respawn', b(3))) s.respawn = true;
      if (edge('menu', b(9))) this.menu = true;
    }
    if (!this.enabled) { s.throttle = 0; s.steer = 0; s.jump = false; s.jumpHeld = false; s.boost = false; s.drift = false; s.pitch = 0; s.roll = 0; s.respawn = false; }
    return s;
  }

  // השלט הראשון שמחובר (לא תמיד במקום 0)
  pad() {
    if (!navigator.getGamepads) return null;
    for (const g of navigator.getGamepads()) if (g && g.connected && g.buttons.length >= 10) return g;
    return null;
  }

  endFrame() { this.pressed.clear(); }
}
