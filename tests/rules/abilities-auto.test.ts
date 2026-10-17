// Rule tests for M3: automatic abilities (CR 8.1.1.2), the check timing that
// plays them (CR 8.5.1), standby and its bookkeeping (CR 8.7.1-8.7.3, 8.7.7),
// who is master of an automatic or continuous ability (CR 4.3.5-4.3.6), and
// the source of damage dealt by an ability or an event (CR 4.11.1.2).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentPower, currentSoul, legalActions, validate, validateCatalog } from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CardId, CostPart, GameEvent, GameState, PlayerId, Slot, Step as AbilityStep, Trigger } from '../../src/engine';
import { cardIn, defsIn, makeState } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

/** A level 0 yellow character with the given abilities. */
const char = (id: string, name: string, abilities: Ability[], more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 2000,
  soul: 1,
  abilities,
  ...more,
});

const stock = (count: number) => ({ pay: 'stock', count }) as const;
const draw1: AbilityStep = { do: 'draw', count: 1 };
const pumpSelf = (amount: number): AbilityStep => ({ do: 'power', amount, target: 'this' });
const toStock: AbilityStep = { do: 'stockFromDeck', count: 1 };
const hit1: AbilityStep = { do: 'damageOpp', amount: 1 };

/** An automatic ability: "When (trigger), (effect)", with an optional "you may pay (cost)". */
function auto(on: Trigger['on'], effect: AbilityStep[], cost?: CostPart[]): Ability {
  const trigger: Trigger = { on };
  return cost === undefined ? { kind: 'automatic', trigger, effect } : { kind: 'automatic', trigger, cost, effect };
}

const extra: CardDef[] = [
  // [AUTO] When this card is played, draw a card.
  char('ADR', 'Morning Runner', [auto('play', [draw1])]),
  // [AUTO] [(1)] When this card is played, you may pay the cost. If you do, draw a card.
  char('ATL', 'Toll Runner', [auto('play', [draw1], [stock(1)])]),
  // [AUTO] When this card attacks, this card gets +1000 power.
  char('AAT', 'Spear Vanguard', [auto('attack', [pumpSelf(1000)])], { power: 3000 }),
  // [AUTO] When this card becomes reversed, draw a card.
  char('ARV', 'Mirror Guard', [auto('reversed', [draw1])]),
  // Power 3000: [AUTO] When this card becomes reversed, draw a card.
  char('ARW', 'Mirror Bastion', [auto('reversed', [draw1])], { power: 3000 }),
  // [AUTO] When a climax is played into your climax area, draw a card.
  char('ACX', 'Beacon Watcher', [auto('climaxPlayed', [draw1])]),
  // [AUTO] When a climax named "Red Dusk" is played into your climax area, this card gets +1000 power.
  char('ACN', 'Dusk Watcher', [{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Red Dusk' }, effect: [pumpSelf(1000)] }]),
  // [AUTO] [(1)] When a climax is played into your climax area, you may pay the cost. If you do, draw a card.
  char('ACC', 'Toll Watcher', [auto('climaxPlayed', [draw1], [stock(1)])]),
  // A climax: [AUTO] When this card is played, draw a card.
  { id: 'AXP', name: 'Signal Flare', kind: 'climax', color: 'yellow', triggers: ['soul'], abilities: [auto('play', [draw1])] },
  // A climax: [CONT] Your characters get +1 soul.
  { id: 'AXC', name: 'Rally Banner', kind: 'climax', color: 'yellow', triggers: ['soul'], abilities: [{ kind: 'continuous', modifiers: [{ stat: 'soul', amount: 1, target: { side: 'you' } }] }] },
  // A climax with the Shot icon and no abilities.
  { id: 'ASH', name: 'Quiet Volley', kind: 'climax', color: 'yellow', triggers: ['shot'] },
  // A climax with the Standby icon.
  { id: 'ASB', name: 'Reserve Call', kind: 'climax', color: 'yellow', triggers: ['standby'] },
  // Two play abilities: [0] put the top card of your deck into your stock; [1] draw a card.
  char('ATW', 'Twin Courier', [auto('play', [toStock]), auto('play', [draw1])]),
  // Two play abilities: [0] your opponent's characters get -2000 power; [1] draw a card.
  char('ADN', 'Ember Drainer', [auto('play', [{ do: 'power', amount: -2000, target: { all: { side: 'opponent' } } }]), auto('play', [draw1])]),
  // [AUTO] When this card is played, put the top card of your deck into your stock.
  char('AST', 'Stock Porter', [auto('play', [toStock])]),
  // Power 0: [AUTO] When this card is played, draw a card, and this card gets +1000 power.
  char('AZR', 'Fading Spark', [auto('play', [draw1, pumpSelf(1000)])], { power: 0 }),
  // Power 0: [AUTO] [Rest this card] When this card is played, you may pay the cost. If you do, draw a card.
  char('AZC', 'Fading Lamp', [auto('play', [draw1], [{ pay: 'rest' }])], { power: 0 }),
  // Two reversed abilities: [0] put your opponent's attacking character into the waiting room; [1] draw a card.
  char('ARX', 'Thorn Sentry', [auto('reversed', [{ do: 'sendToWaiting', target: { all: { side: 'opponent', role: 'attacker' } } }]), auto('reversed', [draw1])], { color: 'red' }),
  // [AUTO] When this card becomes reversed, put your opponent's defending character into the waiting room.
  char('ARS', 'Wall Breaker', [auto('reversed', [{ do: 'sendToWaiting', target: { all: { side: 'opponent', role: 'defender' } } }])]),
  // [AUTO] When this card becomes reversed, draw a card, and return this card to your hand.
  char('ARH', 'Recall Guard', [auto('reversed', [draw1, { do: 'returnToHand', target: 'this' }])], { color: 'red' }),
  // [AUTO] [(1)] When this card becomes reversed, you may pay the cost. If you do, choose 1 of your characters;
  // it gets +1000 power. Your opponent draws a card.
  char(
    'AMS',
    'Signal Warden',
    [
      auto(
        'reversed',
        [
          { do: 'choose', as: 'ally', count: 1, what: { side: 'you' } },
          { do: 'power', amount: 1000, target: { ref: 'ally' } },
          { do: 'draw', count: 1, player: 'opponent' },
        ],
        [stock(1)],
      ),
    ],
    { color: 'red' },
  ),
  // [CONT] Your other characters get +1000 power. Your opponent's characters get -500 power.
  char('ACO', 'Lantern Marshal', [
    {
      kind: 'continuous',
      modifiers: [
        { stat: 'power', amount: 1000, target: { side: 'you', other: true } },
        { stat: 'power', amount: -500, target: { side: 'opponent' } },
      ],
    },
  ]),
  // [ACT] [(1)] Choose 1 of your other characters, and return it to your hand.
  char('ARE', 'Recall Officer', [
    { kind: 'activated', timing: 'main', cost: [stock(1)], effect: [{ do: 'choose', as: 'mate', count: 1, what: { side: 'you', other: true } }, { do: 'returnToHand', target: { ref: 'mate' } }] },
  ]),
  // [ACT] [(1)] Put this card into your waiting room. Then you may draw a card.
  char('AKE', 'Ash Herald', [{ kind: 'activated', timing: 'main', cost: [stock(1)], effect: [{ do: 'sendToWaiting', target: 'this' }, { do: 'may', steps: [draw1] }] }]),
  // [AUTO] When this card is played, deal 1 damage to your opponent.
  char('ADM', 'Spark Thrower', [auto('play', [hit1])]),
  // [ACT] [(1)] Deal 1 damage to your opponent.
  char('AAC', 'Flint Thrower', [{ kind: 'activated', timing: 'main', cost: [stock(1)], effect: [hit1] }]),
  // Event: deal 1 damage to your opponent.
  { id: 'AEV', name: 'Ember Toss', kind: 'event', color: 'yellow', level: 0, cost: 0, effect: [hit1] },
  // Soul 0: [AUTO] When this card becomes reversed, deal 1 damage to your opponent.
  char('ALN', 'Hollow Lancer', [auto('reversed', [hit1])], { soul: 0 }),
  // Soul 0, power 5000, no abilities.
  { id: 'AHV', name: 'Hollow Vanguard', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 5000, soul: 0 },
  // [AUTO] When this card attacks, deal 1 damage to your opponent.
  char('AAD', 'Charge Thrower', [auto('attack', [hit1])]),
  // [AUTO] When this card becomes reversed, deal 1 damage to your opponent.
  char('ARD', 'Thorn Thrower', [auto('reversed', [hit1])], { color: 'red' }),
  // Power 0: [AUTO] [(1)] When this card is played, you may pay the cost. If you do, draw a card.
  char('AZT', 'Fading Toll', [auto('play', [draw1], [stock(1)])], { power: 0 }),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain characters with no trigger icons: trigger checks do nothing and damage always sticks. */
const PLAIN = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0', 'G0'];
/** A deck whose top cards are told apart: B0 on top, then R0, then Y1. */
const MARKED = ['G0', 'G0', 'G0', 'G0', 'Y1', 'R0', 'B0'];

function scenario(start: ScenarioSpec['start'], p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}): GameState {
  return makeState(cat, { start, players: [{ deck: PLAIN, ...p0 }, { deck: PLAIN, ...p1 }], ...more });
}

const mainPhase = (p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}) => scenario('main', p0, p1, more);
const climaxPhase = (p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}) => scenario('climax', p0, p1, more);
const attackPhase = (p0: ZoneSpec, p1: ZoneSpec = {}, more: Partial<ScenarioSpec> = {}) => scenario('attack', p0, p1, more);

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const accept = (player: PlayerId): Action => ({ type: 'ACCEPT', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });
const orderAuto = (player: PlayerId, auto: number): Action => ({ type: 'ORDER_AUTO', player, auto });
const playChar = (player: PlayerId, card: CardId, slot: Slot): Action => ({ type: 'PLAY_CHARACTER', player, card, slot });
const playClimax = (player: PlayerId, card: CardId): Action => ({ type: 'PLAY_CLIMAX', player, card });
const attack = (player: PlayerId, slot: Slot, kind: 'frontal' | 'side' | 'direct'): Action => ({ type: 'ATTACK', player, slot, attack: kind });
const activate = (player: PlayerId, card: CardId, ability: number): Action => ({ type: 'ACTIVATE', player, card, ability });

interface Run {
  state: GameState;
  events: GameEvent[];
}

/** Applies one action and throws with the engine's reason if it is refused. */
function go(s: GameState, action: Action): Run {
  const r = applyAction(s, cat, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** Applies several actions; returns the last state and every event on the way. */
function goAll(s: GameState, ...actions: Action[]): Run {
  let state = s;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = go(state, a);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

/** The error code validate gives, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const r = validate(s, cat, action);
  return r.ok ? 'ok' : r.error.code;
}

const defOf = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** The card on a stage position. */
function idAt(s: GameState, player: PlayerId, slot: Slot): CardId {
  const c = s.players[player].stage[slot - 1]?.[0];
  if (!c) throw new Error(`no card on player ${player}'s position ${slot}`);
  return c.id;
}

/** Definition ids on each stage position ('-' when empty), positions 1-5. */
function stageDefs(s: GameState, player: PlayerId): string[] {
  return s.players[player].stage.map((cards) => cards.map((c) => `${defOf(s, c.id)}${c.orientation === 'stand' ? '' : `(${c.orientation})`}`).join('+') || '-');
}

/** A readable trace of the events that matter here, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'move') return [`move:${e.reason}:${defOf(s, e.card)}:${e.from.player}.${e.from.zone}->${e.to.player}.${e.to.zone}`];
    if (e.kind === 'ability') return [`ability:${e.player}:${defOf(s, e.card)}#${String(e.index)}:${e.category}`];
    if (e.kind === 'abilityLapsed') return [`lapsed:${e.player}:${defOf(s, e.card)}#${e.index}`];
    if (e.kind === 'effect') return [`effect:${e.player}:${e.op}`];
    if (e.kind === 'modifier') return [`mod:${defOf(s, e.card)}:${e.stat}${e.amount > 0 ? '+' : ''}${e.amount}`];
    if (e.kind === 'optional') return [`optional:${e.player}:${e.purpose}:${e.accepted}`];
    if (e.kind === 'chosen') return [`chosen:${e.player}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'played') return [`played:${defOf(s, e.card)}`];
    if (e.kind === 'phase') return [`phase:${e.phase}`];
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'attack') return [`attack:${defOf(s, e.card)}:${e.attack}`];
    if (e.kind === 'battle') return [`battle:${e.reversed.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}:${e.cards.map((c) => defOf(s, c)).join(',')}`];
    if (e.kind === 'auto') return [`auto:${e.player}:${e.ability}:${defOf(s, e.card)}`];
    if (e.kind === 'damage') return [`damage:${e.target}:${e.amount}:from:${defOf(s, e.source)}`];
    if (e.kind === 'damageCanceled') return [`canceled:${e.target}:from:${defOf(s, e.source)}`];
    if (e.kind === 'damageTaken') return [`taken:${e.target}:from:${defOf(s, e.source)}`];
    if (e.kind === 'triggerCheck') return [`triggerCheck:${defOf(s, e.card)}`];
    if (e.kind === 'icon') return [`icon:${e.icon}`];
    return [];
  });
}

/** The trace up to and including the first `marker`. */
function upTo(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(0, i + 1);
}

/** The trace from the first `marker` on. */
function from(t: readonly string[], marker: string): string[] {
  const i = t.indexOf(marker);
  if (i < 0) throw new Error(`no ${marker} in ${t.join(', ')}`);
  return t.slice(i);
}

/** Only the trace entries with one of these prefixes. */
const only = (t: readonly string[], ...prefixes: string[]) => t.filter((x) => prefixes.some((p) => x.startsWith(p)));

/** Legal actions for the player being waited on, readable and sorted. */
function offers(s: GameState): string[] {
  return legalActions(s, cat)
    .map((a) => (a.type === 'ORDER_AUTO' ? `ORDER_AUTO:${String(a.auto)}` : a.type === 'ACTIVATE' ? `ACTIVATE:${defOf(s, a.card)}#${a.ability}` : 'card' in a && typeof a.card === 'string' ? `${a.type}:${defOf(s, a.card)}` : a.type))
    .filter((x, i, all) => all.indexOf(x) === i)
    .sort();
}

/** The autoOrder prompt's options as "player:DEF#index" (Encore as "player:encore:DEF"). */
function autoOptions(s: GameState): string[] {
  const p = s.pending;
  if (p?.kind !== 'autoOrder') throw new Error(`expected an autoOrder prompt, got ${p?.kind ?? 'none'}`);
  return p.options.map((a) => (a.ability === 'card' ? `${a.player}:${defOf(s, a.source.card)}#${a.index}` : a.ability === 'encore' ? `${a.player}:encore:${defOf(s, a.card.card)}` : `${a.player}:shot`));
}

/** The id of the autoOrder option whose source card is `card` (and ability index `index`). */
function optionFor(s: GameState, card: CardId, index = 0): number {
  const p = s.pending;
  if (p?.kind !== 'autoOrder') throw new Error('no autoOrder prompt');
  const o = p.options.find((a) => a.ability === 'card' && a.source.card === card && a.index === index);
  if (!o) throw new Error(`no standby option for ${card}#${index}`);
  return o.id;
}

describe('the synthetic catalog', () => {
  it('passes catalog validation', () => {
    expect(validateCatalog(cat)).toEqual([]);
  });
});

// =============================================================================
// ABL-03: automatic abilities play themselves when their condition happens (CR 8.1.1.2)
// =============================================================================

describe('ABL-03: an automatic ability is played by itself when its trigger condition is met', () => {
  it('[ABL-03] "when this card is played": playing the character sets the ability off by itself in the next check timing; it is never something a player activates', () => {
    const s0 = mainPhase({ hand: ['ADR'], deck: MARKED });
    const adr = cardIn(s0, 0, 'hand', 'ADR');
    expect(offers(s0)).toEqual(['PASS', 'PLAY_CHARACTER:ADR']);

    const r = go(s0, playChar(0, adr, 1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:ADR',
      'move:play:ADR:0.hand->0.stage',
      'check',
      'ability:0:ADR#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B0']);
    // Once on the stage it offers nothing to activate, and another card being played does not meet its condition.
    expect(offers(r.state).filter((x) => x.startsWith('ACTIVATE'))).toEqual([]);
    const later = go(r.state, playChar(0, cardIn(r.state, 0, 'hand', 'B0'), 2));
    expect(only(trace(later.state, later.events), 'ability', 'effect')).toEqual([]);
  });

  it('[ABL-03] "when this card attacks": met when that character is declared as the attacker, not when another character attacks; it resolves in the check timing before the Trigger Step', () => {
    const s0 = attackPhase({ stage: { 1: 'AAT', 2: 'Y0' } });
    const aat = idAt(s0, 0, 1);

    const other = go(s0, attack(0, 2, 'direct'));
    expect(only(trace(other.state, other.events), 'ability', 'effect', 'mod:AAT')).toEqual([]);
    expect(other.state.pending).toEqual({ kind: 'attack', player: 0 });

    const own = go(other.state, attack(0, 1, 'direct'));
    expect(upTo(trace(own.state, own.events), 'step:trigger')).toEqual([
      'action:ATTACK:0',
      'attack:AAT:direct',
      'mod:AAT:soul+1',
      'check',
      'ability:0:AAT#0:automatic',
      'effect:0:power',
      'mod:AAT:power+1000',
      'step:trigger',
    ]);
    expect(own.events.filter((e) => e.kind === 'ability').map((e) => (e.kind === 'ability' ? e.card : ''))).toEqual([aat]);
  });

  it('[ABL-03] "when this card becomes reversed": met in the battle by the reversed character only; it resolves in the check timing right after the battle', () => {
    // P0's ARW (3000) beats P1's ARV (2000). ARW has the same "when reversed" ability but wins, so it is not met for
    // it. Each player also has an ARV on the back stage, out of the battle: being on the same side as the reversed
    // character does not meet the condition either.
    const s0 = attackPhase({ stage: { 2: 'ARW', 4: 'ARV' } }, { stage: { 2: 'ARV', 4: 'ARV' }, deck: MARKED });
    const theirs = idAt(s0, 1, 2);
    const r = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    const t = trace(r.state, r.events);
    expect(only(from(t, 'step:battle'), 'step:battle', 'battle', 'check', 'ability', 'effect', 'move:draw').slice(0, 7)).toEqual([
      'step:battle',
      'check',
      'battle:ARV',
      'check',
      'ability:1:ARV#0:automatic',
      'effect:1:draw',
      'move:draw:R0:1.deck->1.hand',
    ]);
    // Only the card that was reversed: the winner and both back-stage copies did nothing.
    expect(r.events.filter((e) => e.kind === 'ability').map((e) => (e.kind === 'ability' ? e.card : ''))).toEqual([theirs]);
    // The winner drew nothing.
    expect(defsIn(r.state, 0, 'hand')).toEqual([]);
  });

  it('[ABL-03] "when a climax is played into your climax area": met by playing a climax; a climax name in the condition must match', () => {
    const play = (climax: string, clock: string) => {
      const s0 = climaxPhase({ stage: { 1: 'ACX', 2: 'ACN' }, hand: [climax], clock: [clock], deck: MARKED });
      return go(s0, playClimax(0, cardIn(s0, 0, 'hand', climax)));
    };

    // Yellow Dawn: only the unnamed condition is met.
    const dawn = play('YX', 'Y0');
    expect(upTo(trace(dawn.state, dawn.events), 'move:draw:B0:0.deck->0.hand')).toEqual([
      'action:PLAY_CLIMAX:0',
      'played:YX',
      'move:play:YX:0.hand->0.climax',
      'check',
      'ability:0:ACX#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
    ]);
    expect(only(trace(dawn.state, dawn.events), 'ability')).toEqual(['ability:0:ACX#0:automatic']);

    // Red Dusk: both conditions are met, so both abilities wait and the player picks the order.
    const dusk = play('RX', 'R0');
    expect(autoOptions(dusk.state)).toEqual(['0:ACX#0', '0:ACN#0']);
  });

  it('[ABL-03] being put on the stage by Encore or by the Standby icon is not "being played": the play condition is not met', () => {
    // Encore: ADR is reversed at the start of the Attack Phase; ending it sends ADR to the waiting room, and Encore brings it back.
    const e0 = attackPhase({ stage: { 1: { def: 'ADR', orientation: 'reverse' }, 2: 'Y0' }, stock: ['G0', 'G0', 'G0'] });
    const adr = idAt(e0, 0, 1);
    const encorePrompt = go(e0, pass(0));
    expect(encorePrompt.state.pending).toEqual({ kind: 'encore', player: 0, card: adr, slot: 1, cost: 3 });
    const encored = go(encorePrompt.state, accept(0));
    expect(only(trace(encored.state, encored.events), 'move:encore', 'ability')).toEqual(['move:encore:ADR:0.waiting->0.stage']);

    // Standby icon: the trigger check reveals it, and ADR comes from the waiting room onto the stage.
    const s0 = attackPhase({ stage: { 1: 'Y0' }, waiting: ['ADR'], deck: [...PLAIN, 'ASB'] });
    const waiting = cardIn(s0, 0, 'waiting', 'ADR');
    const icon = go(s0, attack(0, 1, 'direct'));
    expect(icon.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'standby', options: [waiting], optional: true });
    const placed = goAll(icon.state, choose(0, waiting), { type: 'CHOOSE_SLOT', player: 0, slot: 2 });
    expect(only(trace(placed.state, placed.events), 'move:icon', 'ability')).toEqual(['move:icon:ADR:0.waiting->0.stage']);
  });

  it('[ABL-03] the v1 language has only event triggers: an ability triggered by the start or end of a phase or step is rejected as data rather than accepted and never played', () => {
    const atPhase = { id: 'APH', name: 'Dawn Bell', kind: 'character', color: 'yellow', level: 0, cost: 0, power: 2000, soul: 1, abilities: [{ kind: 'automatic', trigger: { on: 'mainPhaseStart' }, effect: [draw1] }] };
    const problems = validateCatalog({ ...cat, APH: atPhase as unknown as CardDef });
    expect(problems.map((p) => [p.code, 'path' in p ? p.path : ''])).toEqual([['ABILITY_TRIGGER', 'abilities.0.trigger.on']]);
  });

  it('[ABL-03] a bracketed cost is offered while the ability resolves, after the check timing starts; only once it is paid does the ability count as played', () => {
    const s0 = mainPhase({ hand: ['ATL'], stock: ['G0'], deck: MARKED });
    const atl = cardIn(s0, 0, 'hand', 'ATL');

    const triggered = go(s0, playChar(0, atl, 1));
    expect(trace(triggered.state, triggered.events)).toEqual(['action:PLAY_CHARACTER:0', 'played:ATL', 'move:play:ATL:0.hand->0.stage', 'check']);
    expect(triggered.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: atl });
    expect(defsIn(triggered.state, 0, 'stock')).toEqual(['G0']);

    const paid = go(triggered.state, accept(0));
    expect(trace(paid.state, paid.events)).toEqual([
      'action:ACCEPT:0',
      'optional:0:payCost:true',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:ATL#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
    expect(defsIn(paid.state, 0, 'stock')).toEqual([]);
    expect(defsIn(paid.state, 0, 'hand')).toEqual(['B0']);
  });
});

// =============================================================================
// ABL-08: check timing order: rule actions, then one turn-player ability, repeat (CR 8.5.1, 8.7.3)
// =============================================================================

describe('ABL-08: in a check timing the turn player plays standby abilities first, one at a time, with rule actions in between', () => {
  it('[ABL-08] when both players have an ability waiting, the turn player\'s is played and resolved first, then the non-turn player\'s; swapping whose turn it is swaps the order', () => {
    for (const active of [0, 1] as const) {
      const opp: PlayerId = active === 0 ? 1 : 0;
      const zones: [ZoneSpec, ZoneSpec] = [{}, {}];
      // The turn player's top card (Y1) goes to the trigger check, so their ability draws B1. The other player's
      // top card (B0) is the attack's damage, so their ability draws R0.
      zones[active] = { stage: { 2: 'ARV' }, deck: [...PLAIN, 'B1', 'Y1'] };
      zones[opp] = { stage: { 2: 'ARV' }, deck: MARKED };
      // Turn 2 belongs to the player who did not go first, so "turn player" cannot be confused with "starting player".
      const s0 = makeState(cat, { start: 'attack', active, starting: opp, players: zones });
      expect([s0.active, s0.starting]).toEqual([active, opp]);
      // Equal power: both characters become reversed in the same battle.
      const r = goAll(s0, attack(active, 2, 'frontal'), pass(opp));
      const t = only(from(trace(r.state, r.events), 'battle:ARV,ARV'), 'battle', 'ability', 'effect', 'move:draw');
      expect(t.slice(0, 7)).toEqual([
        'battle:ARV,ARV',
        `ability:${active}:ARV#0:automatic`,
        `effect:${active}:draw`,
        `move:draw:B1:${active}.deck->${active}.hand`,
        `ability:${opp}:ARV#0:automatic`,
        `effect:${opp}:draw`,
        `move:draw:R0:${opp}.deck->${opp}.hand`,
      ]);
    }
  });

  it('[ABL-08] the rule actions are checked again after each ability: a character brought to 0 power by the first ability leaves before the second ability is played', () => {
    // ADN has two "when played" abilities; the turn player plays the power one first. P1 has 3 stock, so their Encore triggers.
    const s0 = mainPhase({ hand: ['ADN'], deck: MARKED }, { stage: { 1: 'Y0', 2: 'R0' }, stock: ['G0', 'G0', 'G0'] });
    const adn = cardIn(s0, 0, 'hand', 'ADN');
    const y0 = idAt(s0, 1, 1);

    const played = go(s0, playChar(0, adn, 1));
    expect(autoOptions(played.state)).toEqual(['0:ADN#0', '0:ADN#1']);
    expect(played.state.pending).toMatchObject({ kind: 'autoOrder', player: 0 });

    const r = go(played.state, orderAuto(0, optionFor(played.state, adn, 0)));
    expect(trace(r.state, r.events)).toEqual([
      'action:ORDER_AUTO:0',
      'ability:0:ADN#0:automatic',
      'effect:0:power',
      'mod:Y0:power-2000',
      'mod:R0:power-2000',
      // Rule actions come back before the next ability...
      'rule:insufficientPower:Y0',
      'move:ruleAction:Y0:1.stage->1.waiting',
      // ...and the turn player's remaining ability still goes before the non-turn player's new Encore.
      'ability:0:ADN#1:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
    ]);
    expect(r.state.pending).toEqual({ kind: 'encore', player: 1, card: y0, slot: 1, cost: 3 });
  });

  it('[ABL-08] the non-turn player chooses among their own waiting abilities; a turn-player ability triggered by one of them is played before their next one', () => {
    // P0 attacks with Y0 into ARX (equal power). ARX has two "when reversed" abilities: [0] puts the attacker into the
    // waiting room, [1] draws. P0 has 3 stock, so the attacker's Encore triggers when it leaves.
    const s0 = attackPhase({ stage: { 1: 'G0', 2: 'Y0' }, stock: ['G0', 'G0', 'G0'] }, { stage: { 2: 'ARX' }, deck: MARKED });
    const y0 = idAt(s0, 0, 2);
    const arx = idAt(s0, 1, 2);

    const battle = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    // The turn player has nothing waiting, so the non-turn player picks which of theirs goes first.
    expect(battle.state.pending).toMatchObject({ kind: 'autoOrder', player: 1 });
    expect(autoOptions(battle.state)).toEqual(['1:ARX#0', '1:ARX#1']);
    expect(attempt(battle.state, orderAuto(0, optionFor(battle.state, arx, 0)))).not.toBe('ok');

    const first = go(battle.state, orderAuto(1, optionFor(battle.state, arx, 0)));
    expect(trace(first.state, first.events)).toEqual(['action:ORDER_AUTO:1', 'ability:1:ARX#0:automatic', 'effect:1:sendToWaiting', 'move:effect:Y0:0.stage->0.waiting']);
    // The turn player's new Encore comes before ARX's other ability, which is still waiting.
    expect(first.state.pending).toEqual({ kind: 'encore', player: 0, card: y0, slot: 2, cost: 3 });
    expect(first.state.standby.map((a) => (a.ability === 'card' ? `${a.player}:${defOf(first.state, a.source.card)}#${a.index}` : a.ability))).toEqual(['1:ARX#1']);

    const declined = go(first.state, pass(0));
    expect(upTo(trace(declined.state, declined.events), 'move:draw:R0:1.deck->1.hand')).toEqual([
      'action:PASS:0',
      'ability:1:ARX#1:automatic',
      'effect:1:draw',
      'move:draw:R0:1.deck->1.hand',
    ]);
  });
});

// =============================================================================
// ABL-10: a met condition puts the ability in standby; standby is played only in a check timing (CR 8.7.1-8.7.2.1)
// =============================================================================

describe('ABL-10: every met trigger condition puts the ability into standby once, and standby abilities wait for a check timing', () => {
  it('[ABL-10] one event can meet several conditions: each ability enters standby, none is played before the check timing, and each is played exactly once', () => {
    // A climax with its own "when played" ability, and two copies of a character that watches for climaxes.
    const s0 = climaxPhase({ stage: { 1: 'ACX', 2: 'ACX' }, hand: ['AXP'], clock: ['Y0'], deck: MARKED });
    const [acx1, acx2] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const axp = cardIn(s0, 0, 'hand', 'AXP');

    const played = go(s0, playClimax(0, axp));
    expect(trace(played.state, played.events)).toEqual(['action:PLAY_CLIMAX:0', 'played:AXP', 'move:play:AXP:0.hand->0.climax', 'check']);
    expect(autoOptions(played.state)).toEqual(['0:AXP#0', '0:ACX#0', '0:ACX#0']);
    const p = played.state.pending;
    expect(p?.kind === 'autoOrder' ? p.options.map((a) => (a.ability === 'card' ? a.source.card : '')) : []).toEqual([axp, acx1, acx2]);
    expect(defsIn(played.state, 0, 'hand')).toEqual([]);

    const second = go(played.state, orderAuto(0, optionFor(played.state, acx2)));
    const done = go(second.state, orderAuto(0, optionFor(second.state, axp)));
    const sources = [...second.events, ...done.events].flatMap((e) => (e.kind === 'ability' ? [e.card] : []));
    expect(sources).toEqual([acx2, axp, acx1]);
    expect(defsIn(done.state, 0, 'hand')).toEqual(['B0', 'R0', 'Y1']);
    expect(done.state.standby).toEqual([]);
  });

  it('[ABL-10] each time the condition is met the ability enters standby again: played, returned to hand and played again, it resolves once per play', () => {
    const s0 = mainPhase({ hand: ['ADR'], stage: { 2: 'ARE' }, stock: ['G0'], deck: MARKED });
    const adr = cardIn(s0, 0, 'hand', 'ADR');

    const firstPlay = go(s0, playChar(0, adr, 1));
    expect(only(trace(firstPlay.state, firstPlay.events), 'ability', 'move:draw')).toEqual(['ability:0:ADR#0:automatic', 'move:draw:B0:0.deck->0.hand']);

    // ARE returns ADR to the hand (ADR is its only other character, so no choice is asked).
    const back = go(firstPlay.state, activate(0, idAt(firstPlay.state, 0, 2), 0));
    expect(only(trace(back.state, back.events), 'move:effect')).toEqual(['move:effect:ADR:0.stage->0.hand']);
    expect(only(trace(back.state, back.events), 'ability')).toEqual(['ability:0:ARE#0:activated']);

    const again = go(back.state, playChar(0, adr, 1));
    expect(only(trace(again.state, again.events), 'ability', 'move:draw')).toEqual(['ability:0:ADR#0:automatic', 'move:draw:R0:0.deck->0.hand']);
    expect(defsIn(again.state, 0, 'hand')).toEqual(['B0', 'R0']);
  });

  it('[ABL-10] a condition met in the middle of resolving an ability waits: the Encore of a character the ability sent away is played only in the check timing after it', () => {
    // AKE: [(1)] put this card into your waiting room, then you may draw. 4 stock: 1 for the cost, 3 left for Encore.
    const s0 = mainPhase({ stage: { 1: 'AKE' }, stock: ['G0', 'G0', 'G0', 'G0'], deck: MARKED });
    const ake = idAt(s0, 0, 1);

    const mid = go(s0, activate(0, ake, 0));
    expect(trace(mid.state, mid.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:AKE#0:activated',
      'effect:0:sendToWaiting',
      'move:effect:AKE:0.stage->0.waiting',
      'effect:0:may',
    ]);
    // The card is gone and the Encore could be paid, but the ability is still resolving: no Encore yet.
    expect(mid.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'may', card: ake });
    expect(defsIn(mid.state, 0, 'stock')).toHaveLength(3);

    const end = go(mid.state, accept(0));
    expect(trace(end.state, end.events)).toEqual(['action:ACCEPT:0', 'optional:0:may:true', 'effect:0:draw', 'move:draw:B0:0.deck->0.hand', 'check']);
    expect(end.state.pending).toEqual({ kind: 'encore', player: 0, card: ake, slot: 1, cost: 3 });
  });
});

// =============================================================================
// ABL-11: standby abilities cannot be skipped; their master picks the order (CR 8.7.3, 8.7.3.1)
// =============================================================================

describe('ABL-11: every standby ability must be played, in the order its master chooses', () => {
  it('[ABL-11] with two abilities waiting the player must pick one of them (no pass); the other then follows without asking, and the order chosen decides the result', () => {
    const run = (first: 0 | 1) => {
      const s0 = mainPhase({ hand: ['ATW'], deck: MARKED });
      const atw = cardIn(s0, 0, 'hand', 'ATW');
      const played = go(s0, playChar(0, atw, 1));
      expect(autoOptions(played.state)).toEqual(['0:ATW#0', '0:ATW#1']);
      const p = played.state.pending;
      const ids = p?.kind === 'autoOrder' ? p.options.map((a) => a.id) : [];
      // Only the two abilities are offered; declining is not an option.
      expect(offers(played.state)).toEqual(ids.map((id) => `ORDER_AUTO:${id}`).sort());
      expect(attempt(played.state, pass(0))).not.toBe('ok');

      const r = go(played.state, orderAuto(0, optionFor(played.state, atw, first)));
      expect(r.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
      return { t: only(trace(r.state, r.events), 'ability', 'move:'), state: r.state };
    };

    // [0] (deck top to stock) first: B0 goes to stock, then R0 is drawn.
    const a = run(0);
    expect(a.t).toEqual(['ability:0:ATW#0:automatic', 'move:effect:B0:0.deck->0.stock', 'ability:0:ATW#1:automatic', 'move:draw:R0:0.deck->0.hand']);
    expect([defsIn(a.state, 0, 'hand'), defsIn(a.state, 0, 'stock')]).toEqual([['R0'], ['B0']]);

    // [1] (draw) first: B0 is drawn, then R0 goes to stock.
    const b = run(1);
    expect(b.t).toEqual(['ability:0:ATW#1:automatic', 'move:draw:B0:0.deck->0.hand', 'ability:0:ATW#0:automatic', 'move:effect:R0:0.deck->0.stock']);
    expect([defsIn(b.state, 0, 'hand'), defsIn(b.state, 0, 'stock')]).toEqual([['B0'], ['R0']]);
  });

  it('[ABL-11] the same ability waiting three times (three copies, one climax): the master orders them one pick at a time, never with a way to skip, and all three resolve', () => {
    const s0 = climaxPhase({ stage: { 1: 'ACX', 2: 'ACX', 3: 'ACX' }, hand: ['YX'], clock: ['Y0'], deck: MARKED });
    const [c1, c2, c3] = [idAt(s0, 0, 1), idAt(s0, 0, 2), idAt(s0, 0, 3)];

    const played = go(s0, playClimax(0, cardIn(s0, 0, 'hand', 'YX')));
    expect(autoOptions(played.state)).toEqual(['0:ACX#0', '0:ACX#0', '0:ACX#0']);
    expect(offers(played.state).every((x) => x.startsWith('ORDER_AUTO:'))).toBe(true);
    expect(offers(played.state)).toHaveLength(3);

    const one = go(played.state, orderAuto(0, optionFor(played.state, c3)));
    // Still two waiting: asked again, still no way to skip.
    expect(autoOptions(one.state)).toEqual(['0:ACX#0', '0:ACX#0']);
    expect(offers(one.state)).toHaveLength(2);
    expect(attempt(one.state, pass(0))).not.toBe('ok');

    const all = go(one.state, orderAuto(0, optionFor(one.state, c1)));
    const sources = [...one.events, ...all.events].flatMap((e) => (e.kind === 'ability' ? [e.card] : []));
    expect(sources).toEqual([c3, c1, c2]);
    expect(defsIn(all.state, 0, 'hand')).toEqual(['B0', 'R0', 'Y1']);
    expect(all.state.standby).toEqual([]);
  });

  it('[ABL-11] an ability that cannot be played yet stays waiting: an Encore short of stock is offered once another waiting ability has added the stock', () => {
    // AST is played onto Y0's position; the rule action sends Y0 away (Encore needs 3 stock, there are 2).
    const s0 = mainPhase({ stage: { 1: 'Y0' }, hand: ['AST'], stock: ['G0', 'G0'], deck: MARKED });
    const y0 = idAt(s0, 0, 1);
    const ast = cardIn(s0, 0, 'hand', 'AST');

    const r = go(s0, playChar(0, ast, 1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:AST',
      'move:play:AST:0.hand->0.stage',
      'check',
      'rule:extraCards:Y0',
      'move:ruleAction:Y0:0.stage->0.waiting',
      'ability:0:AST#0:automatic',
      'effect:0:stockFromDeck',
      'move:effect:B0:0.deck->0.stock',
    ]);
    expect(r.state.pending).toEqual({ kind: 'encore', player: 0, card: y0, slot: 1, cost: 3 });

    // Paying it really works: Y0 comes back rested (and the older AST on that position leaves by rule action).
    const paid = go(r.state, accept(0));
    expect(only(trace(paid.state, paid.events), 'move:', 'auto', 'rule')).toEqual([
      'move:cost:B0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'move:cost:G0:0.stock->0.waiting',
      'auto:0:encore:Y0',
      'move:encore:Y0:0.waiting->0.stage',
      'rule:extraCards:AST',
      'move:ruleAction:AST:0.stage->0.waiting',
    ]);
    expect(stageDefs(paid.state, 0)[0]).toBe('Y0(rest)');

    // Without a stock-adding ability the same Encore cannot be played, and it is used up without a prompt.
    const plain = mainPhase({ stage: { 1: 'Y0' }, hand: ['Y0b'], stock: ['G0', 'G0'], deck: MARKED });
    const lost = go(plain, playChar(0, cardIn(plain, 0, 'hand', 'Y0b'), 1));
    expect(lost.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(lost.state.standby).toEqual([]);
    expect(defsIn(lost.state, 0, 'waiting')).toEqual(['Y0']);
  });
});

// =============================================================================
// ABL-12: when a standby instance is used up (CR 8.7.3, 8.7.3.2, 8.7.3.2.1)
// =============================================================================

describe('ABL-12: one standby instance is used up when it resolves, cannot be played, or its cost is declined', () => {
  it('[ABL-12] once resolved, the instance is gone: later check timings do not play the ability again', () => {
    const s0 = mainPhase({ hand: ['ADR'], deck: MARKED });
    const r = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'ADR'), 1));
    expect(only(trace(r.state, r.events), 'ability')).toEqual(['ability:0:ADR#0:automatic']);
    expect(r.state.standby).toEqual([]);

    // On to the Climax Phase and its check timings: nothing is played again.
    const later = go(r.state, pass(0));
    expect(only(trace(later.state, later.events), 'check')).not.toEqual([]);
    expect(only(trace(later.state, later.events), 'ability', 'move:draw')).toEqual([]);
    expect(later.state.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    expect(defsIn(later.state, 0, 'hand')).toEqual(['B0']);
  });

  it('[ABL-12] declining the optional cost uses the instance up: nothing is paid, the ability is not played, and it is not offered again', () => {
    const s0 = mainPhase({ hand: ['ATL'], stock: ['G0'], deck: MARKED });
    const atl = cardIn(s0, 0, 'hand', 'ATL');
    const asked = go(s0, playChar(0, atl, 1));
    expect(asked.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: atl });

    const no = go(asked.state, pass(0));
    expect(trace(no.state, no.events)).toEqual(['action:PASS:0', 'optional:0:payCost:false', 'playTiming:0:main']);
    expect(no.state.standby).toEqual([]);
    expect(defsIn(no.state, 0, 'stock')).toEqual(['G0']);
    expect(defsIn(no.state, 0, 'hand')).toEqual([]);

    const later = go(no.state, pass(0));
    expect(only(trace(later.state, later.events), 'optional', 'ability')).toEqual([]);
    expect(later.state.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
  });

  it('[ABL-12] an ability that cannot be played (its cost cannot be paid) is used up without a prompt, and stock arriving later does not bring it back', () => {
    const s0 = mainPhase({ hand: ['ATL', 'AST'], stock: [], deck: MARKED });
    const lapsed = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'ATL'), 1));
    expect(trace(lapsed.state, lapsed.events)).toEqual(['action:PLAY_CHARACTER:0', 'played:ATL', 'move:play:ATL:0.hand->0.stage', 'check', 'lapsed:0:ATL#0', 'playTiming:0:main']);
    expect(lapsed.state.standby).toEqual([]);

    // AST puts a card into stock; ATL's cost could be paid now, but its instance is gone.
    const later = go(lapsed.state, playChar(0, cardIn(lapsed.state, 0, 'hand', 'AST'), 2));
    expect(only(trace(later.state, later.events), 'ability', 'optional', 'lapsed')).toEqual(['ability:0:AST#0:automatic']);
    expect(later.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(defsIn(later.state, 0, 'stock')).toEqual(['B0']);
  });

  it('[ABL-12] an ability that cannot be played because its card left the stage (a "rest this card" cost) is used up without a prompt', () => {
    // AZC has 0 power: the rule action removes it before its "when played" ability comes up, so it cannot rest itself.
    const s0 = mainPhase({ hand: ['AZC'], deck: MARKED });
    const r = go(s0, playChar(0, cardIn(s0, 0, 'hand', 'AZC'), 1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:AZC',
      'move:play:AZC:0.hand->0.stage',
      'check',
      'rule:insufficientPower:AZC',
      'move:ruleAction:AZC:0.stage->0.waiting',
      'lapsed:0:AZC#0',
      'playTiming:0:main',
    ]);
    expect(r.state.standby).toEqual([]);
    expect(defsIn(r.state, 0, 'hand')).toEqual([]);
  });

  it('[ABL-12] declining an Encore uses it up: the card stays in the waiting room and the Encore is not offered again, though the stock is still there', () => {
    const s0 = mainPhase({ hand: ['Z0'], stock: ['G0', 'G0', 'G0'], deck: MARKED });
    const z0 = cardIn(s0, 0, 'hand', 'Z0');
    const asked = go(s0, playChar(0, z0, 1));
    expect(asked.state.pending).toEqual({ kind: 'encore', player: 0, card: z0, slot: 1, cost: 3 });

    const no = go(asked.state, pass(0));
    expect(no.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(no.state.standby).toEqual([]);
    expect(defsIn(no.state, 0, 'waiting')).toEqual(['Z0']);

    const later = go(no.state, pass(0));
    expect(later.state.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    expect(defsIn(later.state, 0, 'stock')).toEqual(['G0', 'G0', 'G0']);
  });

  it('[ABL-12] only one instance goes: with the same costed ability waiting twice, declining the first cost still leaves the second to be offered and paid', () => {
    const s0 = climaxPhase({ stage: { 1: 'ACC', 2: 'ACC' }, hand: ['YX'], clock: ['Y0'], stock: ['G0', 'R0'], deck: MARKED });
    const [c1, c2] = [idAt(s0, 0, 1), idAt(s0, 0, 2)];
    const played = go(s0, playClimax(0, cardIn(s0, 0, 'hand', 'YX')));
    expect(autoOptions(played.state)).toEqual(['0:ACC#0', '0:ACC#0']);

    const firstAsked = go(played.state, orderAuto(0, optionFor(played.state, c1)));
    expect(firstAsked.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: c1 });

    const declined = go(firstAsked.state, pass(0));
    expect(trace(declined.state, declined.events)).toEqual(['action:PASS:0', 'optional:0:payCost:false']);
    expect(declined.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: c2 });
    expect(defsIn(declined.state, 0, 'stock')).toEqual(['G0', 'R0']);

    const paid = go(declined.state, accept(0));
    expect(upTo(trace(paid.state, paid.events), 'move:draw:B0:0.deck->0.hand')).toEqual([
      'action:ACCEPT:0',
      'optional:0:payCost:true',
      'move:cost:R0:0.stock->0.waiting',
      'ability:0:ACC#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
    ]);
    expect(paid.events.flatMap((e) => (e.kind === 'ability' ? [e.card] : []))).toEqual([c2]);
    expect(defsIn(paid.state, 0, 'stock')).toEqual(['G0']);
  });
});

// =============================================================================
// ABL-16: a standby ability is still played after its card moved; what it can no longer do fails (CR 8.7.7)
// =============================================================================

describe('ABL-16: the card leaving its zone does not cancel its standby ability', () => {
  it('[ABL-16] a "when played" ability whose card the rule actions already removed is still played: the draw happens, "this card gets +1000" does nothing', () => {
    // AZR has 0 power, so the check timing's rule action sends it away before its ability comes up. No stock, so no Encore.
    const s0 = mainPhase({ hand: ['AZR'], deck: MARKED });
    const azr = cardIn(s0, 0, 'hand', 'AZR');
    const r = go(s0, playChar(0, azr, 1));
    expect(trace(r.state, r.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:AZR',
      'move:play:AZR:0.hand->0.stage',
      'check',
      'rule:insufficientPower:AZR',
      'move:ruleAction:AZR:0.stage->0.waiting',
      'ability:0:AZR#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
      // The power step runs but finds no card on the stage to change: no modifier.
      'effect:0:power',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B0']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['AZR']);
    expect(r.state.effects).toEqual([]);
  });

  it('[ABL-16] a cost that does not need the moved card can still be paid: the stock cost is offered after the card has left, and the ability resolves', () => {
    // AZT has 0 power and [(1)]: the rule action removes it first; its ability is still offered and played.
    const s0 = mainPhase({ hand: ['AZT'], stock: ['G0'], deck: MARKED });
    const azt = cardIn(s0, 0, 'hand', 'AZT');
    const asked = go(s0, playChar(0, azt, 1));
    expect(only(trace(asked.state, asked.events), 'rule', 'move:ruleAction', 'lapsed')).toEqual(['rule:insufficientPower:AZT', 'move:ruleAction:AZT:0.stage->0.waiting']);
    expect(asked.state.pending).toEqual({ kind: 'optional', player: 0, purpose: 'payCost', card: azt });

    const paid = go(asked.state, accept(0));
    expect(trace(paid.state, paid.events)).toEqual([
      'action:ACCEPT:0',
      'optional:0:payCost:true',
      'move:cost:G0:0.stock->0.waiting',
      'ability:0:AZT#0:automatic',
      'effect:0:draw',
      'move:draw:B0:0.deck->0.hand',
      'playTiming:0:main',
    ]);
  });

  it('[ABL-16] a "when reversed" ability whose card was sent to the waiting room by an earlier ability is still played: the draw works, returning "this card" to hand fails', () => {
    // Equal power: ARS (P0, turn player) and ARH (P1) are both reversed. ARS goes first and sends the defender ARH away.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'ARS' } }, { stage: { 2: 'ARH' }, deck: MARKED });
    const arh = idAt(s0, 1, 2);
    const r = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    const t = from(trace(r.state, r.events), 'battle:ARS,ARH');
    expect(upTo(t, 'effect:1:returnToHand')).toEqual([
      'battle:ARS,ARH',
      'check',
      'ability:0:ARS#0:automatic',
      'effect:0:sendToWaiting',
      'move:effect:ARH:1.stage->1.waiting',
      'ability:1:ARH#0:automatic',
      'effect:1:draw',
      'move:draw:R0:1.deck->1.hand',
      'effect:1:returnToHand',
    ]);
    // ARH never moved again: it is still in P1's waiting room, and the only card P1 drew is R0.
    expect(only(t, 'move:effect:ARH', 'move:effect')).toEqual(['move:effect:ARH:1.stage->1.waiting']);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['ARH']);
    expect(defsIn(r.state, 1, 'hand')).toEqual(['R0']);
    expect(r.state.players[1].hand).not.toContain(arh);
  });
});

// =============================================================================
// CONC-09: the master of an automatic or continuous ability is the master of its card (CR 4.3.5, 4.3.6)
// =============================================================================

describe('CONC-09: an automatic or continuous ability belongs to the master of the card that has it', () => {
  it('[CONC-09] in P0\'s turn, P1\'s character\'s automatic ability is P1\'s: P1 pays and chooses, "your characters" are P1\'s, "your opponent" is P0', () => {
    // AMS: [(1)] when reversed, you may pay; choose 1 of your characters, it gets +1000; your opponent draws.
    const s0 = attackPhase({ stage: { 1: 'G0', 2: 'Y0' }, stock: ['G0'], deck: [...PLAIN, 'B1', 'Y1'] }, { stage: { 2: 'AMS', 4: 'Y0' }, stock: ['R0'], deck: MARKED });
    const ams = idAt(s0, 1, 2);
    const theirY0 = idAt(s0, 1, 4);

    const asked = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    expect(asked.state.pending).toEqual({ kind: 'optional', player: 1, purpose: 'payCost', card: ams });
    expect(attempt(asked.state, accept(0))).not.toBe('ok');

    const pay = go(asked.state, accept(1));
    expect(only(trace(pay.state, pay.events), 'move:cost', 'ability')).toEqual(['move:cost:R0:1.stock->1.waiting', 'ability:1:AMS#0:automatic']);
    expect(pay.state.pending).toMatchObject({ kind: 'pick', player: 1, purpose: 'target', card: ams, options: [ams, theirY0], min: 1, max: 1 });
    expect(defsIn(pay.state, 0, 'stock')).toEqual(['G0', 'Y1']);

    const done = go(pay.state, choose(1, theirY0));
    expect(upTo(trace(done.state, done.events), 'move:draw:B1:0.deck->0.hand')).toEqual([
      'action:CHOOSE_CARD:1',
      'chosen:1:Y0',
      'effect:1:power',
      'mod:Y0:power+1000',
      'effect:1:draw',
      'move:draw:B1:0.deck->0.hand',
    ]);
    expect(currentPower(done.state, cat, theirY0)).toBe(3000);
  });

  it('[CONC-09] a continuous ability works for its card\'s master in either player\'s turn: "your other characters" and "your opponent\'s characters" follow the card, not the turn', () => {
    const powers = (aco: PlayerId, active: PlayerId) => {
      const zones: [ZoneSpec, ZoneSpec] = [{ stage: { 2: 'Y0', 3: 'R0' } }, { stage: { 2: 'Y0', 3: 'R0' } }];
      zones[aco] = { stage: { 1: 'ACO', 2: 'Y0', 3: 'R0' } };
      const s = makeState(cat, { start: 'main', active, players: [{ deck: PLAIN, ...zones[0] }, { deck: PLAIN, ...zones[1] }] });
      const p = (player: PlayerId) => s.players[player].stage.flatMap((cards) => cards.map((c) => `${defOf(s, c.id)}=${currentPower(s, cat, c.id)}`));
      return { p0: p(0), p1: p(1) };
    };
    // P1 has ACO: P1's Y0 and R0 get +1000 (ACO itself does not), P0's get -500 — in P0's turn and in P1's.
    for (const active of [0, 1] as const) {
      expect(powers(1, active)).toEqual({ p0: ['Y0=1500', 'R0=2500'], p1: ['ACO=2000', 'Y0=3000', 'R0=4000'] });
    }
    // P0 has it: the other way round.
    expect(powers(0, 1)).toEqual({ p0: ['ACO=2000', 'Y0=3000', 'R0=4000'], p1: ['Y0=1500', 'R0=2500'] });
  });

  it('[CONC-09] a climax\'s continuous ability belongs to the master of the climax area it is in: "your characters" are that player\'s only', () => {
    for (const owner of [0, 1] as const) {
      const zones: [ZoneSpec, ZoneSpec] = [{ stage: { 1: 'Y0', 2: 'Y3' } }, { stage: { 1: 'Y0', 2: 'Y3' } }];
      zones[owner] = { ...zones[owner], climax: ['AXC'] };
      const s = makeState(cat, { start: 'main', players: [{ deck: PLAIN, ...zones[0] }, { deck: PLAIN, ...zones[1] }] });
      const souls = (player: PlayerId) => [currentSoul(s, cat, idAt(s, player, 1)), currentSoul(s, cat, idAt(s, player, 2))];
      expect({ owner, p0: souls(0), p1: souls(1) }).toEqual(owner === 0 ? { owner, p0: [2, 3], p1: [1, 2] } : { owner, p0: [1, 2], p1: [2, 3] });
    }
  });

  it('[CONC-09] "your climax area" in an automatic ability is its card\'s master\'s: P0\'s climax sets off P0\'s watcher, not the same card on P1\'s stage', () => {
    const s0 = climaxPhase({ stage: { 1: 'ACX' }, hand: ['YX'], clock: ['Y0'], deck: MARKED }, { stage: { 1: 'ACX' } });
    const mine = idAt(s0, 0, 1);
    const r = go(s0, playClimax(0, cardIn(s0, 0, 'hand', 'YX')));
    expect(r.events.flatMap((e) => (e.kind === 'ability' ? [`${e.player}:${e.card}`] : []))).toEqual([`0:${mine}`]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B0']);
    expect(defsIn(r.state, 1, 'hand')).toEqual([]);
  });
});

// =============================================================================
// DMG-07: damage from an ability or event has that card as its source (CR 4.11.1.2)
// =============================================================================

describe('DMG-07: the source of damage dealt by an ability or event is the card', () => {
  it('[DMG-07] damage from an automatic ability has the card with the ability as its source, whether it sticks or is canceled', () => {
    for (const [top, last] of [['G0', 'taken'], ['YX', 'canceled']] as const) {
      const s0 = mainPhase({ hand: ['ADM'] }, { deck: [...PLAIN, top] });
      const adm = cardIn(s0, 0, 'hand', 'ADM');
      const r = go(s0, playChar(0, adm, 1));
      const t = trace(r.state, r.events);
      expect(only(t, 'ability', 'damage', 'taken', 'canceled')).toEqual(['ability:0:ADM#0:automatic', 'damage:1:1:from:ADM', `${last}:1:from:ADM`]);
      const sources = r.events.flatMap((e) => (e.kind === 'damage' || e.kind === 'damageTaken' || e.kind === 'damageCanceled' ? [e.source] : []));
      expect(sources).toEqual([adm, adm]);
    }
  });

  it('[DMG-07] damage from an event card has the event card as its source; damage from an activated ability has the character as its source', () => {
    const ev0 = mainPhase({ hand: ['AEV'] });
    const aev = cardIn(ev0, 0, 'hand', 'AEV');
    const ev = go(ev0, { type: 'PLAY_EVENT', player: 0, card: aev });
    expect(only(trace(ev.state, ev.events), 'move:play', 'damage', 'taken', 'move:eventResolved')).toEqual([
      'move:play:AEV:0.hand->0.resolution',
      'damage:1:1:from:AEV',
      'taken:1:from:AEV',
      'move:eventResolved:AEV:0.resolution->0.waiting',
    ]);
    expect(ev.events.flatMap((e) => (e.kind === 'damage' ? [e.source] : []))).toEqual([aev]);

    const act0 = mainPhase({ stage: { 1: 'AAC' }, stock: ['G0'] });
    const aac = idAt(act0, 0, 1);
    const act = go(act0, activate(0, aac, 0));
    expect(act.events.flatMap((e) => (e.kind === 'damage' || e.kind === 'damageTaken' ? [e.source] : []))).toEqual([aac, aac]);
  });

  it('[DMG-07] damage from the attacking character\'s own ability is damage dealt by that character: canceled, it sets off that character\'s Shot', () => {
    // ALN has 0 soul, so its Damage Step deals no damage and its Shot (from the trigger check) is still watching.
    // In the battle it is reversed; its own ability deals 1 damage, which the climax on top of P1's deck cancels.
    const s0 = attackPhase({ stage: { 1: 'Y0', 2: 'ALN' }, deck: [...PLAIN, 'ASH'] }, { stage: { 2: 'Y0' }, deck: [...PLAIN, 'B0', 'YX'] });
    const r = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    expect(only(from(trace(r.state, r.events), 'step:trigger'), 'step:', 'icon', 'battle', 'ability', 'damage', 'canceled', 'taken', 'auto')).toEqual([
      'step:trigger',
      'icon:shot',
      'step:counter',
      'step:damage',
      'step:battle',
      'battle:ALN,Y0',
      'ability:0:ALN#0:automatic',
      'damage:1:1:from:ALN',
      'canceled:1:from:ALN',
      'auto:0:shot:ALN',
      'damage:1:1:from:-',
      'taken:1:from:-',
      'step:declaration',
    ]);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['B0']);
  });

  it('[DMG-07] during an attack, damage from the defending character\'s ability is the defender\'s, not the attacker\'s: canceled, it does not set off the attacker\'s Shot', () => {
    // AHV (0 soul, 5000) attacks ARD and gets a Shot it does not use in the Damage Step. ARD is reversed and deals
    // 1 damage to P0; the climax under P0's trigger card cancels it.
    const s0 = attackPhase({ stage: { 1: 'G0', 2: 'AHV' }, deck: [...PLAIN, 'YX', 'ASH'] }, { stage: { 2: 'ARD' } });
    const ahv = idAt(s0, 0, 2);
    const ard = idAt(s0, 1, 2);
    const r = goAll(s0, attack(0, 2, 'frontal'), pass(1));
    expect(only(from(trace(r.state, r.events), 'step:trigger'), 'icon', 'battle', 'ability', 'damage', 'canceled', 'taken', 'auto', 'step:declaration')).toEqual([
      'icon:shot',
      'battle:ARD',
      'ability:1:ARD#0:automatic',
      'damage:0:1:from:ARD',
      'canceled:0:from:ARD',
      'step:declaration',
    ]);
    expect(r.events.flatMap((e) => (e.kind === 'damage' ? [e.source] : []))).toEqual([ard]);
    // The attacker's Shot is still waiting for damage dealt by the attacker.
    expect(r.state.watchers).toEqual([{ player: 0, source: { card: ahv, epoch: r.state.cards[ahv]?.epoch } }]);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[DMG-07] damage from another card\'s ability is not dealt by the attacking character: canceled, it does not set off that character\'s Shot', () => {
    // AHV (0 soul) attacks first and gets a Shot it never uses. AAD then attacks; its "when this attacks" damage is
    // AAD's, so its cancel does not set off AHV's Shot.
    const s0 = attackPhase({ stage: { 1: 'AHV', 2: 'AAD' }, deck: [...PLAIN, 'G0', 'ASH'] }, { stage: { 3: 'Y0' }, deck: [...PLAIN, 'YX'] });
    const ahv = idAt(s0, 0, 1);
    const first = goAll(s0, attack(0, 1, 'frontal'), pass(1));
    expect(only(trace(first.state, first.events), 'icon', 'damage', 'battle')).toEqual(['icon:shot', 'battle:Y0']);
    expect(first.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(first.state.watchers).toEqual([{ player: 0, source: { card: ahv, epoch: first.state.cards[ahv]?.epoch } }]);

    const second = go(first.state, attack(0, 2, 'direct'));
    const t = trace(second.state, second.events);
    expect(only(upTo(t, 'step:encore'), 'ability', 'damage', 'canceled', 'taken', 'auto')).toEqual([
      'ability:0:AAD#0:automatic',
      'damage:1:1:from:AAD',
      'canceled:1:from:AAD',
      'damage:1:2:from:AAD',
      'taken:1:from:AAD',
    ]);
  });
});
