// רשת. שני מסלולי חיבור:
// 1. ישיר בין הדפדפנים (WebRTC דרך PeerJS) – מהיר, אבל נכשל כששני הנתבים לא מאפשרים חיבור ישיר.
// 2. ממסר דרך Firebase Realtime Database – גיבוי אוטומטי כשהחיבור הישיר נכשל (עובד בכל רשת).
// המארח יוצר חדר עם קוד, שאר השחקנים מתחברים אליו והוא מעביר הודעות בין כולם.
import { FIREBASE } from './config.js?v=1795468522';

const PREFIX = 'nitrolink1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const DB = (FIREBASE.databaseURL || '').replace(/\/+$/, '');
const RELAY_OK = !!DB;
// שרתי ה-TURN שמגיעים כברירת מחדל עם PeerJS כבר לא פעילים, לכן רק STUN (והממסר כגיבוי)
const PEER_OPTS = { debug: 1, config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] } };
const randomCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
// רשימת החדרים הציבוריים ("חפש קבוצה"). נשמרת תחת קוד שמור שלא יכול לצאת כקוד חדר אמיתי (יש בו 0 ו-O)
const DIR = `${DB}/rooms/P0OL`;
const jfetch = (method, url, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then((r) => { if (!r.ok) throw new Error('dir ' + r.status); return r.json(); });
const typed = (type) => Object.assign(new Error(type), { type });
// ?relay=1 בכתובת מדלג על החיבור הישיר ומתחבר ישר דרך הממסר (לבדיקות ולמקרים בעייתיים)
const FORCE_RELAY = RELAY_OK && new URLSearchParams(location.search).has('relay');
// Firebase משמיט שדות ריקים – מחזירים אותם כדי שהקוד לא ייפול על skin חסר
const norm = (players) => (Array.isArray(players) ? players : Object.values(players || {})).map((p) => ({ ...p, skin: p.skin || {}, uid: p.uid || null }));

// חדר ממסר: /rooms/<code>/m = תור הודעות, /rooms/<code>/s/<id> = המצב האחרון של כל שחקן
class Relay {
  constructor(code, onEvent) {
    this.url = `${DB}/rooms/${code}`;
    this.onEvent = onEvent;
    this.es = null; this.busy = {}; this.pending = {};
  }

  // פותח זרם אירועים; מחזיר את תוכן החדר ברגע הפתיחה
  open() {
    return new Promise((resolve, reject) => {
      const es = (this.es = new EventSource(this.url + '.json'));
      let first = true;
      const t = setTimeout(() => { if (first) { es.close(); reject(typed('relay-timeout')); } }, 9000);
      es.addEventListener('put', (e) => {
        let j;
        try { j = JSON.parse(e.data); } catch { return; }
        if (first) { first = false; clearTimeout(t); resolve(j.data); return; }
        this.onEvent(j.path, j.data);
      });
      es.addEventListener('cancel', () => this.onEvent('/', null));
      es.onerror = () => { if (first) { first = false; clearTimeout(t); es.close(); reject(typed('relay-denied')); } };
    });
  }

  async req(method, path, body) {
    const r = await fetch(`${this.url}${path}.json`, { method, body: body === undefined ? undefined : JSON.stringify(body), keepalive: method === 'DELETE' });
    if (!r.ok) throw typed('relay-denied');
    return r;
  }

  post(obj) { this.req('POST', '/m', obj).catch(() => {}); }

  // מצב שחקן: נשלח רק האחרון. אם הבקשה הקודמת עוד בדרך, מחכים לה (כך הקצב מתאים את עצמו לרשת)
  state(id, obj) {
    if (this.dead) return;
    if (this.busy[id]) { this.pending[id] = obj; return; }
    this.busy[id] = true;
    this.req('PUT', '/s/' + id, obj).catch(() => {}).finally(() => {
      this.busy[id] = false;
      const p = this.pending[id];
      if (p) { delete this.pending[id]; this.state(id, p); }
    });
  }

  close() { if (this.es) this.es.close(); this.es = null; }
}

export class Net {
  constructor() {
    this.handlers = {};
    this.getInfo = () => ({});
    this.clear();
    addEventListener('pagehide', () => { if (this.isHost && this.relay) this.relay.req('DELETE', '').catch(() => {}); this.unpublish(); });
  }

  clear() {
    clearInterval(this.timer);
    this.unpublish();
    this.isPublic = false;
    if (this.peer) { try { this.peer.destroy(); } catch { /* ignore */ } }
    if (this.relay) {
      this.relay.dead = true;
      if (this.isHost) this.relay.req('DELETE', '').catch(() => {});
      else if (this.myId) this.relay.req('DELETE', '/s/' + this.myId).catch(() => {});
      this.relay.close();
    }
    this.peer = null; this.conns = new Map(); this.hostConn = null;
    this.relay = null; this.rconns = new Map(); this.relayKey = ''; this.viaRelay = false; this.relayState = 'off';
    this.onWelcome = null; this.onFull = null;
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

  // ----- פתיחת חדר -----
  async host(me) {
    this.clear();
    this.isHost = true; this.offline = false;
    this.players = [{ id: 0, ...me }];
    let err = null;
    try { await this.hostP2P(); } catch (e) { err = e; }
    if (err) {
      if (!RELAY_OK) { this.clear(); throw err; }
      this.code = randomCode(); // אין שרת איתות – החדר יעבוד דרך הממסר בלבד
    }
    this.timer = setInterval(() => this.hostWatch(), 2000);
    await this.startRelay();
    if (err && this.relayState !== 'on') { this.clear(); throw err; }
    return this.code;
  }

  hostP2P() {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(typed('nolib'));
      const attempt = (n) => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code, PEER_OPTS);
        let opened = false;
        const to = setTimeout(() => { if (!opened) { peer.destroy(); reject(typed('timeout')); } }, 12000);
        peer.on('open', () => {
          opened = true; clearTimeout(to);
          this.peer = peer; this.code = code;
          peer.on('connection', (conn) => this.accept(conn));
          peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
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

  async startRelay() {
    if (!RELAY_OK) return;
    const r = new Relay(this.code, (p, d) => this.relayHostEvent(p, d));
    try {
      await r.req('PUT', '', { meta: { t: Date.now() } }); // מנקה שאריות של חדר ישן עם אותו קוד
      await r.open();
      this.relay = r; this.relayState = 'on';
    } catch (e) {
      r.close();
      this.relayState = e.type === 'relay-denied' ? 'denied' : 'off';
    }
  }

  // ----- הצטרפות -----
  async join(code, me) {
    this.clear();
    this.offline = false; this.code = code;
    let err;
    if (FORCE_RELAY) err = typed('forced');
    else try { return await this.joinP2P(code, me, RELAY_OK ? 8000 : 20000); } catch (e) { err = e; }
    if ((err.type || err.message) === 'full' || !RELAY_OK) throw err;
    // החיבור הישיר נכשל – מנסים דרך הממסר
    this.clear();
    this.offline = false; this.code = code;
    try {
      const w = await this.joinRelay(code, me);
      this.viaRelay = true;
      return w;
    } catch (e2) {
      this.clear();
      throw e2;
    }
  }

  joinP2P(code, me, timeout) {
    return new Promise((resolve, reject) => {
      if (typeof Peer === 'undefined') return reject(typed('nolib'));
      const peer = (this.peer = new Peer(PEER_OPTS));
      let done = false;
      const fail = (e) => { if (!done) { done = true; clearTimeout(to); this.clear(); reject(e); } };
      const to = setTimeout(() => fail(typed('timeout')), timeout);
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
          } else if (m.t === 'full') fail(typed('full'));
          else if (done) this.clientRecv(m);
        });
        conn.on('close', () => { if (done) this.emit('closed'); else fail(typed('closed')); });
        conn.on('error', (e) => fail(e));
      });
    });
  }

  async joinRelay(code, me) {
    const key = 'k' + Math.random().toString(36).slice(2, 10);
    const r = new Relay(code, (p, d) => this.relayClientEvent(p, d, key));
    const snap = await r.open();
    if (!snap || !snap.meta) { r.close(); throw typed('peer-unavailable'); }
    this.relay = r; this.relayKey = key;
    this.hostConn = { relay: true, open: true, send: (m) => r.post({ to: 'h', from: key, m }) };
    const w = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(typed('timeout')), 12000);
      this.onWelcome = (m) => { clearTimeout(to); resolve(m); };
      this.onFull = () => { clearTimeout(to); reject(typed('full')); };
      this.hostConn.send({ t: 'hello', name: me.name, skin: me.skin, uid: me.uid || null });
    });
    this.onWelcome = this.onFull = null;
    w.players = norm(w.players);
    this.myId = w.id; this.players = w.players;
    this.lastHeard = performance.now();
    this.timer = setInterval(() => this.clientTick(), 400);
    this.clientTick();
    return w;
  }

  relayClientEvent(path, data, key) {
    if (path === '/' && data == null) {
      // המארח סגר את החדר. מפסיקים לשלוח, ומנקים עדכון שאולי עוד היה בדרך ונכתב אחרי המחיקה
      const r = this.relay, id = this.myId;
      if (r) { r.dead = true; if (id) setTimeout(() => r.req('DELETE', '/s/' + id).catch(() => {}), 1500); }
      if (id) this.emit('closed');
      return;
    }
    if (data == null) return;
    if (path.startsWith('/m/')) {
      if (data.to !== key || !data.m) return;
      this.relay.req('DELETE', path).catch(() => {});
      this.lastHeard = performance.now();
      const m = data.m;
      if (m.t === 'welcome') { if (this.onWelcome) this.onWelcome(m); } else if (m.t === 'full') { if (this.onFull) this.onFull(); } else if (this.myId) this.clientRecv(m);
    } else if (path.startsWith('/s/')) {
      const id = Number(path.slice(3));
      if (!this.myId || id === this.myId || !data.d) return;
      this.lastHeard = performance.now();
      this.clientRecv({ t: 's1', id, n: data.n, d: data.d });
    }
  }

  // ----- מארח -----
  accept(conn) {
    conn.on('data', (m) => this.hostRecv(conn, m));
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  relayHostEvent(path, data) {
    if (data == null || !this.relay) return;
    if (path.startsWith('/m/')) {
      if (data.to !== 'h' || !data.m || !data.from) return;
      this.relay.req('DELETE', path).catch(() => {});
      let conn = this.rconns.get(data.from);
      if (!conn) {
        if (data.m.t !== 'hello') return;
        const key = String(data.from).slice(0, 20);
        conn = { relay: true, open: true, key, send: (m) => { if (this.relay) this.relay.post({ to: key, m }); }, close: () => { conn.open = false; this.rconns.delete(key); } };
        this.rconns.set(key, conn);
      }
      this.hostRecv(conn, data.m);
    } else if (path.startsWith('/s/')) {
      const conn = this.conns.get(Number(path.slice(3)));
      if (conn && conn.relay && data.d) this.hostRecv(conn, { t: 's', n: data.n, d: data.d });
    }
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
      this.broadcast({ t: 's1', id, n: m.n, d: m.d }, id, conn.relay);
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
    if (conn.relay && this.relay) this.relay.req('DELETE', '/s/' + id).catch(() => {});
    this.players = this.players.filter((p) => p.id !== id);
    this.syncLobby();
  }

  hostWatch() {
    const now = performance.now();
    for (const conn of [...this.conns.values()]) if (now - (conn._seen || now) > 14000) this.drop(conn);
  }

  // fromRelay = ההודעה היא מצב של שחקן ממסר, שכבר כתוב ב-/s ולכן לא נכתב שוב
  broadcast(m, except, fromRelay) {
    let put = false;
    for (const [id, conn] of this.conns) {
      if (id === except || !conn.open) continue;
      if (conn.relay && m.t === 's1') {
        if (!fromRelay && !put && this.relay) { put = true; this.relay.state(m.id, { n: m.n, d: m.d }); }
        continue;
      }
      try { conn.send(m); } catch { /* ignore */ }
    }
  }

  syncLobby() {
    if (!this.isHost) return;
    const m = { t: 'pl', players: this.players, ...this.getInfo() };
    this.broadcast(m);
    this.emit('players', m);
  }

  hostCmd(m) { if (this.isHost) this.broadcast(m); }

  // ----- חדרים ציבוריים וחיפוש קבוצה -----
  get canMatch() { return RELAY_OK; }
  setPublic(on, inGame) {
    const was = this.isPublic;
    this.isPublic = !!on && this.isHost && !this.offline && RELAY_OK;
    if (this.isPublic) this.publish(inGame); else if (was) { this.isPublic = true; this.unpublish(); this.isPublic = false; }
  }
  // המארח מעדכן את הרשומה שלו כל כמה שניות; רשומה שלא עודכנה נחשבת חדר שנסגר
  publish(inGame) {
    if (!this.isPublic || !this.isHost || !this.code) return;
    jfetch('PUT', `${DIR}/l/${this.code}.json`, { t: { '.sv': 'timestamp' }, n: this.players.length, g: inGame ? 1 : 0, h: String(this.players[0]?.name || '').slice(0, 14) }).catch(() => {});
  }
  unpublish() { if (this.isPublic && this.isHost && this.code && RELAY_OK) fetch(`${DIR}/l/${this.code}.json`, { method: 'DELETE', keepalive: true }).catch(() => {}); }
  static async findPublic(exclude) {
    if (!RELAY_OK) return [];
    // שעון השרת, כדי שלא נהיה תלויים בשעון של כל מחשב
    const probe = `${DIR}/now/${Math.random().toString(36).slice(2, 10)}.json`;
    const now = Number(await jfetch('PUT', probe, { '.sv': 'timestamp' })) || Date.now();
    fetch(probe, { method: 'DELETE' }).catch(() => {});
    const list = (await jfetch('GET', `${DIR}/l.json`)) || {};
    return Object.entries(list)
      .filter(([c, e]) => e && /^[A-Z2-9]{4}$/.test(c) && c !== exclude && now - Number(e.t) < 50000 && !e.g && Number(e.n) < MAX_PLAYERS)
      .sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))
      .map(([c, e]) => ({ code: c, n: Number(e.n) || 1, h: String(e.h || '').slice(0, 14) }));
  }

  // ----- בוטים: שחקנים שהמארח מריץ בעצמו -----
  get bots() { return this.players.filter((p) => p.bot); }
  addBot(name, skin, lvl = 4) {
    if (!this.isHost || this.bots.length >= 3 || this.players.length >= MAX_PLAYERS) return;
    this.players.push({ id: this.nextId++, name, skin, uid: null, bot: true, lvl });
    this.syncLobby();
  }
  setBot(id, lvl) { const p = this.players.find((x) => x.id === id && x.bot); if (p && this.isHost) { p.lvl = lvl; this.syncLobby(); } }
  removeBot(id) { if (!this.isHost) return; this.players = this.players.filter((p) => !(p.bot && p.id === id)); this.syncLobby(); }
  sendBotState(id, d) {
    if (this.offline || !this.isHost) return;
    this.broadcast({ t: 's1', id, n: ++this.seq, d });
  }

  // ----- לקוח -----
  clientTick() {
    const now = performance.now();
    if (now - this.lastHeard > (this.viaRelay || this.relay ? 16000 : 10000)) { this.emit('closed'); return; }
    this.pings++;
    if (this.pings < 8 ? (!this.relay || this.pings % 2 === 1) : this.pings % (this.relay ? 8 : 5) === 0) this.toHost({ t: 'pi', c: now });
  }

  clientRecv(m) {
    if (m.t === 'po') {
      const now = performance.now(), rtt = now - m.c;
      if (rtt < this.bestRtt + 15) { this.bestRtt = Math.min(rtt, this.bestRtt); this.offset = m.h + rtt / 2 - now; }
    } else if (m.t === 's1') {
      if (m.n <= (this.lastSeq[m.id] || 0)) return;
      this.lastSeq[m.id] = m.n;
      this.emit('state', m.id, m.d);
    } else if (m.t === 'pl') { m.players = norm(m.players); this.players = m.players; this.emit('players', m); }
    else this.emit(m.t, m);
  }

  toHost(m) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(m); } catch { /* ignore */ } } }

  // ----- משותף -----
  sendState(d) {
    if (this.offline) return;
    const n = ++this.seq;
    if (this.isHost) this.broadcast({ t: 's1', id: 0, n, d });
    else if (this.relay) { if (this.myId) this.relay.state(this.myId, { n, d }); } else this.toHost({ t: 's', n, d });
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
