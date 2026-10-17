// Regression tests for the fresh-context M3a review (2026-10-16): each finding
// is pinned here so it cannot come back.
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
