// פריטים קוסמטיים: טפטים, צבעי גרדיאנט, נוצות וקישוטים – דרך הגביעים והחנות
export const WRAPS = ['ללא', 'פסי מירוץ', 'להבות', 'הסוואה', 'שחמט', 'ברקים', 'זברה', 'כוורת'];
export const GRADS = [
  null,
  { n: 'שקיעה', a: '#ffd21a', b: '#ff3d2e' },
  { n: 'אוקיינוס', a: '#00e5ff', b: '#1e3bff' },
  { n: 'גלקסיה', a: '#ff5ad1', b: '#2a0f7a' },
  { n: 'רעיל', a: '#d4ff3a', b: '#00a86b' },
  { n: 'סוכריה', a: '#7afcff', b: '#ff5ad1' },
  { n: 'אש וקרח', a: '#00e5ff', b: '#ff2d55' },
  { n: 'זהב', a: '#fff0a8', b: '#c47a0a' },
];
export const FEATHERS = [
  null,
  { n: 'לבנות', c: ['#ffffff', '#dfe8ff'] },
  { n: 'עוף החול', c: ['#ff2d1a', '#ff7a1a', '#ffd21a'] },
  { n: 'טווס', c: ['#00c2a8', '#1e7bff', '#22d38a'] },
  { n: 'קשת', c: ['#ff2d55', '#ff7a1a', '#ffd21a', '#22d38a', '#1e7bff', '#b14dff'] },
  { n: 'זהב', c: ['#ffd86b', '#ffb41a'] },
  { n: 'עורב', c: ['#20242e', '#3a3f55'] },
];
export const TRAILS = ['רגיל', 'קשת', 'ניצוצות זהב', 'קרח'];
export const HORNS = ['ללא', 'קלאסי', 'משאית', 'מנגינה', 'לייזר'];
const TYPE_NAMES = { 3: 'נקניקייה', 4: 'בננה', 5: 'ארגז קרטון', 6: 'גבינה', 7: 'ברווז ענק', 8: 'אסלה', 9: 'נעל' };
const TYPE_ICON = { 3: '🌭', 4: '🍌', 5: '📦', 6: '🧀', 7: '🦆', 8: '🚽', 9: '👟' };
export const KIND_NAME = { type: 'רכב', wrap: 'טפט', grad: 'גרדיאנט', feather: 'נוצות', topper: 'קישוט גג', wheel: 'גלגלים', tfx: 'שובל', horn: 'צופר' };
const TOPPER_NAMES = { 5: 'הילה', 6: 'ברווז גומי' }, WHEEL_NAMES = { 3: 'דיסק מלא', 4: 'טבעות ניאון' };

export function itemName(id) {
  const m = /^([a-z]+)(\d+)$/.exec(id);
  if (!m) return id;
  const k = m[1], i = Number(m[2]);
  if (k === 'type') return `${TYPE_ICON[i]} רכב: ${TYPE_NAMES[i]}`;
  const n = k === 'wrap' ? WRAPS[i] : k === 'grad' ? GRADS[i]?.n : k === 'feather' ? FEATHERS[i]?.n : k === 'wheel' ? WHEEL_NAMES[i] : k === 'tfx' ? TRAILS[i] : k === 'horn' ? HORNS[i] : TOPPER_NAMES[i];
  return `${KIND_NAME[k]}: ${n}`;
}

// דרך הגביעים: at = כמה גביעים צריך
export const ROAD = [
  { at: 10, coins: 100 }, { at: 25, item: 'wrap1' }, { at: 45, coins: 150 }, { at: 70, item: 'grad1' },
  { at: 100, item: 'feather1' }, { at: 130, coins: 200 }, { at: 165, item: 'wrap2' }, { at: 200, item: 'grad2' },
  { at: 240, coins: 300 }, { at: 280, item: 'feather2' }, { at: 330, item: 'wrap5' }, { at: 380, coins: 400 },
  { at: 440, item: 'grad3' }, { at: 500, item: 'feather4' }, { at: 580, coins: 600 }, { at: 660, item: 'grad7' },
  { at: 750, item: 'feather5' },
];
export const SHOP = [
  { item: 'type5', price: 300 }, { item: 'type9', price: 400 }, { item: 'type6', price: 500 }, { item: 'type3', price: 600 },
  { item: 'type4', price: 600 }, { item: 'type7', price: 800 }, { item: 'type8', price: 1000 },
  { item: 'wrap3', price: 150 }, { item: 'wrap4', price: 200 }, { item: 'wrap6', price: 250 }, { item: 'wrap7', price: 350 },
  { item: 'grad4', price: 200 }, { item: 'grad5', price: 300 }, { item: 'grad6', price: 400 },
  { item: 'feather3', price: 450 }, { item: 'feather6', price: 350 },
  { item: 'topper5', price: 250 }, { item: 'topper6', price: 400 },
  { item: 'wheel3', price: 200 }, { item: 'wheel4', price: 300 },
  { item: 'tfx3', price: 250 }, { item: 'tfx2', price: 300 }, { item: 'tfx1', price: 400 },
  { item: 'horn2', price: 150 }, { item: 'horn4', price: 200 }, { item: 'horn3', price: 300 },
];
// מאיפה משיגים כל פריט נעול
export const SOURCE = {};
for (const r of ROAD) if (r.item) SOURCE[r.item] = `דרך הגביעים (${r.at} 🏆)`;
for (const s of SHOP) SOURCE[s.item] = `חנות (${s.price} 🪙)`;

// רקע לתצוגה מקדימה של פריט
export function itemSwatch(id) {
  const m = /^([a-z]+)(\d+)$/.exec(id), i = Number(m[2]);
  if (m[1] === 'grad') return `linear-gradient(90deg, ${GRADS[i].b}, ${GRADS[i].a})`;
  if (m[1] === 'feather') return `linear-gradient(90deg, ${FEATHERS[i].c.join(', ')})`;
  if (m[1] === 'type') return 'linear-gradient(135deg, #ff5ad1, #ffd21a 50%, #19d3ff)';
  if (m[1] === 'tfx') return ['', 'linear-gradient(90deg, red, orange, yellow, lime, cyan, blue, violet)', 'radial-gradient(circle, #fff, #ffc21a)', 'linear-gradient(135deg, #fff, #38b6ff)'][i];
  if (m[1] === 'horn') return 'radial-gradient(circle, #ff5a1f 30%, #2a1a10 32%)';
  if (m[1] === 'wheel') return 'radial-gradient(circle, #e8eefc 35%, #111 37% 62%, #19d3ff 64%)';
  if (m[1] === 'wrap') return 'repeating-linear-gradient(135deg, #ff7a1a 0 6px, #1e2a55 6px 12px)';
  return 'linear-gradient(135deg, #ffd86b, #ff9a2e)';
}
