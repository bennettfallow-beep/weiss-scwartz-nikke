// Regression tests for the fresh-context M3a reviews (2026-10-16 and the
// re-review of 2026-10-17): each finding is pinned here so it cannot come back.
import { describe, expect, it } from 'vitest';

import { abilityText, applyAction, checkInvariants, legalActions, projectView, validateCatalog } from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CostPart, GameState, Step } from '../../src/engine';
import { act, cardIn, makeState } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

const character = (id: string, abilities: Ability[], extra: Partial<CardDef> = {}): CardDef => ({
  id,
  name: `Review ${id}`,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 3000,
  soul: 1,
  abilities,
  ...extra,
});
const event = (id: string, effect: Step[]): CardDef => ({ id, name: `Review ${id}`, kind: 'event', color: 'yellow', level: 0, cost: 0, effect });
const withCards = (...defs: CardDef[]): CardCatalog => ({ ...catalog, ...Object.fromEntries(defs.map((d) => [d.id, d])) });
const codes = (cat: CardCatalog) => validateCatalog(cat).map((e) => `${e.code}@${e.path ?? ''}`);

function apply(s: GameState, cat: CardCatalog, a: Action): GameState {
  const r = applyAction(s, cat, a);
  if (!r.ok) throw new Error(`${a.type}: ${r.error.code} ${r.error.message}`);
  expect(checkInvariants(r.state, cat)).toEqual([]);
  return r.state;
}

describe('review finding 1: cost parts that use this card', () => {
  const act1 = (cost: CostPart[]) => character('C1', [{ kind: 'activated', timing: 'main', cost, effect: [{ do: 'draw', count: 1 }] }]);

  it('rejects putting this card into the waiting room before another part, and repeated rest or self parts', () => {
    expect(codes(withCards(act1([{ pay: 'selfToWaiting' }, { pay: 'rest' }])))).toContain('ABILITY_COST@abilities.0.cost.0');
    expect(codes(withCards(act1([{ pay: 'rest' }, { pay: 'rest' }])))).toContain('ABILITY_COST@abilities.0.cost');
    expect(codes(withCards(act1([{ pay: 'stock', count: 1 }, { pay: 'selfToWaiting' }, { pay: 'selfToWaiting' }])))).toContain('ABILITY_COST@abilities.0.cost.1');
    expect(validateCatalog(withCards(act1([{ pay: 'rest' }, { pay: 'selfToWaiting' }])))).toEqual([]);
  });

  it('rest then put-this-into-the-waiting-room is paid in that order without an engine fault', () => {
    const cat = withCards(act1([{ pay: 'rest' }, { pay: 'selfToWaiting' }]));
    const s = makeState(cat, { start: 'main', players: [{ deck: ['Y0', 'Y0', 'Y0'], stage: { 1: 'C1' } }, { deck: ['R0'] }] });
    const card = cardIn(s, 0, 'stage', 'C1');
    expect(legalActions(s, cat)).toContainEqual({ type: 'ACTIVATE', player: 0, card, ability: 0 });
    const after = apply(s, cat, { type: 'ACTIVATE', player: 0, card, ability: 0 });
    expect(after.players[0].waiting).toContain(card);
    expect(after.players[0].hand).toHaveLength(1);
  });
});

describe('review finding 2: choose names', () => {
  const twoMays: Step[] = [
    { do: 'may', steps: [{ do: 'choose', as: 't', count: 1, what: { side: 'you' } }], then: [{ do: 'power', amount: 1000, target: { ref: 't' } }] },
    { do: 'may', steps: [{ do: 'choose', as: 't', count: 1, what: { side: 'opponent' } }], then: [{ do: 'power', amount: -1000, target: { ref: 't' } }] },
  ];

  it('rejects a name used twice anywhere in one ability, even in separate branches', () => {
    expect(codes(withCards(event('E1', twoMays)))).toContain('ABILITY_REF@effect.1.steps.0.as');
  });

  it('a later pick under an already used name replaces the earlier one at runtime', () => {
    // Bypass the validator to check the engine itself: the second choice must hit the opponent's card.
    const cat = withCards(event('E1', twoMays));
    const s = makeState(cat, { start: 'main', players: [{ hand: ['E1'], deck: ['Y0', 'Y0'], stage: { 1: 'Y1' } }, { deck: ['R0'], stage: { 1: 'R1' } }] });
    let t = apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E1') });
    t = apply(t, cat, { type: 'ACCEPT', player: 0 });
    t = apply(t, cat, { type: 'ACCEPT', player: 0 });
    const mods = t.effects.map((e) => [t.cards[e.card.card]?.def, e.amount]);
    expect(mods).toEqual([
      ['Y1', 1000],
      ['R1', -1000],
    ]);
  });
});

describe('review finding 3: prompts do not reveal hidden cards', () => {
  it('a filtered discard prompts whenever the hand has cards, whether or not any match', () => {
    const cat = withCards(event('E2', [{ do: 'discard', count: 1, filter: { color: 'red' } }]));
    const prompt = (hand: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E2', ...hand], deck: ['Y0'] }, { deck: ['R0'] }] });
      const t = apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E2') });
      return { pending: projectView(t, 1).pending, mine: t.pending };
    };
    const without = prompt(['Y0']);
    const withMatch = prompt(['R0']);
    expect(without.pending).toEqual({ kind: 'pick', player: 0, redacted: true });
    expect(withMatch.pending).toEqual(without.pending);
    // The player sees nothing selectable and may only end the choice.
    expect(without.mine?.kind === 'pick' ? without.mine.options : null).toEqual([]);
  });

  it('a filtered take from looked-at cards prompts whenever cards were looked at', () => {
    const cat = withCards(event('E3', [{ do: 'lookTop', count: 2, take: { count: 1, filter: { color: 'red' }, to: 'hand' }, rest: 'waiting' }]));
    const pendingFor = (deck: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E3'], deck }, { deck: ['R0'] }] });
      return projectView(apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E3') }), 1).pending;
    };
    expect(pendingFor(['Y0', 'Y0', 'Y0'])).toEqual({ kind: 'pick', player: 0, redacted: true });
    expect(pendingFor(['Y0', 'Y0', 'R0'])).toEqual({ kind: 'pick', player: 0, redacted: true });
  });

  it('an automatic ability with a filtered discard cost asks whether to pay either way; pay is offered only if possible', () => {
    const cat = withCards(character('C2', [{ kind: 'automatic', trigger: { on: 'play' }, cost: [{ pay: 'discard', count: 1, filter: { color: 'red' } }], effect: [{ do: 'draw', count: 1 }] }]));
    const run = (hand: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['C2', ...hand], deck: ['Y0', 'Y0'] }, { deck: ['R0'] }] });
      return apply(s, cat, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s, 0, 'hand', 'C2'), slot: 1 });
    };
    const cannot = run(['Y0']);
    const can = run(['R0']);
    expect(projectView(cannot, 1).pending).toEqual({ kind: 'optional', player: 0, redacted: true });
    expect(projectView(can, 1).pending).toEqual(projectView(cannot, 1).pending);
    expect(legalActions(cannot, cat).map((a) => a.type)).toEqual(['PASS']);
    expect(legalActions(can, cat).map((a) => a.type).sort()).toEqual(['ACCEPT', 'PASS']);
    // The opponent's log shows the same thing in both cases after a decline.
    const declined = apply(cannot, cat, { type: 'PASS', player: 0 });
    expect(declined.log.some((e) => e.kind === 'abilityLapsed')).toBe(false);
  });
});

describe('review finding 4: card text tells different abilities apart', () => {
  const lvl = [{ if: 'level', min: 2 }] as const;
  const auto = (effect: Step[]): Ability => ({ kind: 'automatic', trigger: { on: 'play' }, effect });

  it('a step inside an "if" reads differently from a step after it', () => {
    const inside = abilityText(auto([{ do: 'if', when: lvl, then: [{ do: 'draw', count: 1 }, { do: 'damageOpp', amount: 1 }] }]));
    const after = abilityText(auto([{ do: 'if', when: lvl, then: [{ do: 'draw', count: 1 }] }, { do: 'damageOpp', amount: 1 }]));
    expect(inside).not.toBe(after);
    expect(inside).toBe('[AUTO] When this card is played and placed, if your level is 2 or more, draw 1 card, then deal 1 damage to your opponent.');
    expect(after).toBe('[AUTO] When this card is played and placed, if your level is 2 or more, draw 1 card. Deal 1 damage to your opponent.');
  });

  it('a conditional continuous ability names every change under its condition', () => {
    const text = abilityText({
      kind: 'continuous',
      when: [{ if: 'turn', side: 'you' }],
      modifiers: [
        { stat: 'power', amount: 1000, target: 'this' },
        { stat: 'soul', amount: 1, target: 'this' },
      ],
    });
    expect(text).toBe('[CONT] While it is your turn, this card gets +1000 power and +1 soul.');
  });

  it('"you may" reads as an action for every kind of step', () => {
    expect(abilityText(auto([{ do: 'may', steps: [{ do: 'draw', count: 1, player: 'opponent' }] }]))).toContain('you may have your opponent draw 1 card');
    expect(abilityText(auto([{ do: 'may', steps: [{ do: 'power', amount: 1000, target: 'this' }] }]))).toContain('you may give this card +1000 power until end of turn');
  });
});

describe('review nits', () => {
  it('the game state never shares objects with the card catalog', () => {
    const def = event('E4', [{ do: 'may', steps: [{ do: 'draw', count: 1 }] }]);
    const cat = withCards(def);
    const s = makeState(cat, { start: 'main', players: [{ hand: ['E4'], deck: ['Y0', 'Y0'] }, { deck: ['R0'] }] });
    const t = apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E4') });
    const wait = t.resolving?.wait;
    expect(wait?.for).toBe('may');
    if (wait?.for === 'may') expect(wait.step).not.toBe(def.effect?.[0]);
    // A caller freezing the returned state must not freeze the catalog.
    const freeze = (x: unknown): void => {
      if (x && typeof x === 'object' && !Object.isFrozen(x)) {
        Object.freeze(x);
        Object.values(x).forEach(freeze);
      }
    };
    freeze(t);
    expect(Object.isFrozen(def.effect?.[0])).toBe(false);
  });

  it('"you may" counts as done only if the whole action can be done (CR 8.6.4)', () => {
    // "You may return 2 characters from your waiting room; if you do, draw 1; if not, deal 1 damage." With only 1 there:
    const cat = withCards(event('E5', [{ do: 'may', steps: [{ do: 'salvage', count: 2, filter: { kind: 'character' } }], then: [{ do: 'draw', count: 1 }], else: [{ do: 'damageOpp', amount: 1 }] }]));
    const s = makeState(cat, { start: 'main', players: [{ hand: ['E5'], waiting: ['Y0'], deck: ['Y0', 'Y0'] }, { deck: ['R0', 'R0', 'R0'] }] });
    const t = act(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E5') }, { type: 'ACCEPT', player: 0 });
    expect(t.players[0].waiting.filter((id) => t.cards[id]?.def === 'Y0')).toHaveLength(1);
    expect(t.log.some((e) => e.kind === 'damage' && e.target === 1)).toBe(true);
  });
});

// --- Re-review (2026-10-17) ---------------------------------------------------------

/** Plays the same public answers in two games that differ only in hidden cards; the watcher's view must match after each. */
function sameView(cat: CardCatalog, games: GameState[], watcher: 0 | 1, steps: ((t: GameState) => Action)[]): GameState[] {
  let states = games;
  expect(projectView(states[1]!, watcher)).toEqual(projectView(states[0]!, watcher));
  for (const step of steps) {
    states = states.map((t) => apply(t, cat, step(t)));
    expect(projectView(states[1]!, watcher)).toEqual(projectView(states[0]!, watcher));
  }
  return states;
}
const firstOption = (t: GameState): Action => {
  if (t.pending?.kind !== 'pick' || t.pending.options[0] === undefined) throw new Error('no pick option');
  return { type: 'CHOOSE_CARD', player: t.pending.player, card: t.pending.options[0] };
};
const passBy =
  (player: 0 | 1) =>
  (): Action => ({ type: 'PASS', player });

describe('re-review finding 1: a filtered pick of several hidden cards does not show how many match', () => {
  it('discarding 2 red cards: after the first, the pick stays open whether or not another red card is in hand', () => {
    const cat = withCards(event('E1', [{ do: 'discard', count: 2, filter: { color: 'red' } }, { do: 'draw', count: 1 }]));
    const game = (hand: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E1', ...hand], deck: ['Y0', 'Y0', 'Y0'] }, { deck: ['R0'] }] });
      return apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E1') });
    };
    const [one, two] = sameView(cat, [game(['R0', 'Y0', 'Y0']), game(['R0', 'R0', 'Y0'])], 1, [firstOption]);
    // The bounds follow the hand size; with no red card left the player can only end the pick.
    expect(one?.pending).toMatchObject({ kind: 'pick', options: [], min: 0, max: 2 });
    expect(legalActions(one!, cat).map((a) => a.type)).toEqual(['PASS']);
    expect(legalActions(two!, cat).map((a) => a.type).sort()).toEqual(['CHOOSE_CARD', 'PASS']);
    const [doneOne, doneTwo] = sameView(cat, [one!, two!], 1, [passBy(0)]);
    expect(doneOne?.pending?.kind).toBe('play');
    expect(doneTwo?.players[0].hand).toHaveLength(3);
  });

  it('taking up to 2 red cards from 3 looked at: after the first, the pick stays open whether or not another is there', () => {
    const cat = withCards(event('E2', [{ do: 'lookTop', count: 3, take: { count: 2, filter: { color: 'red' }, to: 'hand' }, rest: 'waiting' }]));
    const game = (deck: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E2'], deck }, { deck: ['R0'] }] });
      return apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E2') });
    };
    const [one] = sameView(cat, [game(['Y0', 'Y0', 'Y0', 'R0']), game(['Y0', 'Y0', 'R0', 'R0'])], 1, [firstOption]);
    expect(one?.pending).toMatchObject({ kind: 'pick', purpose: 'lookTake', options: [], min: 0, max: 2 });
  });
});

describe('re-review finding 2: "you may" with a discard chosen by card information', () => {
  const mayRed = (player?: 'opponent') =>
    event('E3', [{ do: 'may', steps: [{ do: 'discard', count: 1, filter: { color: 'red' }, ...(player ? { player } : {}) }], then: [{ do: 'draw', count: 1 }], else: [{ do: 'damageOpp', amount: 1 }] }]);
  const damaged = (t: GameState) => t.log.some((e) => e.kind === 'damage' && e.target === 1);

  it('from your own hand: a yes is followed by the pick whatever the hand holds, and the branch follows from the pick (CR 8.6.4)', () => {
    const cat = withCards(mayRed());
    const game = (hand: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E3', ...hand], deck: ['Y0', 'Y0'] }, { deck: ['R0', 'R0', 'R0'] }] });
      return apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E3') });
    };
    const [none, red] = sameView(cat, [game(['Y0']), game(['R0'])], 1, [() => ({ type: 'ACCEPT', player: 0 })]);
    expect(none?.pending).toMatchObject({ kind: 'pick', player: 0, options: [], min: 0, max: 1 });
    expect(red?.pending).toMatchObject({ kind: 'pick', player: 0, min: 0, max: 1 });

    // Picking the red card is doing A: draw, no damage.
    const did = apply(red!, cat, firstOption(red!));
    expect(did.players[0].waiting.map((c) => did.cards[c]?.def).sort()).toEqual(['E3', 'R0']);
    expect(did.players[0].hand.map((c) => did.cards[c]?.def)).toEqual(['Y0']);
    expect(damaged(did)).toBe(false);
    // Ending the pick with nothing picked is not doing A, whether or not a red card was there.
    for (const t of [none!, red!]) {
      const not = apply(t, cat, { type: 'PASS', player: 0 });
      expect(damaged(not)).toBe(true);
      expect(not.players[0].hand).toHaveLength(1);
    }
  });

  it("from the opponent's hand: the master learns nothing from the yes, and the opponent may find nothing even holding a red card", () => {
    const cat = withCards(mayRed('opponent'));
    expect(validateCatalog(cat)).toEqual([]);
    const game = (oppHand: string[]) => {
      const s = makeState(cat, { start: 'main', players: [{ hand: ['E3'], deck: ['Y0', 'Y0', 'Y0'] }, { hand: oppHand, deck: ['R0', 'R0', 'R0'] }] });
      return apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E3') });
    };
    const [none, red] = sameView(cat, [game(['Y0', 'Y0']), game(['R0', 'Y0'])], 0, [() => ({ type: 'ACCEPT', player: 0 }), passBy(1)]);
    expect(damaged(none!)).toBe(true);
    expect(damaged(red!)).toBe(true);
    expect(red?.players[1].hand).toHaveLength(2);
  });

  it('with fewer cards in hand than the stated number, which everyone can see, the "if you do not" part runs at once', () => {
    const cat = withCards(event('E4', [{ do: 'may', steps: [{ do: 'discard', count: 2, filter: { color: 'red' } }], else: [{ do: 'damageOpp', amount: 1 }] }]));
    const s = makeState(cat, { start: 'main', players: [{ hand: ['E4', 'R0'], deck: ['Y0'] }, { deck: ['R0', 'R0'] }] });
    let t = apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E4') });
    t = apply(t, cat, { type: 'ACCEPT', player: 0 });
    expect(t.pending?.kind).toBe('play');
    expect(damaged(t)).toBe(true);
  });

  it('"you may look at the top 3 cards" counts as done with only 2 in the deck: a look ends normally when the deck runs short (CR 3.2.3.3)', () => {
    const cat = withCards(event('E5', [{ do: 'may', steps: [{ do: 'lookTop', count: 3, rest: 'top' }], then: [{ do: 'stockFromDeck', count: 1 }], else: [{ do: 'damageOpp', amount: 1 }] }]));
    const s = makeState(cat, { start: 'main', players: [{ hand: ['E5'], deck: ['Y0', 'Y0'], waiting: ['Y0', 'Y0'] }, { deck: ['R0', 'R0'] }] });
    let t = apply(s, cat, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'E5') });
    t = apply(t, cat, { type: 'ACCEPT', player: 0 });
    while (t.pending?.kind === 'pick') t = apply(t, cat, firstOption(t));
    expect(t.log.some((e) => e.kind === 'look')).toBe(true);
    expect(damaged(t)).toBe(false);
    expect(t.players[0].stock).toHaveLength(1);
  });
});

describe('re-review finding 3: card text for a branch that ends with another branch', () => {
  const lvl = [{ if: 'level', min: 2 }] as const;
  const mine = [{ if: 'turn', side: 'you' }] as const;
  const draw: Step = { do: 'draw', count: 1 };
  const hit: Step = { do: 'damageOpp', amount: 1 };
  const auto = (effect: Step[]): Ability => ({ kind: 'automatic', trigger: { on: 'play' }, effect });

  it('an inner "otherwise" reads differently from an outer one', () => {
    const inner = abilityText(auto([{ do: 'if', when: lvl, then: [{ do: 'if', when: mine, then: [draw], else: [hit] }] }]));
    const outer = abilityText(auto([{ do: 'if', when: lvl, then: [{ do: 'if', when: mine, then: [draw] }], else: [hit] }]));
    expect(inner).toBe('[AUTO] When this card is played and placed, if your level is 2 or more, if it is your turn, draw 1 card; otherwise, deal 1 damage to your opponent.');
    expect(outer).toBe('[AUTO] When this card is played and placed, if your level is 2 or more, (if it is your turn, draw 1 card); otherwise, deal 1 damage to your opponent.');
  });

  it('an inner "if you do not" reads differently from an outer one', () => {
    const inner = abilityText(auto([{ do: 'may', steps: [draw], then: [{ do: 'may', steps: [hit], else: [draw] }] }]));
    const outer = abilityText(auto([{ do: 'may', steps: [draw], then: [{ do: 'may', steps: [hit] }], else: [draw] }]));
    expect(inner).not.toBe(outer);
    expect(outer).toContain('if you do, (you may deal 1 damage to your opponent); if you do not, draw 1 card');
  });
});

describe('re-review finding 4 and nits: attacking and defending characters, names', () => {
  const act1 = (effect: Step[]) => character('C3', [{ kind: 'activated', timing: 'counter', cost: [{ pay: 'stock', count: 1 }], effect }]);

  it('"other" is part of the text for an attacking or defending character', () => {
    const text = (other: boolean) => abilityText({ kind: 'automatic', trigger: { on: 'play' }, effect: [{ do: 'power', amount: 1000, target: { all: { side: 'you', role: 'defender', ...(other ? { other } : {}) } } }] });
    expect(text(true)).toContain('your other defending character gets +1000 power');
    expect(text(false)).toContain('your defending character gets +1000 power');
  });

  it('only 1 attacking or defending character can be chosen', () => {
    const choose = (count: number): Step[] => [{ do: 'choose', as: 'd', count, what: { side: 'you', role: 'defender' } }, { do: 'power', amount: 1000, target: { ref: 'd' } }];
    expect(codes(withCards(act1(choose(2))))).toEqual(['ABILITY_RANGE@abilities.0.effect.0.count']);
    expect(validateCatalog(withCards(act1(choose(1))))).toEqual([]);
  });

  it('names and traits in abilities may not contain the quote marks card text puts around them', () => {
    const named = (name: string): Ability => ({ kind: 'continuous', when: [{ if: 'climax', name }], modifiers: [{ stat: 'power', amount: 500, target: 'this' }] });
    expect(codes(withCards(character('C4', [named('A" in the climax area and you have "B')])))).toEqual(['ABILITY_FILTER@abilities.0.when.0.name']);
    expect(codes(withCards(character('C5', [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: { side: 'you', trait: 'Squad»' } }] }])))).toEqual(['ABILITY_FILTER@abilities.0.modifiers.0.target.trait']);
    expect(validateCatalog(withCards(character('C6', [named("Captain's Gate")])))).toEqual([]);
  });

  it('a choose name used twice is one error, not two', () => {
    const twice: Step[] = [
      { do: 'choose', as: 't', count: 1, what: { side: 'you' } },
      { do: 'choose', as: 't', count: 1, what: { side: 'opponent' } },
      { do: 'power', amount: 1000, target: { ref: 't' } },
    ];
    expect(codes(withCards(event('E6', twice)))).toEqual(['ABILITY_REF@effect.1.as']);
  });
});
