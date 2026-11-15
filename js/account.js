// חשבונות (שם משתמש + סיסמה), התקדמות, שיאים אישיים, XP וטבלת שיאים.
// שני מצבים: מקומי (localStorage, ברירת מחדל) או מקוון דרך Firebase (כשממלאים את js/config.js).
import { FIREBASE } from './config.js';

const ONLINE = !!(FIREBASE.apiKey && FIREBASE.databaseURL);
const DB = (FIREBASE.databaseURL || '').replace(/\/+$/, '');
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const ls = {
  get(k, d) { try { const v = localStorage.getItem('nl_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nl_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem('nl_' + k); } catch { /* ignore */ } },
};
const emptyProfile = (name = '') => ({ name, xp: 0, race: 0, chain: 0, bestRace: {}, bestChain: {}, tr: 0, coins: 0, road: 0, own: {} });
// Firebase מחזיר מפתחות מספריים כמערך (עם null בחורים) – מנרמלים חזרה לאובייקט {שלב: זמן}
const times = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v > 0));
const fix = (p, name) => ({ ...emptyProfile(name), ...(p || {}), bestRace: times(p?.bestRace), bestChain: times(p?.bestChain), own: { ...(p?.own || {}) } });
const keyOf = (name) => name.trim().toLowerCase();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const safeKey = (s) => String(s).replace(/[.#$\[\]\/]/g, '_');

// דרגת XP: כמה נקודות צריך לכל רמה, ותואר
const TITLES = ['טירון', 'נהג', 'מרוצן', 'מקצוען', 'אלוף', 'אגדה'];
export function rankOf(xp) {
  const lvl = Math.floor(Math.sqrt(Math.max(0, xp) / 120)) + 1;
  const cur = 120 * (lvl - 1) ** 2, next = 120 * lvl ** 2;
  return { lvl, frac: (xp - cur) / (next - cur), cur, next, title: TITLES[Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 3))] };
}

export class AuthError extends Error {}

export class Account {
  constructor() {
    this.online = ONLINE;
    this.user = null;            // {name, uid}
    this.profile = fix(ls.get('guest', null), ''); // אורח: נשמר בדפדפן הזה
    this.tok = null;             // Firebase: {idToken, refreshToken, exp}
    this.onChange = () => {};
  }

  get loggedIn() { return !!this.user; }
  get uid() { return this.user ? this.user.uid : null; }

  validate(name, pass) {
    name = String(name || '').trim();
    if (name.length < 2 || name.length > 14) throw new AuthError('שם המשתמש צריך להיות באורך 2 עד 14 תווים');
    if (/[.#$\[\]\/<>&"']/.test(name)) throw new AuthError('שם המשתמש מכיל תווים אסורים');
    if (String(pass || '').length < 6) throw new AuthError('הסיסמה צריכה להיות באורך 6 תווים לפחות');
    return name;
  }

  async restore() {
    const s = ls.get('session', null);
    if (!s) return;
    try {
      if (ONLINE) {
        if (!s.refreshToken) return;
        this.tok = { idToken: '', refreshToken: s.refreshToken, exp: 0 };
        this.user = { name: s.name, uid: s.uid };
        const p = await this.db('GET', `users/${s.uid}`);
        this.profile = fix(p, s.name);
      } else {
        const u = ls.get('users', {})[keyOf(s.name)];
        if (!u) return;
        this.user = { name: u.name, uid: 'L:' + keyOf(u.name) };
        this.profile = fix(u.profile, u.name);
      }
    } catch { this.user = null; this.tok = null; this.profile = fix(ls.get('guest', null), ''); }
    this.onChange();
  }

  async register(name, pass) {
    name = this.validate(name, pass);
    if (ONLINE) {
      await this.fbAuth('signUp', name, pass);
      this.profile = { ...fix(ls.get('guest', null), name), name }; // ההתקדמות שנצברה כאורח עוברת לחשבון החדש
      ls.del('guest');
      await this.db('PUT', `users/${this.user.uid}`, this.profile);
    } else {
      const users = ls.get('users', {});
      if (users[keyOf(name)]) throw new AuthError('שם המשתמש כבר תפוס');
      const salt = hex(crypto.getRandomValues(new Uint8Array(12)));
      const start = { ...fix(ls.get('guest', null), name), name };
      ls.del('guest');
      users[keyOf(name)] = { name, salt, hash: await sha(salt + pass), profile: start };
      ls.set('users', users);
      this.user = { name, uid: 'L:' + keyOf(name) };
      this.profile = fix(start, name);
      ls.set('session', { name });
    }
    this.onChange();
  }

  async login(name, pass) {
    name = String(name || '').trim();
    if (!name || !pass) throw new AuthError('הקלידו שם משתמש וסיסמה');
    if (ONLINE) {
      await this.fbAuth('signInWithPassword', name, pass);
      this.profile = fix(await this.db('GET', `users/${this.user.uid}`), this.user.name);
      this.user.name = this.profile.name || name;
    } else {
      const u = ls.get('users', {})[keyOf(name)];
      if (!u || u.hash !== (await sha(u.salt + pass))) throw new AuthError('שם משתמש או סיסמה שגויים');
      this.user = { name: u.name, uid: 'L:' + keyOf(u.name) };
      this.profile = fix(u.profile, u.name);
      ls.set('session', { name: u.name });
    }
    this.onChange();
  }

  logout() {
    this.user = null; this.tok = null; this.profile = fix(ls.get('guest', null), '');
    ls.del('session');
    this.onChange();
  }

  // ----- Firebase (REST, בלי ספריות) -----
  async fbAuth(action, name, pass) {
    const email = 'u' + hex(new TextEncoder().encode(keyOf(name))) + '@nitrolink.example';
    let r, j;
    try {
      r = await fetch(`${AUTH}${action}?key=${FIREBASE.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, returnSecureToken: true }) });
      j = await r.json();
    } catch { throw new AuthError('אין חיבור לשרת החשבונות'); }
    if (!r.ok) {
      const code = j?.error?.message || '';
      if (code.startsWith('EMAIL_EXISTS')) throw new AuthError('שם המשתמש כבר תפוס');
      if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) throw new AuthError('שם משתמש או סיסמה שגויים');
      if (code.startsWith('WEAK_PASSWORD')) throw new AuthError('הסיסמה חלשה מדי (לפחות 6 תווים)');
      if (code.startsWith('TOO_MANY_ATTEMPTS')) throw new AuthError('יותר מדי ניסיונות, נסו שוב מאוחר יותר');
      throw new AuthError('שגיאת התחברות: ' + code);
    }
    this.tok = { idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (Number(j.expiresIn) - 60) * 1000 };
    this.user = { name, uid: j.localId };
    ls.set('session', { name, uid: j.localId, refreshToken: j.refreshToken });
  }

  async token() {
    if (!this.tok) return null;
    if (Date.now() < this.tok.exp && this.tok.idToken) return this.tok.idToken;
    const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(this.tok.refreshToken),
    });
    const j = await r.json();
    if (!r.ok) throw new Error('token');
    this.tok = { idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (Number(j.expires_in) - 60) * 1000 };
    if (this.user) ls.set('session', { name: this.user.name, uid: this.user.uid, refreshToken: j.refresh_token });
    return this.tok.idToken;
  }

  async db(method, path, body) {
    const t = await this.token();
    const r = await fetch(`${DB}/${path}.json${t ? '?auth=' + t : ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error('db ' + r.status);
    return r.json();
  }

  // ----- התקדמות ו-XP -----
  // kind: 'race' | 'chain'. מחזיר {first, newPb, prev, xp, saved}
  award(kind, level, ms) {
    const p = this.profile, best = kind === 'race' ? p.bestRace : p.bestChain;
    const prev = best[level] || 0, first = !prev, newPb = !prev || ms < prev;
    let xp = first ? 100 + level * 25 : 15;
    if (newPb && !first) xp += 40 + Math.min(60, Math.round(((prev - ms) / prev) * 300));
    if (kind === 'chain') xp = Math.round(xp * 1.2);
    if (newPb) best[level] = ms;
    p[kind] = Math.max(p[kind] || 0, level);
    // גביעים ומטבעות: שלב חדש שווה הרבה, שיא אישי קצת, ומשחק חוזר מעט
    const tr = first ? level : Math.floor(level / 3); // שלב חדש = מספר השלב; שלב שכבר הושלם = שליש, מעוגל למטה
    const coins = first ? 30 + level * 2 : newPb ? 12 : 5;
    p.xp = (p.xp || 0) + xp; p.tr = (p.tr || 0) + tr; p.coins = (p.coins || 0) + coins;
    this.keep();
    return { first, newPb, prev, xp, tr, coins, saved: this.loggedIn };
  }

  finishRace(level, ms) {
    const res = this.award('race', level, ms);
    if (this.loggedIn) this.persist().then(() => this.pushRace()).catch(() => {});
    this.onChange();
    return res;
  }

  // team = [{name, uid}] של כל השחקנים בשרשרת
  finishChain(level, ms, team) {
    const res = this.award('chain', level, ms);
    if (this.loggedIn) this.persist().then(() => this.pushChain(level, ms, team)).catch(() => {});
    this.onChange();
    return res;
  }

  // אורח: שומרים את הפרופיל בדפדפן
  keep() { if (!this.user) ls.set('guest', this.profile); }

  // תגמול ממצבי החברים (מירוץ / קרב)
  gain(g) {
    const p = this.profile;
    p.xp = (p.xp || 0) + (g.xp || 0); p.tr = Math.max(0, (p.tr || 0) + (g.tr || 0)); p.coins = (p.coins || 0) + (g.coins || 0);
    if (this.loggedIn) this.persist().then(() => this.pushRace()).catch(() => {});
    this.keep();
    this.onChange();
    return { ...g, saved: this.loggedIn };
  }
  owns(id) { return !!this.profile.own[id]; }
  buy(id, price) {
    const p = this.profile;
    if (p.own[id] || (p.coins || 0) < price) return false;
    p.coins -= price; p.own[id] = 1;
    this.keep();
    if (this.loggedIn) this.persist().catch(() => {});
    this.onChange();
    return true;
  }
  // דרך הגביעים: i = מספר התחנה, r = {at, coins | item}
  claimed(i) { return !!((this.profile.road || 0) & (1 << i)); }
  claim(i, r) {
    const p = this.profile;
    if (this.claimed(i) || (p.tr || 0) < r.at) return false;
    p.road = (p.road || 0) | (1 << i);
    if (r.coins) p.coins = (p.coins || 0) + r.coins;
    if (r.item) p.own[r.item] = 1;
    this.keep();
    if (this.loggedIn) this.persist().catch(() => {});
    this.onChange();
    return true;
  }

  async persist() {
    if (!this.user) return;
    if (ONLINE) await this.db('PUT', `users/${this.user.uid}`, this.profile);
    else {
      const users = ls.get('users', {});
      const u = users[keyOf(this.user.name)];
      if (u) { u.profile = this.profile; ls.set('users', users); }
    }
  }

  // best: זמני השיא לכל שלב (מפתח l<שלב>, כדי ש-Firebase לא יהפוך את זה למערך)
  raceEntry() {
    const best = {};
    for (const [l, ms] of Object.entries(this.profile.bestRace)) best['l' + l] = ms;
    return { name: this.user.name, level: this.profile.race || 0, xp: this.profile.xp, tr: this.profile.tr || 0, best };
  }

  async pushRace() {
    if (!this.user || !(this.profile.race || this.profile.tr)) return;
    const k = safeKey(this.user.uid);
    if (ONLINE) await this.db('PUT', `lb/race/${k}`, this.raceEntry());
    else this.mergeLb({ race: { [k]: this.raceEntry() }, chain: {} });
  }

  async pushChain(level, ms, team) {
    const ids = team.map((t) => safeKey(t.uid || 'g:' + t.name)).sort();
    const k = ids.join('+');
    const entry = { names: team.map((t) => t.name).join(' + '), level, time: ms };
    const better = (a, b) => !b || a.level > b.level || (a.level === b.level && a.time < b.time);
    if (ONLINE) {
      const cur = await this.db('GET', `lb/chain/${k}`).catch(() => null);
      if (better(entry, cur)) await this.db('PUT', `lb/chain/${k}`, entry);
    } else this.mergeLb({ race: {}, chain: { [k]: entry } });
  }

  // טבלה מקומית – מתמזגת עם טבלאות של חברים בחדר
  exportLb() { return ls.get('lb', { race: {}, chain: {} }); }
  mergeLb(data) {
    if (ONLINE || !data || typeof data !== 'object') return;
    const lb = this.exportLb();
    const str = (v) => String(v || '').slice(0, 40), num = (v) => Math.max(0, Math.round(Number(v) || 0));
    for (const [k, e] of Object.entries(data.race || {}).slice(0, 300)) {
      const cur = lb.race[k], n = { name: str(e.name), level: num(e.level), xp: num(e.xp), tr: num(e.tr), best: {} };
      for (const [bk, bv] of Object.entries(e.best || {}).slice(0, 40)) if (/^l\d{1,2}$/.test(bk) && num(bv)) n.best[bk] = num(bv);
      if (!n.name) continue;
      if (!cur || n.level > cur.level || (n.level === cur.level && n.xp > cur.xp)) lb.race[safeKey(k)] = n;
    }
    for (const [k, e] of Object.entries(data.chain || {}).slice(0, 300)) {
      const cur = lb.chain[k], n = { names: str(e.names), level: num(e.level), time: num(e.time) };
      if (!n.names || !n.level) continue;
      if (!cur || n.level > cur.level || (n.level === cur.level && n.time < cur.time)) lb.chain[safeKey(k)] = n;
    }
    ls.set('lb', lb);
  }

  async leaderboard() {
    let lb;
    if (ONLINE) lb = (await this.db('GET', 'lb').catch(() => null)) || {};
    else lb = this.exportLb();
    const all = Object.values(lb.race || {}).filter((e) => e && e.name);
    const race = all.filter((e) => e.level > 0).sort((a, b) => b.level - a.level || b.xp - a.xp).slice(0, 50);
    const tr = all.filter((e) => e.tr > 0).sort((a, b) => b.tr - a.tr).slice(0, 50);
    const chain = Object.values(lb.chain || {}).sort((a, b) => b.level - a.level || a.time - b.time).slice(0, 50);
    return { race, chain, tr, all };
  }
}
