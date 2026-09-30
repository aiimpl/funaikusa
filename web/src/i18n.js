// On-screen language: English by default, Japanese on request (?lang=ja, or the button at the top right).
// The choice is remembered in this browser. Static text in index.html carries data-t="key"; dynamic text asks t().
const S = {
  en: {
    title: 'Funaikusa', titleSub: 'sea battle in the Seto Inland Sea, 1580s', cardSub: 'Sea Battle of the Island Pirates',
    s1: 'Fire pots in the strait', s1d: 'You lead the Noshima side: one seki-bune and a swarm of kobaya.<br>Ride the tide in close, set them alight, board.',
    s2: 'Great guns off the island', s2d: 'You command a great atake-bune with three guns in its bow.<br>Keep the swarm off and break it at range.',
    loading: 'Loading', hint: 'A / D helm, W / S the beat of the oars. F fires the bow guns, R / V sets their elevation.',
    knots: 'knots',
    keys: '<kbd>A</kbd><kbd>D</kbd> helm　<kbd>W</kbd><kbd>S</kbd> beat　<kbd>F</kbd> fire　<kbd>R</kbd><kbd>V</kbd> elevation　<kbd>G</kbd> grapple　<kbd>1</kbd>-<kbd>4</kbd> orders　<kbd>M</kbd> mast　<kbd>C</kbd> view',
    beats: ['Oars shipped', 'Steady', 'Hard', 'All out'],
    beat: (b, f) => `${b}${f > 0.5 ? ' (rowers tiring)' : ''}`,
    crew: (r, f, m) => `rowers ${r}  fighters ${f}  spirit ${m}`,
    orders: ['Follow the flagship', 'Scatter', 'Surround', 'Fall back'],
    order: (o) => `Order: ${o}`,
    tally: (a, a0, b, b0) => `ours <b>${a}</b> / ${a0}<br>theirs <b>${b}</b> / ${b0}`,
    gun: (i) => `gun ${i + 1}`, ready: 'loaded',
    dirs: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
    dirs16: ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'],
    wind: (d, s) => `${d} wind ${s} m/s`,
    time: (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    slack: 'Slack water', flood: 'Flood tide (running east)', ebb: 'Ebb tide (running west)',
    battle: 'Drums and conch: masts down, to the oars', grapple: 'Grapnels over — board her!', noGrapple: 'Not close enough to grapple',
    takenThem: (k) => `We take their ${k}`, takenUs: (k) => `Our ${k} is taken`,
    sunkThem: (k) => `Their ${k} goes down`, sunkUs: (k) => `Our ${k} goes down`, broken: (k) => `Their ${k} breaks off and runs`,
    kinds: { atake: 'atake-bune', seki: 'seki-bune', kobaya: 'kobaya' },
    win: 'Victory', lose: 'Defeat', winSub: 'The enemy fleet is broken', loseSub: 'Your ship is lost',
    lang: '日本語',
  },
  ja: {
    title: '船戦', titleSub: '戦国末・瀬戸内の水軍', cardSub: '瀬戸内・海賊衆の船戦',
    s1: '焙烙の瀬戸', s1d: '能島方を率いる。関船1艘と小早の群れ。<br>潮に乗って寄せ、焼いて、乗り込む。',
    s2: '大筒の沖', s2d: '船首に大筒3門の安宅船を預かる。<br>小早の群れを寄せつけず、遠くから崩す。',
    loading: '読み込み中', hint: 'A・D で舵、W・S で櫓の拍子。F で船首の大筒、R・V で仰角。',
    knots: 'ノット',
    keys: '<kbd>A</kbd><kbd>D</kbd> 舵　<kbd>W</kbd><kbd>S</kbd> 拍子　<kbd>F</kbd> 撃て　<kbd>R</kbd><kbd>V</kbd> 仰角　<kbd>G</kbd> 熊手　<kbd>1</kbd>-<kbd>4</kbd> 下知　<kbd>M</kbd> 帆柱　<kbd>C</kbd> 視点',
    beats: ['櫓を止め', '並の拍子', '急ぎの拍子', '総がかり'],
    beat: (b, f) => `${b}${f > 0.5 ? '（漕ぎ手が疲れてきた）' : ''}`,
    crew: (r, f, m) => `漕ぎ手 ${r}　武者 ${f}　士気 ${m}`,
    orders: ['旗船に続け', '散れ', '囲め', '退け'],
    order: (o) => `下知：${o}`,
    tally: (a, a0, b, b0) => `味方 <b>${a}</b> / ${a0}<br>敵 <b>${b}</b> / ${b0}`,
    gun: (i) => `大筒 ${i + 1}`, ready: '込め済み',
    dirs: ['北', '北東', '東', '南東', '南', '南西', '西', '北西'],
    dirs16: ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'],
    wind: (d, s) => `${d}の風 ${s}m`,
    time: (h, m) => `${h}時${String(m).padStart(2, '0')}分`,
    slack: '潮どまり', flood: '上げ潮（東へ流れる）', ebb: '下げ潮（西へ流れる）',
    battle: '陣太鼓と法螺貝。帆柱を倒し、櫓にかかれ', grapple: '熊手を掛けた。乗り込め', noGrapple: '熊手の届く近さではない',
    takenThem: (k) => `敵の${k}を奪った`, takenUs: (k) => `味方の${k}を奪われた`,
    sunkThem: (k) => `敵の${k}が沈む`, sunkUs: (k) => `味方の${k}が沈む`, broken: (k) => `敵の${k}が逃げ出した`,
    kinds: { atake: '安宅船', seki: '関船', kobaya: '小早' },
    win: '勝ち戦', lose: '負け戦', winSub: '敵の船団は崩れた', loseSub: '御座船を失った',
    lang: 'English',
  },
};

function initial() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'ja' || q === 'en') return q;
  try { const v = localStorage.getItem('funaikusa.lang'); if (v === 'ja' || v === 'en') return v; } catch (e) { /* storage blocked */ }
  return 'en';
}

let lang = initial();
const listeners = [];
export const t = (k) => S[lang][k];
export const getLang = () => lang;
export function onLang(fn) { listeners.push(fn); }
export function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-t]')) el.innerHTML = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
}
export function setLang(l) {
  lang = l;
  try { localStorage.setItem('funaikusa.lang', l); } catch (e) { /* storage blocked */ }
  applyStatic();
  listeners.forEach((fn) => fn(l));
}
export function toggleLang() { setLang(lang === 'en' ? 'ja' : 'en'); }
