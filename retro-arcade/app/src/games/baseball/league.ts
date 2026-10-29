/*
 * A fully fictional league. Every team, player and name here is invented; none refer to real
 * clubs or people. Players are generated from a fixed seed so ids stay stable between launches.
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legend';
export type Position = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';

export interface Team { id: number; city: string; name: string; color: string; accent: string }
export interface Player {
  id: number;
  first: string;
  last: string;
  team: Team;
  pos: Position;
  contact: number;
  power: number;
  speed: number;
  ovr: number;
  rarity: Rarity;
  skin: string;
  hair: string;
}

export const TEAMS: Team[] = [
  { id: 0, city: 'Harbor', name: 'Gulls', color: '#2f7fd6', accent: '#ffffff' },
  { id: 1, city: 'Copper Ridge', name: 'Miners', color: '#c2622d', accent: '#ffd23f' },
  { id: 2, city: 'Pinecrest', name: 'Lumberjacks', color: '#2f8a4a', accent: '#f3ecc2' },
  { id: 3, city: 'Dunewood', name: 'Scorpions', color: '#d4a017', accent: '#3b2a3f' },
  { id: 4, city: 'Lakeshore', name: 'Herons', color: '#2bb5a0', accent: '#ffffff' },
  { id: 5, city: 'Ironvale', name: 'Forge', color: '#6b6f80', accent: '#ff8a1f' },
  { id: 6, city: 'Sunport', name: 'Comets', color: '#e8402e', accent: '#ffd23f' },
  { id: 7, city: 'Maple Hollow', name: 'Foxes', color: '#e87a1e', accent: '#ffffff' },
  { id: 8, city: 'Frostfield', name: 'Wolves', color: '#5aa9e8', accent: '#3b2a3f' },
  { id: 9, city: 'Bayou Bend', name: 'Gators', color: '#4f9e2f', accent: '#ffd23f' },
  { id: 10, city: 'Stonebridge', name: 'Titans', color: '#8b5cf0', accent: '#ffffff' },
  { id: 11, city: 'Redwood Point', name: 'Bears', color: '#a8402e', accent: '#f3ecc2' },
];

const FIRST = [
  'Mateo', 'Jalen', 'Ryder', 'Kai', 'Dante', 'Cole', 'Nico', 'Tobias', 'Elias', 'Marcus', 'Ezra', 'Silas', 'Rafael', 'Declan', 'Hugo',
  'Andre', 'Felix', 'Bo', 'Leon', 'Quincy', 'Reid', 'Tomas', 'Wes', 'Arlo', 'Jonah', 'Cruz', 'Beau', 'Darius', 'Emmett', 'Gideon',
  'Ivan', 'Jasper', 'Knox', 'Lucas', 'Milo', 'Omar', 'Pablo', 'Rocco', 'Sam', 'Theo',
];
const LAST = [
  'Alvarez', 'Brooks', 'Castillo', 'Dawson', 'Ellis', 'Fontaine', 'Gallo', 'Hendrix', 'Ibarra', 'Jennings', 'Kowalski', 'Lombardi',
  'Mercer', 'Nakamura', 'Okafor', 'Pruitt', 'Quinn', 'Ramsey', 'Soto', 'Tanaka', 'Underhill', 'Vance', 'Whitaker', 'Yates', 'Zhao',
  'Abbott', 'Beckett', 'Calloway', 'Delgado', 'Eastman', 'Foster', 'Granger', 'Holloway', 'Iverson', 'Jarrett', 'Kessler',
  'Langley', 'Moreno', 'Navarro', 'Ortega', 'Pierce', 'Rowan', 'Sutter', 'Trevino', 'Valdez', 'Wexler', 'Yoon', 'Zamora',
];
const POSITIONS: Position[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const SKINS = ['#ffd3a8', '#f1b98a', '#d99a6c', '#b87650', '#8a5a3c', '#5e3b26'];
const HAIRS = ['#2b1d16', '#4a3020', '#7a4b26', '#c58a3a', '#d9d2c4', '#a8402e'];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export const rarityFor = (ovr: number): Rarity =>
  ovr >= 91 ? 'legend' : ovr >= 83 ? 'epic' : ovr >= 72 ? 'rare' : ovr >= 60 ? 'uncommon' : 'common';

export const RARITY: Record<Rarity, { label: string; frame: string; glow: string; weight: number }> = {
  common: { label: 'COMMON', frame: '#9a9fb0', glow: '#d9dbe4', weight: 55 },
  uncommon: { label: 'UNCOMMON', frame: '#4fb36a', glow: '#c9f0d2', weight: 27 },
  rare: { label: 'RARE', frame: '#3f8be0', glow: '#cfe4fa', weight: 12 },
  epic: { label: 'EPIC', frame: '#9b5de5', glow: '#e4d3fa', weight: 5 },
  legend: { label: 'LEGEND', frame: '#f2a900', glow: '#fff0b8', weight: 1.4 },
};

function build(): Player[] {
  const r = rng(2013);
  const out: Player[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 120; i++) {
    let first = FIRST[Math.floor(r() * FIRST.length)];
    let last = LAST[Math.floor(r() * LAST.length)];
    while (used.has(first + last)) {
      first = FIRST[Math.floor(r() * FIRST.length)];
      last = LAST[Math.floor(r() * LAST.length)];
    }
    used.add(first + last);
    const base = 38 + 60 * Math.pow(r(), 1.9);
    const jitter = () => Math.max(30, Math.min(99, Math.round(base + (r() - 0.5) * 30)));
    const contact = jitter();
    const power = jitter();
    const speed = jitter();
    const ovr = Math.round(contact * 0.45 + power * 0.4 + speed * 0.15);
    out.push({
      id: i,
      first,
      last,
      team: TEAMS[i % TEAMS.length],
      pos: POSITIONS[i % POSITIONS.length],
      contact, power, speed, ovr,
      rarity: rarityFor(ovr),
      skin: SKINS[Math.floor(r() * SKINS.length)],
      hair: HAIRS[Math.floor(r() * HAIRS.length)],
    });
  }
  return out;
}

export const PLAYERS: Player[] = build();
export const playerById = (id: number) => PLAYERS[id];

/** Draws one player by rarity weight. */
export function drawPlayer(): Player {
  const total = PLAYERS.reduce((t, p) => t + RARITY[p.rarity].weight, 0);
  let roll = Math.random() * total;
  for (const p of PLAYERS) {
    roll -= RARITY[p.rarity].weight;
    if (roll <= 0) return p;
  }
  return PLAYERS[0];
}

/** Nine modest starters for a brand new club. */
export function starterIds(): number[] {
  const sorted = [...PLAYERS].filter((p) => p.ovr < 62).sort((a, b) => b.ovr - a.ovr);
  const pickedPos = new Set<Position>();
  const out: number[] = [];
  for (const p of sorted) {
    if (pickedPos.has(p.pos)) continue;
    pickedPos.add(p.pos);
    out.push(p.id);
    if (out.length === 9) break;
  }
  return out;
}
