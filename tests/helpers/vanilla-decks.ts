// Frozen copy of the M2 fuzz decks (no card abilities). The golden regression test
// plays these, so M3+ changes must leave vanilla games exactly as M2 played them.
// Do not edit; the live fuzz decks are in fuzz-decks.ts.
// Original synthetic cards, not real ones. Between them the decks use every
// trigger icon, counter events, Backup, level 0-3 and every card type.

import type { CardCatalog, CardDef, Color, TriggerIcon } from '../../src/engine';

interface Plan {
  color: Color;
  prefix: string;
  word: string;
  /** Icons on the four non-blank character lines, low level first. */
  charIcons: [TriggerIcon[], TriggerIcon[], TriggerIcon[], TriggerIcon[]];
  /** Two climax lines, four copies each. */
  climaxIcons: [TriggerIcon[], TriggerIcon[]];
}

const PLANS: Plan[] = [
  { color: 'yellow', prefix: 'FY', word: 'Amber', charIcons: [['comeback'], ['soul'], ['draw'], ['treasure']], climaxIcons: [['soul', 'shot'], ['soul', 'return']] },
  { color: 'red', prefix: 'FR', word: 'Crimson', charIcons: [['gate'], ['soul'], ['standby'], ['choice']], climaxIcons: [['soul', 'pool'], ['soul', 'draw']] },
  { color: 'blue', prefix: 'FB', word: 'Cobalt', charIcons: [['pool'], ['soul'], ['comeback'], ['soul']], climaxIcons: [['soul', 'soul'], ['standby', 'standby']] },
];

function cards(plan: Plan): { defs: CardDef[]; deck: string[] } {
  const { color, prefix: x, word } = plan;
  const ch = (id: string, name: string, level: number, cost: number, power: number, soul: number, triggers: TriggerIcon[], extra: Partial<CardDef> = {}): CardDef => ({
    id: `${x}-${id}`,
    name: `${word} ${name}`,
    kind: 'character',
    color,
    level,
    cost,
    power,
    soul,
    ...(triggers.length > 0 ? { triggers } : {}),
    ...extra,
  });
  const [i0, i1, i2, i3] = plan.charIcons;
  const defs: CardDef[] = [
    ch('0a', 'Cadet', 0, 0, 2500, 1, []),
    ch('0b', 'Lookout', 0, 0, 3000, 1, i0),
    ch('0c', 'Runner', 0, 0, 1500, 1, []),
    ch('1a', 'Warden', 1, 0, 5000, 1, i1),
    ch('1b', 'Medic', 1, 1, 4000, 1, [], { backup: { power: 2000, level: 1, stock: 1 } }),
    ch('1c', 'Sentry', 1, 1, 6000, 1, []),
    ch('2a', 'Vanguard', 2, 1, 7500, 1, i2),
    ch('2b', 'Lancer', 2, 2, 9000, 2, []),
    ch('3a', 'Marshal', 3, 2, 10500, 2, i3),
    { id: `${x}-E0`, name: `${word} Parry`, kind: 'event', color, level: 0, cost: 0, counter: true },
    { id: `${x}-E1`, name: `${word} Flare`, kind: 'event', color, level: 1, cost: 1 },
    { id: `${x}-X1`, name: `${word} Surge`, kind: 'climax', color, triggers: plan.climaxIcons[0] },
    { id: `${x}-X2`, name: `${word} Rally`, kind: 'climax', color, triggers: plan.climaxIcons[1] },
  ];
  const counts: Record<string, number> = { '0a': 4, '0b': 4, '0c': 4, '1a': 4, '1b': 4, '1c': 4, '2a': 4, '2b': 4, '3a': 4, E0: 4, E1: 2, X1: 4, X2: 4 };
  const deck = Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => `${x}-${id}`));
  return { defs, deck };
}

const built = PLANS.map(cards);

export const vanillaCatalog: CardCatalog = Object.fromEntries(built.flatMap((b) => b.defs).map((d) => [d.id, d]));

/** Three legal 50-card decks: yellow, red, blue. */
export const vanillaDecks: readonly (readonly string[])[] = built.map((b) => b.deck);
