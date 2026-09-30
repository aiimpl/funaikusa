// The two battles. Both are fought in Miyakubo-seto, the channel between Oshima and Noshima (the map follows the real
// layout; the battles are made up). World axes: x east, z south; the channel runs west-north-west to east-south-east.
//   horoku  (after the first battle of Kizugawaguchi, 1576): the player leads the Noshima side, a seki-bune and a swarm
//           of kobaya waiting in the lee of the castle island; a heavier fleet with two atake comes up the channel.
//   oozutsu (after the second, 1578): the player commands an atake with three bow guns; the Noshima swarm comes at it.
// Win: the enemy flagship taken or sunk, or two thirds of the enemy ships out of the fight (sunk, taken or fled). Lose: the player's ship
// sunk or taken, or two thirds of the player's side out of the fight.
export const SCENARIOS = {
  horoku: {
    hour: 6.4, wind: [4.5, 0.2], player: 'A',
    ships: [
      // Noshima side: the flagship seki and the swarm, in the lee (north-east) of Noshima
      ['seki', 'A', 180, -150, -1.9, { player: true, flagship: true }],
      ['seki', 'A', 240, -110, -1.9], ['seki', 'A', 150, -220, -1.9],
      ...Array.from({ length: 12 }, (_, i) => ['kobaya', 'A', 230 + (i % 4) * 22, -200 + Math.floor(i / 4) * 26 + (i % 2) * 8, -1.9]),
      // the attackers, coming up the channel from the west-north-west
      ['atake', 'B', -900, -420, 1.25, { flagship: true }], ['atake', 'B', -1030, -330, 1.25],
      ...Array.from({ length: 6 }, (_, i) => ['seki', 'B', -830 - (i % 3) * 60, -600 + Math.floor(i / 3) * 280 + (i % 3) * 30, 1.25]),
      ...Array.from({ length: 6 }, (_, i) => ['kobaya', 'B', -800 - i * 30, -250 + (i % 2) * 30, 1.25]),
    ],
  },
  oozutsu: {
    hour: 9.2, wind: [5.0, 0.3], player: 'B',
    ships: [
      ['atake', 'B', -800, -400, 1.25, { player: true, flagship: true }], ['atake', 'B', -930, -300, 1.25],
      ...Array.from({ length: 4 }, (_, i) => ['seki', 'B', -850 - (i % 2) * 70, -560 + Math.floor(i / 2) * 330, 1.25]),
      ['seki', 'A', 260, -40, -1.9, { flagship: true }], ['seki', 'A', 200, 60, -1.9], ['seki', 'A', 320, -160, -1.9],
      ...Array.from({ length: 18 }, (_, i) => ['kobaya', 'A', 140 + (i % 6) * 26, -260 + Math.floor(i / 6) * 150 + (i % 2) * 10, -1.9]),
    ],
  },
};

export function setup(fleet, name) {
  const S = SCENARIOS[name];
  for (const [kind, side, x, z, h, o] of S.ships) fleet.add(kind, side, x, z, h, o ?? {});
  return S;
}

const out = (s) => !s.alive || s.taken || s.broken;
const lost = (s) => !s.alive || s.taken;
export function outcome(fleet, player) {
  if (!player.alive || player.taken) return 'lose';
  const enemy = player.side === 'A' ? 'B' : 'A';
  const E = fleet.ships.filter((s) => s.side === enemy), F = fleet.ships.filter((s) => s.side === player.side);
  const flag = E.find((s) => s.flagship);
  if (E.length && ((flag && lost(flag)) || E.filter(out).length >= E.length * 2 / 3)) return 'win';
  if (F.filter(out).length >= F.length * 2 / 3) return 'lose';
  return null;
}
