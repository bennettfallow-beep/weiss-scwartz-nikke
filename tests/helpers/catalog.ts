// Synthetic test cards (original, not real cards). Ids describe the card so
// tests read clearly: color, kind, level.

import type { CardCatalog, CardDef, Color } from '../../src/engine';

const defs: CardDef[] = [
  // Characters
  { id: 'Y0', name: 'Yellow Scout', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 2000, soul: 1 },
  { id: 'Y0b', name: 'Yellow Scout', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 2500, soul: 1 }, // same name, other print
  { id: 'Y1', name: 'Yellow Ranger', kind: 'character', color: 'yellow', level: 1, cost: 1, power: 5000, soul: 1 },
  { id: 'Y2', name: 'Yellow Captain', kind: 'character', color: 'yellow', level: 2, cost: 1, power: 7000, soul: 1 },
  { id: 'Y3', name: 'Yellow Commander', kind: 'character', color: 'yellow', level: 3, cost: 2, power: 10000, soul: 2 },
  { id: 'R0', name: 'Red Scout', kind: 'character', color: 'red', level: 0, cost: 0, power: 3000, soul: 1 },
  { id: 'R1', name: 'Red Ranger', kind: 'character', color: 'red', level: 1, cost: 0, power: 4500, soul: 1 },
  { id: 'R3', name: 'Red Commander', kind: 'character', color: 'red', level: 3, cost: 2, power: 10500, soul: 2 },
  { id: 'B0', name: 'Blue Scout', kind: 'character', color: 'blue', level: 0, cost: 0, power: 2500, soul: 1 },
  { id: 'B1', name: 'Blue Ranger', kind: 'character', color: 'blue', level: 1, cost: 1, power: 5500, soul: 1 },
  { id: 'G0', name: 'Green Scout', kind: 'character', color: 'green', level: 0, cost: 0, power: 2000, soul: 1 },
  { id: 'Z0', name: 'Hollow Drone', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 0, soul: 1 }, // power 0
  // Events
  { id: 'YE0', name: 'Yellow Signal', kind: 'event', color: 'yellow', level: 0, cost: 0 },
  { id: 'YE1', name: 'Yellow Barrage', kind: 'event', color: 'yellow', level: 1, cost: 1 },
  { id: 'RC0', name: 'Red Parry', kind: 'event', color: 'red', level: 0, cost: 1, counter: true },
  // Climaxes
  { id: 'YX', name: 'Yellow Dawn', kind: 'climax', color: 'yellow', triggers: ['soul'] },
  { id: 'RX', name: 'Red Dusk', kind: 'climax', color: 'red', triggers: ['soul'] },
  { id: 'BX', name: 'Blue Tide', kind: 'climax', color: 'blue', triggers: ['draw'] },
];

/** Filler characters so 50-card decks can be built without breaking the 4-per-name rule. */
function filler(color: Color): CardDef[] {
  return Array.from({ length: 12 }, (_, i) => {
    const level = i % 4;
    return {
      id: `F-${color}-${i}`,
      name: `Filler ${color} ${i}`,
      kind: 'character',
      color,
      level,
      cost: level === 0 ? 0 : level - 1,
      power: 2000 + level * 2500,
      soul: level >= 2 ? 2 : 1,
    } satisfies CardDef;
  });
}

const all = [...defs, ...filler('yellow'), ...filler('red')];

export const catalog: CardCatalog = Object.fromEntries(all.map((d) => [d.id, d]));

/** A legal 50-card deck: 4 copies each of 9 filler names, 4 events, 2 Scouts, plus 8 climaxes. */
export function legalDeck(color: 'yellow' | 'red' = 'yellow'): string[] {
  const deck: string[] = [];
  for (let i = 0; i < 9; i++) for (let k = 0; k < 4; k++) deck.push(`F-${color}-${i}`);
  const event = color === 'yellow' ? 'YE0' : 'RC0';
  for (let k = 0; k < 4; k++) deck.push(event);
  const scout = color === 'yellow' ? 'Y0' : 'R0';
  deck.push(scout, scout);
  const cx = color === 'yellow' ? 'YX' : 'RX';
  for (let k = 0; k < 4; k++) deck.push(cx, 'BX');
  return deck;
}
