// רשת: חיבור ישיר בין דפדפנים (WebRTC דרך PeerJS) – עובד מאתר סטטי כמו GitHub Pages.
// המארח יוצר חדר עם קוד, שאר השחקנים מתחברים אליו והוא מעביר הודעות בין כולם.
const PREFIX = 'nitrolink1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const randomCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

export class Net {
  constructor() {
    this.handlers = {};
    this.getInfo = () => ({});
    this.clear();
  }

  clear() {
    clearInterval(this.timer);
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    this.peer = null; this.conns = new Map(); this.hostConn = null;
    this.isHost = false; this.offline = true; this.myId = 0; this.nextId = 1;
    this.players = []; this.offset = 0; this.bestRtt = 1e9; this.code = '';
    this.seq = 0; this.lastSeq = {}; this.lastHeard = performance.now(); this.pings = 0;
  }

  on(t, fn) { this.handlers[t] = fn; }
  emit(t, ...a) { if (this.handlers[t]) this.handlers[t](...a); }
  now() { return performance.now() + this.offset; }

  solo(me) {
    this.clear();
    this.isHost = true;
    this.players = [{ id: 0, ...me }];
  }

  host(me) {
    return new Promise((resolve, reject) => {
      this.clear();
      this.isHost = true; this.offline = false;
      this.players = [{ id: 0, ...me }];
      if (typeof Peer === 'undefined') return reject(new Error('nolib'));
      const attempt = (n) => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code, { debug: 1 });
        let opened = false;
        const to = setTimeout(() => { if (!opened) { peer.destroy(); reject(new Error('timeout')); } }, 15000);
        peer.on('open', () => {
          opened = true; clearTimeout(to);
          this.peer = peer; this.code = code;
          peer.on('connection', (conn) => this.accept(conn));
          peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
          this.timer = setInterval(() => this.hostWatch(), 2000);
          resolve(code);
        });
        peer.on('error', (e) => {
          if (opened) return;
          clearTimeout(to); peer.destroy();
          if (e.type === 'unavailable-id' && n < 5) attempt(n + 1); else reject(e);
        });
      };
      attempt(0);
    });
  }

  join(code, me) {
    return new Promise((resolve, reject) => {
      this.clear();
      this.offline = false; this.code = code;
      if (typeof Peer === 'undefined') return reject(new Error('nolib'));
      const peer = (this.peer = new Peer({ debug: 1 }));
      let done = false;
      const fail = (e) => { if (!done) { done = true; clearTimeout(to); this.clear(); reject(e); } };
      const to = setTimeout(() => fail(new Error('timeout')), 20000);
      peer.on('error', (e) => fail(e));
      peer.on('disconnected', () => { try { if (done) peer.reconnect(); } catch { /* ignore */ } });
      peer.on('open', () => {
        const conn = (this.hostConn = peer.connect(PREFIX + code, { serialization: 'json' }));
        conn.on('open', () => conn.send({ t: 'hello', name: me.name, skin: me.skin, uid: me.uid || null }));
        conn.on('data', (m) => {
          this.lastHeard = performance.now();
          if (m.t === 'welcome') {
            if (done) return;
            done = true; clearTimeout(to);
            this.myId = m.id; this.players = m.players;
            this.timer = setInterval(() => this.clientTick(), 400);
            this.clientTick();
            resolve(m);
          } else if (m.t === 'full') fail(new Error('full'));
          else if (done) this.clientRecv(m);
        });
        conn.on('close', () => { if (done) this.emit('closed'); else fail(new Error('closed')); });
        conn.on('error', (e) => fail(e));
      });
    });
  }

  // ----- מארח -----
  accept(conn) {
    conn.on('data', (m) => this.hostRecv(conn, m));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  hostRecv(conn, m) {
    conn._seen = performance.now();
    if (m.t === 'hello') {
      if (conn._pid) return;
      if (this.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); return; }
      const id = (conn._pid = this.nextId++);
      this.conns.set(id, conn);
      this.players.push({ id, name: String(m.name || 'שחקן').slice(0, 14), skin: m.skin || {}, uid: m.uid ? String(m.uid).slice(0, 80) : null });
      conn.send({ t: 'welcome', id, players: this.players, ...this.getInfo() });
      this.syncLobby();
      return;
    }
    const id = conn._pid;
    if (!id) return;
    if (m.t === 'pi') conn.send({ t: 'po', c: m.c, h: performance.now() });
    else if (m.t === 's') {
      this.broadcast({ t: 's1', id, n: m.n, d: m.d }, id);
      this.emit('state', id, m.d);
    } else if (m.t === 'me') {
      const p = this.players.find((x) => x.id === id);
      if (p) { p.name = String(m.name || p.name).slice(0, 14); p.skin = m.skin || p.skin; p.uid = m.uid ? String(m.uid).slice(0, 80) : null; this.syncLobby(); }
    } else if (m.t === 'ev') {
      m.from = id;
      this.broadcast(m, id);
      this.emit('ev', m);
    }
  }

  drop(conn) {
    const id = conn._pid;
    if (!id || !this.conns.has(id)) return;
    this.conns.delete(id);
    try { conn.close(); } catch { /* ignore */ }
    this.players = this.players.filter((p) => p.id !== id);
    this.syncLobby();
  }

  hostWatch() {
    const now = performance.now();
    for (const conn of [...this.conns.values()]) if (now - (conn._seen || now) > 12000) this.drop(conn);
  }

  broadcast(m, except) {
    for (const [id, conn] of this.conns) if (id !== except && conn.open) { try { conn.send(m); } catch { /* ignore */ } }
  }

  syncLobby() {
    if (!this.isHost) return;
    const m = { t: 'pl', players: this.players, ...this.getInfo() };
    this.broadcast(m);
    this.emit('players', m);
  }

  hostCmd(m) { if (this.isHost) this.broadcast(m); }

  // ----- לקוח -----
  clientTick() {
    const now = performance.now();
    if (now - this.lastHeard > 10000) { this.emit('closed'); return; }
    this.pings++;
    if (this.pings < 8 || this.pings % 5 === 0) this.toHost({ t: 'pi', c: now });
  }

  clientRecv(m) {
    if (m.t === 'po') {
      const now = performance.now(), rtt = now - m.c;
      if (rtt < this.bestRtt + 15) { this.bestRtt = Math.min(rtt, this.bestRtt); this.offset = m.h + rtt / 2 - now; }
    } else if (m.t === 's1') {
      if (m.n <= (this.lastSeq[m.id] || 0)) return;
      this.lastSeq[m.id] = m.n;
      this.emit('state', m.id, m.d);
    } else if (m.t === 'pl') { this.players = m.players; this.emit('players', m); }
    else this.emit(m.t, m);
  }

  toHost(m) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(m); } catch { /* ignore */ } } }

  // ----- משותף -----
  sendState(d) {
    if (this.offline) return;
    const n = ++this.seq;
    if (this.isHost) this.broadcast({ t: 's1', id: 0, n, d }); else this.toHost({ t: 's', n, d });
  }

  sendEvent(m) {
    if (this.offline) return;
    m.t = 'ev'; m.from = this.myId;
    if (this.isHost) this.broadcast(m); else this.toHost(m);
  }

  updateMe(me) {
    if (this.isHost) {
      const p = this.players.find((x) => x.id === 0);
      if (p) { p.name = me.name; p.skin = me.skin; p.uid = me.uid || null; }
      this.syncLobby();
    } else this.toHost({ t: 'me', name: me.name, skin: me.skin, uid: me.uid || null });
  }

  leave() { this.clear(); }
}
