// On-screen text: compass strip (heading, where the wind comes from, the enemy flagship), speed in knots, the beat
// and the crew, the tide and the time, the bow guns (loading bars), the order to the fleet, the tally of both sides,
// and messages. Directions: +x east, -z north.
import { t, onLang } from './i18n.js';
const deg = (r) => ((r * 57.29578) % 360 + 360) % 360;
export const bearing = (dx, dz) => deg(Math.atan2(dx, -dz));

export function makeHUD() {
  const $ = (id) => document.getElementById(id);
  const strip = $('strip');
  const labels = [];
  for (let a = -360; a <= 720; a += 15) {
    const el = document.createElement('i');
    el.className = a % 45 === 0 ? 'lab' : 'tick';
    el.style.left = `${a * 4}px`;
    if (a % 45 === 0) labels.push([el, ((a / 45) % 8 + 8) % 8]);
    strip.appendChild(el);
  }
  const relabel = () => { for (const [el, k] of labels) el.textContent = t('dirs')[k]; };
  relabel(); onLang(relabel);
  const windMark = $('windmark'), destMark = $('destmark');
  let msgT = 0, gunEls = [];
  return {
    message(text, sec = 6) { $('msg').textContent = text; $('msg').classList.add('on'); msgT = sec; },
    update({ ship, hour, wind, tide, target, fleet, dt }) {
      const b = ship.body;
      const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
      $('time').textContent = t('time')(h, m);
      $('spd').textContent = (Math.max(b.speed, 0) * 1.9438).toFixed(1);
      const hd = bearing(Math.sin(b.heading), Math.cos(b.heading));
      strip.style.transform = `translateX(${-hd * 4}px)`;
      const wv = wind.uniforms.uWind.value;
      const from = bearing(-wv.x, -wv.y);
      const rel = (a) => ((a - hd + 540) % 360) - 180;
      windMark.style.left = `${rel(from) * 4 + 300}px`;
      windMark.style.opacity = Math.abs(rel(from)) < 72 ? 1 : 0;
      if (target) {
        const dx = target.body.pos.x - b.pos.x, dz = target.body.pos.z - b.pos.z;
        destMark.style.left = `${Math.max(-290, Math.min(290, rel(bearing(dx, dz)) * 4)) + 300}px`;
        $('dest').textContent = `${t('kinds')[target.kind]}  ${(Math.hypot(dx, dz)).toFixed(0)} m`;
      }
      const beat = Math.round((b.ctl.beatL + b.ctl.beatR) / 2);
      $('beat').textContent = t('beat')(t('beats')[beat], b.fatigue);
      $('crew').textContent = t('crew')(Math.round(b.rowersAlive), Math.round(ship.fighters), `${Math.round(ship.morale * 100)}%`);
      const tv = tide.uniforms.uTide.value;
      $('tide').textContent = Math.abs(tv) < 0.2 ? t('slack') : tv > 0 ? t('flood') : t('ebb');
      // guns
      if (gunEls.length !== ship.guns.length) {
        $('guns').innerHTML = ship.guns.map(() => '<span><em></em><i></i></span>').join('');
        gunEls = [...$('guns').children];
      }
      ship.guns.forEach((g, i) => {
        const el = gunEls[i];
        const k = 1 - g.reload / (g.full || 20);
        el.style.setProperty('--k', `${Math.round(k * 100)}%`);
        el.classList.toggle('ready', g.reload <= 0);
        el.firstChild.textContent = g.reload <= 0 ? `${t('gun')(i)} ${t('ready')}` : t('gun')(i);
      });
      $('order').textContent = t('order')(t('orders')[['follow', 'scatter', 'surround', 'retreat'].indexOf(fleet.orders[ship.side])]);
      const cnt = (side, alive) => fleet.ships.filter((s) => s.side === side && (!alive || (s.alive && !s.taken && !s.broken))).length;
      const other = ship.side === 'A' ? 'B' : 'A';
      $('tally').innerHTML = t('tally')(cnt(ship.side, true), cnt(ship.side, false), cnt(other, true), cnt(other, false));
      if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').classList.remove('on'); }
    },
  };
}
