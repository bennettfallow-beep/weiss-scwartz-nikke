// Synthetic fuzz decks (original cards, not real ones). Between them they use
// every trigger icon, counter events, Backup, level 0-3, every card type, and
// every part of the ability language (each trigger, timing, step, cost,
// condition and filter), so random games reach the rare branches.
// tests/helpers/vanilla-decks.ts keeps the ability-free M2 version.

import type { Ability, CardCatalog, CardDef, Color, Step, TriggerIcon } from '../../src/engine';

interface Plan {
  color: Color;
  prefix: string;
  word: string;
  /** Icons on the four non-blank character lines, low level first. */
  charIcons: [TriggerIcon[], TriggerIcon[], TriggerIcon[], TriggerIcon[]];
  /** Two climax lines, four copies each. */
  climaxIcons: [TriggerIcon[], TriggerIcon[]];
  /** Abilities, event effects and traits by line id. */
  text: Record<string, { abilities?: Ability[]; effect?: Step[]; traits?: string[] }>;
}

const YELLOW_TEXT: Plan['text'] = {
  // On play: draw 1, then discard 1.
  '0a': { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'draw', count: 1 }, { do: 'discard', count: 1 }] }] },
  // [(1), rest]: another character +1000.
  '0b': {
    abilities: [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'stock', count: 1 }, { pay: 'rest' }],
        effect: [{ do: 'choose', as: 'ally', count: 1, what: { side: 'you', other: true } }, { do: 'power', amount: 1000, target: { ref: 'ally' } }],
      },
    ],
  },
  // Your other characters +500.
  '0c': { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: { side: 'you', other: true } }] }] },
  // During your turn with a climax: +1000 and +1 soul.
  '1a': {
    abilities: [
      {
        kind: 'continuous',
        when: [{ if: 'turn', side: 'you' }, { if: 'climax' }],
        modifiers: [
          { stat: 'power', amount: 1000, target: 'this' },
          { stat: 'soul', amount: 1, target: 'this' },
        ],
      },
    ],
  },
  // When reversed, you may pay [discard 1]: up to 1 character from the waiting room to hand.
  '1b': { abilities: [{ kind: 'automatic', trigger: { on: 'reversed' }, cost: [{ pay: 'discard', count: 1 }], effect: [{ do: 'salvage', count: 1, upTo: true, filter: { kind: 'character' } }] }] },
  // When attacking: look at 3, up to 1 character to hand, rest on top in any order.
  '1c': { abilities: [{ kind: 'automatic', trigger: { on: 'attack' }, effect: [{ do: 'lookTop', count: 3, take: { count: 1, upTo: true, filter: { kind: 'character' }, to: 'hand' }, rest: 'top' }] }] },
  // When a climax is played: 1 damage.
  '2a': { abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [{ do: 'damageOpp', amount: 1 }] }] },
  // [COUNTER] [(1)]: your defending character +1500.
  '2b': { abilities: [{ kind: 'activated', timing: 'counter', cost: [{ pay: 'stock', count: 1 }], effect: [{ do: 'power', amount: 1500, target: { all: { side: 'you', role: 'defender' } } }] }] },
  // On play, at level 2+: you may discard a climax; if you do heal 1, if not stock 1.
  '3a': {
    abilities: [
      {
        kind: 'automatic',
        trigger: { on: 'play' },
        effect: [
          {
            do: 'if',
            when: [{ if: 'level', min: 2 }],
            then: [{ do: 'may', steps: [{ do: 'discard', count: 1, filter: { kind: 'climax' } }], then: [{ do: 'heal', count: 1 }], else: [{ do: 'stockFromDeck', count: 1 }] }],
          },
        ],
      },
    ],
  },
  E0: { effect: [{ do: 'choose', as: 'd', count: 1, what: { side: 'you', role: 'defender' } }, { do: 'power', amount: 2000, target: { ref: 'd' } }] },
  E1: { effect: [{ do: 'choose', as: 'foe', count: 1, what: { side: 'opponent', level: { max: 1 } } }, { do: 'returnToHand', target: { ref: 'foe' } }] },
  X1: { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you' } }] }] },
  X2: { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'draw', count: 1, upTo: true }] }] },
};

const RED_TEXT: Plan['text'] = {
  // When reversed: your opponent draws 1.
  '0a': { traits: ['Crimson Squad'], abilities: [{ kind: 'automatic', trigger: { on: 'reversed' }, effect: [{ do: 'draw', count: 1, player: 'opponent' }] }] },
  // [put this into the waiting room]: up to 1 of your characters gets +1 soul for as long as it stays.
  '0b': {
    traits: ['Crimson Squad'],
    abilities: [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'selfToWaiting' }],
        effect: [{ do: 'choose', as: 'a', count: 1, upTo: true, what: { side: 'you', other: true } }, { do: 'soul', amount: 1, target: { ref: 'a' }, duration: 'game' }],
      },
    ],
  },
  // With 2+ Crimson Squad characters: +1000.
  '0c': { traits: ['Crimson Squad'], abilities: [{ kind: 'continuous', when: [{ if: 'count', what: { side: 'you', trait: 'Crimson Squad' }, min: 2 }], modifiers: [{ stat: 'power', amount: 1000, target: 'this' }] }] },
  // On play: look at up to 2, up to 1 card to stock, rest to the waiting room.
  '1a': { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'lookTop', count: 2, upTo: true, take: { count: 1, upTo: true, to: 'stock' }, rest: 'waiting' }] }] },
  // When attacking, you may pay [(1)]: an opponent's level 0 character goes to the waiting room.
  '1b': {
    abilities: [
      {
        kind: 'automatic',
        trigger: { on: 'attack' },
        cost: [{ pay: 'stock', count: 1 }],
        effect: [{ do: 'choose', as: 'foe', count: 1, what: { side: 'opponent', level: { max: 0 } } }, { do: 'sendToWaiting', target: { ref: 'foe' } }],
      },
    ],
  },
  // On play: a climax from the waiting room to hand.
  '1c': { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'salvage', count: 1, filter: { kind: 'climax' } }] }] },
  // While your opponent is level 2+: +1500.
  '2a': { abilities: [{ kind: 'continuous', when: [{ if: 'level', side: 'opponent', min: 2 }], modifiers: [{ stat: 'power', amount: 1500, target: 'this' }] }] },
  // When reversed: your opponent discards 1.
  '2b': { abilities: [{ kind: 'automatic', trigger: { on: 'reversed' }, effect: [{ do: 'discard', count: 1, player: 'opponent' }] }] },
  // On play: look at 4, up to 2 red characters to hand, rest to the bottom in any order.
  '3a': {
    abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'lookTop', count: 4, take: { count: 2, upTo: true, filter: { kind: 'character', color: 'red' }, to: 'hand' }, rest: 'bottom' }] }],
  },
  E0: { effect: [{ do: 'power', amount: 3000, target: { all: { side: 'you', role: 'defender' } } }] },
  E1: { effect: [{ do: 'draw', count: 2 }, { do: 'discard', count: 1 }] },
  X1: { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'stockFromDeck', count: 1 }] }] },
  X2: { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'soul', amount: 1, target: { side: 'you' } }] }] },
};

const BLUE_TEXT: Plan['text'] = {
  // On play, with 3+ characters in your waiting room: up to 1 "Cobalt Runner" back to hand.
  '0a': {
    abilities: [
      {
        kind: 'automatic',
        trigger: { on: 'play' },
        effect: [
          {
            do: 'if',
            when: [{ if: 'count', what: { side: 'you', zone: 'waiting', kind: 'character' }, min: 3 }],
            then: [{ do: 'salvage', count: 1, upTo: true, filter: { name: 'Cobalt Runner' } }],
          },
        ],
      },
    ],
  },
  // [discard a character]: draw 1.
  '0b': { abilities: [{ kind: 'activated', timing: 'main', cost: [{ pay: 'discard', count: 1, filter: { kind: 'character' } }], effect: [{ do: 'draw', count: 1 }] }] },
  // When attacking: up to 1 opposing level 0-1 character gets -1000.
  '1a': {
    abilities: [
      {
        kind: 'automatic',
        trigger: { on: 'attack' },
        effect: [{ do: 'choose', as: 'foe', count: 1, upTo: true, what: { side: 'opponent', level: { max: 1 } } }, { do: 'power', amount: -1000, target: { ref: 'foe' } }],
      },
    ],
  },
  // While you are level 1+: +500.
  '1b': { abilities: [{ kind: 'continuous', when: [{ if: 'level', min: 1 }], modifiers: [{ stat: 'power', amount: 500, target: 'this' }] }] },
  // When a climax is played: this card +1 soul.
  '1c': { abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Cobalt Surge' }, effect: [{ do: 'soul', amount: 1, target: 'this' }] }] },
  // On play: you may heal 1.
  '2a': { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'may', steps: [{ do: 'heal', count: 1 }] }] }] },
  // [(2)]: an opposing level 0-2 character goes back to hand.
  '2b': {
    abilities: [
      {
        kind: 'activated',
        timing: 'main',
        cost: [{ pay: 'stock', count: 2 }],
        effect: [{ do: 'choose', as: 'foe', count: 1, what: { side: 'opponent', level: { max: 2 } } }, { do: 'returnToHand', target: { ref: 'foe' } }],
      },
    ],
  },
  // On play: 1 damage. Your other characters +1000.
  '3a': {
    abilities: [
      { kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'damageOpp', amount: 1 }] },
      { kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', other: true } }] },
    ],
  },
  E0: { effect: [{ do: 'choose', as: 'd', count: 1, what: { side: 'you', role: 'defender' } }, { do: 'power', amount: 2500, target: { ref: 'd' } }] },
  // Look at 5, up to 1 climax to hand, the rest to the waiting room... or on top: on top in any order.
  E1: { effect: [{ do: 'lookTop', count: 5, take: { count: 1, filter: { kind: 'climax' }, to: 'hand' }, rest: 'top' }] },
  X1: { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: { side: 'you' } }] }] },
  X2: { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'lookTop', count: 1, take: { count: 1, to: 'waiting' }, rest: 'top' }] }] },
};

const PLANS: Plan[] = [
  { color: 'yellow', prefix: 'FY', word: 'Amber', charIcons: [['comeback'], ['soul'], ['draw'], ['treasure']], climaxIcons: [['soul', 'shot'], ['soul', 'return']], text: YELLOW_TEXT },
  { color: 'red', prefix: 'FR', word: 'Crimson', charIcons: [['gate'], ['soul'], ['standby'], ['choice']], climaxIcons: [['soul', 'pool'], ['soul', 'draw']], text: RED_TEXT },
  { color: 'blue', prefix: 'FB', word: 'Cobalt', charIcons: [['pool'], ['soul'], ['comeback'], ['soul']], climaxIcons: [['soul', 'soul'], ['standby', 'standby']], text: BLUE_TEXT },
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
  // Attach each line's text (abilities, an event's effect, traits).
  const withText = defs.map((d): CardDef => ({ ...d, ...(plan.text[d.id.slice(x.length + 1)] ?? {}) }));
  return { defs: withText, deck };
}

const built = PLANS.map(cards);

export const fuzzCatalog: CardCatalog = Object.fromEntries(built.flatMap((b) => b.defs).map((d) => [d.id, d]));

/** Three legal 50-card decks: yellow, red, blue. */
export const fuzzDecks: readonly (readonly string[])[] = built.map((b) => b.deck);
