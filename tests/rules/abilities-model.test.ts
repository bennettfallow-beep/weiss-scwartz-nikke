// Rule tests for M3a: what abilities and effects are (CR 4.1), the three
// ability categories and the effect categories (CR 8.1, 8.2, 8.6.1, 8.8), and
// how card text points at cards and zones: names in quotes (CR 2.1.2),
// "character" and "climax" with no zone named (CR 2.3.2.1.2, 2.3.2.3.2-3),
// traits (CR 2.5) and the zones where card text works (CR 2.12).
// Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import {
  ABILITY_KINDS,
  abilityText,
  applyAction,
  cardText,
  checkCardAbilities,
  conditionText,
  currentPower,
  currentSoul,
  DURATIONS,
  legalActions,
  locate,
  stateHash,
  validate,
  validateCatalog,
} from '../../src/engine';
import type { Ability, Action, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Step } from '../../src/engine';
import { cardIn, defsIn, makeState } from '../../src/engine/testkit';
import type { ScenarioSpec, ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const unit = (id: string, name: string, more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 2000,
  soul: 1,
  ...more,
});
const event = (id: string, name: string, effect: Step[]): CardDef => ({ id, name, kind: 'event', color: 'yellow', level: 0, cost: 0, effect });
const climax = (id: string, name: string, more: Partial<CardDef> = {}): CardDef => ({ id, name, kind: 'climax', color: 'yellow', ...more });

const draw1: Step = { do: 'draw', count: 1 };
const stock1: Step = { do: 'stockFromDeck', count: 1 };
const payStock1 = [{ pay: 'stock', count: 1 }] as const;

/** One ability of each category on one card. */
const TRIAD: Ability[] = [
  { kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: 'this' }] },
  { kind: 'automatic', trigger: { on: 'play' }, effect: [draw1] },
  { kind: 'activated', timing: 'main', cost: payStock1, effect: [{ do: 'soul', amount: 1, target: 'this' }] },
];

const extra: CardDef[] = [
  unit('TRI', 'Triad Lookout', { power: 3000, abilities: TRIAD }),
  unit('ACT', 'Signal Keeper', { abilities: [{ kind: 'activated', timing: 'main', cost: [{ pay: 'stock', count: 1 }, { pay: 'rest' }], effect: [draw1] }] }),
  unit('PICK', 'Pathfinder', {
    abilities: [
      {
        kind: 'activated',
        timing: 'main',
        cost: payStock1,
        effect: [
          { do: 'choose', as: 't', count: 1, what: { side: 'you' } },
          { do: 'power', amount: 1000, target: { ref: 't' } },
        ],
      },
    ],
  }),
  unit('CNT', 'Shield Warden', {
    color: 'red',
    power: 3000,
    abilities: [{ kind: 'activated', timing: 'counter', cost: payStock1, effect: [{ do: 'power', amount: 2000, target: 'this' }] }],
  }),
  unit('PAIR', 'Twin Courier', { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [draw1, { do: 'power', amount: 1500, target: 'this' }] }] }),
  unit('AURA', 'Rally Banner', { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', other: true } }] }] }),
  unit('WDRAW', 'Dawn Watcher', { abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [draw1] }] }),
  unit('WSTOCK', 'Dusk Watcher', { abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed' }, effect: [stock1] }] }),
  event('EVDRAW', 'Quick Dispatch', [draw1]),
  unit('ONCE', 'Supply Clerk', { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [stock1] }] }),
  unit('BOOST', 'Surge Pilot', { abilities: [{ kind: 'activated', timing: 'main', cost: payStock1, effect: [{ do: 'power', amount: 2000, target: 'this' }] }] }),
  unit('BOOSTG', 'Anchor Pilot', {
    abilities: [{ kind: 'activated', timing: 'main', cost: payStock1, effect: [{ do: 'power', amount: 1000, target: 'this', duration: 'game' }] }],
  }),
  // Names in quotes (CARD-03). YX in the shared catalog is also named "Yellow Dawn".
  unit('NAMEW', 'Dawn Herald', { abilities: [{ kind: 'automatic', trigger: { on: 'climaxPlayed', name: 'Yellow Dawn' }, effect: [draw1] }] }),
  climax('YXB', 'Yellow Dawn'),
  climax('YXS', 'Yellow Dawn Rising'),
  climax('YXP', 'Yellow Daw'),
  climax('YXU', 'YELLOW DAWN'),
  unit('Y0X', 'Yellow Scout Elite'),
  unit('Y0L', 'yellow scout'),
  event('EVNAME', 'Roll Call', [
    { do: 'choose', as: 'x', count: 1, what: { side: 'you', name: 'Yellow Scout' } },
    { do: 'power', amount: 1000, target: { ref: 'x' } },
  ]),
  event('EVCXN', 'Sunrise Check', [{ do: 'if', when: [{ if: 'climax', name: 'Yellow Dawn' }], then: [draw1], else: [stock1] }]),
  // "Character" with no zone (CARD-07).
  event('EVPICK', 'Muster', [
    { do: 'choose', as: 'x', count: 1, what: { side: 'you' } },
    { do: 'power', amount: 1000, target: { ref: 'x' } },
  ]),
  event('EVALL', 'Rally Cry', [{ do: 'power', amount: 1000, target: { all: { side: 'you' } } }]),
  event('EVCOUNT', 'Headcount', [{ do: 'if', when: [{ if: 'count', what: { side: 'you' }, min: 2 }], then: [draw1], else: [stock1] }]),
  // "Climax" with no zone (CARD-08).
  event('EVCX', 'Climax Check', [{ do: 'if', when: [{ if: 'climax' }], then: [draw1], else: [stock1] }]),
  event('EVCXC', 'Climax Tally', [{ do: 'if', when: [{ if: 'count', what: { side: 'you', kind: 'climax' }, min: 1 }], then: [draw1], else: [stock1] }]),
  event('EVCXW', 'Spent Tally', [
    { do: 'if', when: [{ if: 'count', what: { side: 'you', kind: 'climax', zone: 'waiting' }, min: 1 }], then: [draw1], else: [stock1] },
  ]),
  // Traits (CARD-10).
  unit('SQ1', 'Night Sentry', { traits: ['Squad'] }),
  unit('SQ2', 'Night Lancer', { traits: ['Night', 'Squad'] }),
  unit('SQR', 'Iron Drill', { traits: ['Squadron'] }),
  unit('SQC', 'Night Cadet', { traits: ['squad'] }),
  unit('NT', 'Lone Walker'),
  unit('SQL', 'Squad Leader', { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 1000, target: { side: 'you', trait: 'Squad' } }] }] }),
  // Where card text works (CARD-19).
  climax('CXAURA', 'Bright Chorus', { abilities: [{ kind: 'continuous', modifiers: [{ stat: 'soul', amount: 1, target: { side: 'you' } }] }] }),
  climax('CXDRAW', 'Morning Bell', { abilities: [{ kind: 'automatic', trigger: { on: 'play' }, effect: [draw1] }] }),
  unit('BKH', 'Steady Guard', { color: 'red', backup: { power: 2000, level: 0, stock: 0 } }),
  // An ability that comes from an effect (CONC-01): the shot icon.
  climax('SHOTX', 'Echo Burst', { triggers: ['shot'] }),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

/** A card definition from the test catalog (throws if missing, so tests read cleanly). */
function def(id: string): CardDef {
  const d = cat[id];
  if (!d) throw new Error(`no card ${id}`);
  return d;
}

// --- Helpers -----------------------------------------------------------------

/** Plain cards: no icons, no climaxes, so nothing triggers or cancels by accident. */
const FILL = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

function scenario(start: ScenarioSpec['start'], p0: ZoneSpec, p1: ZoneSpec = {}, c: CardCatalog = cat): GameState {
  return makeState(c, { start, players: [{ deck: FILL, ...p0 }, { deck: FILL, ...p1 }] });
}
const mainPhase = (p0: ZoneSpec, p1: ZoneSpec = {}) => scenario('main', p0, p1);
const climaxPhase = (p0: ZoneSpec, p1: ZoneSpec = {}) => scenario('climax', p0, p1);
const attackPhase = (p0: ZoneSpec, p1: ZoneSpec = {}) => scenario('attack', p0, p1);

interface Ran {
  state: GameState;
  events: GameEvent[];
}

/** Applies one action and throws with the engine's reason if it is refused. */
function go(s: GameState, action: Action, c: CardCatalog = cat): Ran {
  const r = applyAction(s, c, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** The error code validate gives, or 'ok'. */
function attempt(s: GameState, action: Action): string {
  const r = validate(s, cat, action);
  return r.ok ? 'ok' : r.error.code;
}

const pass = (player: PlayerId): Action => ({ type: 'PASS', player });
const choose = (player: PlayerId, card: CardId): Action => ({ type: 'CHOOSE_CARD', player, card });
const activate = (player: PlayerId, card: CardId, ability = 0): Action => ({ type: 'ACTIVATE', player, card, ability });

/** Takes the do-nothing answer (PASS, or no clock) to every decision until `done` holds. */
function idleUntil(s: GameState, done: (st: GameState) => boolean): Ran {
  let state = s;
  const events: GameEvent[] = [];
  for (let i = 0; i < 40 && !done(state); i++) {
    const p = state.pending;
    if (!p) throw new Error('no decision is pending');
    const r = go(state, p.kind === 'clock' ? { type: 'CLOCK', player: p.player, card: null } : pass(p.player));
    state = r.state;
    events.push(...r.events);
  }
  if (!done(state)) throw new Error(`never got there; waiting on ${state.pending?.kind ?? 'nothing'}`);
  return { state, events };
}

const defOfId = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** A readable trace of the events these rules order, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  const d = (id: CardId | null) => defOfId(s, id);
  return events.flatMap((e): string[] => {
    if (e.kind === 'action') return [`action:${e.action.type}:${e.action.player}`];
    if (e.kind === 'played') return [`played:${d(e.card)}`];
    if (e.kind === 'move') return [`move:${e.reason}:${d(e.card)}:${e.from.zone}->${e.to.zone}`];
    if (e.kind === 'orientation') return [`orientation:${d(e.card)}:${e.orientation}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    if (e.kind === 'ability') return [`ability:${d(e.card)}:${e.index ?? '-'}:${e.category}`];
    if (e.kind === 'abilityLapsed') return [`lapsed:${d(e.card)}:${e.index}`];
    if (e.kind === 'effect') return [`effect:${d(e.card)}:${e.op}`];
    if (e.kind === 'modifier') return [`modifier:${d(e.card)}:${e.stat}:${e.amount}`];
    if (e.kind === 'chosen') return [`chosen:${e.cards.map(d).join(',')}`];
    if (e.kind === 'icon') return [`icon:${e.icon}`];
    if (e.kind === 'damage') return [`damage:${e.target}:${e.amount}`];
    if (e.kind === 'damageCanceled' || e.kind === 'damageTaken') return [e.kind];
    if (e.kind === 'auto') return [`auto:${e.ability}:${d(e.card)}`];
    if (e.kind === 'effectsExpired') return ['effectsExpired'];
    if (e.kind === 'turnStart') return [`turnStart:${e.player}`];
    return [];
  });
}

/** Only the ability-related events: abilities played, effect steps, modifiers, choices. */
const abilityTrace = (s: GameState, events: readonly GameEvent[]) => trace(s, events).filter((x) => /^(ability|lapsed|effect|modifier|chosen):/.test(x));

/** Legal actions for the player being waited on, readable, deduplicated and sorted. */
function offers(s: GameState): string[] {
  const out = legalActions(s, cat).map((a) => {
    if (a.type === 'ACTIVATE') return `ACTIVATE:${defOfId(s, a.card)}:${a.ability}`;
    return 'card' in a && typeof a.card === 'string' ? `${a.type}:${defOfId(s, a.card)}` : a.type;
  });
  return [...new Set(out)].sort();
}
const activations = (s: GameState) => offers(s).filter((a) => a.startsWith('ACTIVATE'));

/** Where a card is, as '<zone>:<player>'. */
function where(s: GameState, card: CardId): string {
  const loc = locate(s, card);
  return loc ? `${loc.zone}:${loc.player}` : 'nowhere';
}

/** Error codes and paths from the ability validator, for a card of the given kind. */
function abilityErrors(kind: 'character' | 'climax' | 'event', field: 'abilities' | 'effect', value: unknown[]): string[] {
  return checkCardAbilities({ kind, [field]: value }, 'card T').map((e) => `${e.code}@${e.path ?? ''}`);
}

// =============================================================================
// CONC-01: an ability is an instruction from card text or an effect; one of three categories (CR 4.1.1)
// =============================================================================

describe('CONC-01: abilities come from card text or effects and have exactly one of three categories', () => {
  it('[CONC-01] the ability language knows exactly three categories; an ability with any other kind, no kind, or parts of a second category is rejected', () => {
    expect(validateCatalog(cat)).toEqual([]);
    expect([...ABILITY_KINDS]).toEqual(['activated', 'automatic', 'continuous']);

    // Each category on its own is a valid ability.
    expect(abilityErrors('character', 'abilities', [...TRIAD])).toEqual([]);

    // No fourth category, no ability without a category, no ability with two.
    expect(abilityErrors('character', 'abilities', [{ kind: 'replacement', effect: [draw1] }])).toEqual(['ABILITY_KIND@abilities.0.kind']);
    expect(abilityErrors('character', 'abilities', [{ trigger: { on: 'play' }, effect: [draw1] }])).toEqual(['ABILITY_KIND@abilities.0.kind']);
    expect(abilityErrors('character', 'abilities', [{ kind: ['automatic', 'continuous'], trigger: { on: 'play' }, effect: [draw1] }])).toEqual([
      'ABILITY_KIND@abilities.0.kind',
    ]);

    // Exactly one: an ability may not carry the parts that define another category.
    expect(abilityErrors('character', 'abilities', [{ kind: 'automatic', trigger: { on: 'play' }, timing: 'main', effect: [draw1] }])).toEqual([
      'ABILITY_SHAPE@abilities.0.timing',
    ]);
    expect(abilityErrors('character', 'abilities', [{ kind: 'continuous', modifiers: [{ stat: 'power', amount: 500, target: 'this' }], effect: [draw1] }])).toEqual([
      'ABILITY_SHAPE@abilities.0.effect',
    ]);
    expect(abilityErrors('character', 'abilities', [{ kind: 'activated', timing: 'main', cost: payStock1, trigger: { on: 'play' }, effect: [draw1] }])).toEqual([
      'ABILITY_SHAPE@abilities.0.trigger',
    ]);
  });

  it("[CONC-01] a card's printed abilities each behave as their own category: the continuous one just applies, the automatic one is played when its trigger happens, the activated one when its player uses it", () => {
    // Card text marks each ability with its category.
    expect(cardText(def('TRI'))).toEqual([
      '[CONT] This card gets +500 power.',
      '[AUTO] When this card is played and placed, draw 1 card.',
      '[ACT] [(1)] This card gets +1 soul until end of turn.',
    ]);

    const s0 = mainPhase({ hand: ['TRI'], stock: ['G0'], deck: [...FILL, 'B1'] });
    const tri = cardIn(s0, 0, 'hand', 'TRI');
    const played = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: tri, slot: 1 });
    expect(trace(played.state, played.events)).toEqual([
      'action:PLAY_CHARACTER:0',
      'played:TRI',
      'move:play:TRI:hand->stage',
      'check',
      'ability:TRI:1:automatic',
      'effect:TRI:draw',
      'move:draw:B1:deck->hand',
      'playTiming:0:main',
    ]);
    // The continuous ability already applies; nothing was played for it.
    expect(currentPower(played.state, cat, tri)).toBe(3500);
    // Only the activated ability can be used, and only when the player chooses to.
    expect(activations(played.state)).toEqual(['ACTIVATE:TRI:2']);
    expect(currentSoul(played.state, cat, tri)).toBe(1);

    const used = go(played.state, activate(0, tri, 2));
    expect(trace(used.state, used.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:G0:stock->waiting',
      'ability:TRI:2:activated',
      'effect:TRI:soul',
      'modifier:TRI:soul:1',
      'check',
      'playTiming:0:main',
    ]);
    expect(currentSoul(used.state, cat, tri)).toBe(2);
    expect(currentPower(used.state, cat, tri)).toBe(3500);
    // Across the whole game so far, each played ability is logged with its own category; the continuous one never is.
    expect(used.state.log.flatMap((e) => (e.kind === 'ability' ? [`${e.index ?? '-'}:${e.category}`] : []))).toEqual(['1:automatic', '2:activated']);
  });

  it('[CONC-01] an ability can also come from an effect: the shot icon gives the attacker an automatic ability that waits for its trigger and is then played in a check timing', () => {
    // Neither the attacker nor the climax has any printed ability.
    expect(def('Y1').abilities).toBeUndefined();
    expect(def('SHOTX').abilities).toBeUndefined();

    // Player 1's top card is a climax, so the attack's damage is canceled; the next card is plain.
    const s = attackPhase({ deck: [...FILL, 'SHOTX'], stage: { 1: 'Y1', 2: 'Y0' } }, { deck: ['G0', 'G0', 'B0', 'YX'] });
    const r = go(s, { type: 'ATTACK', player: 0, slot: 1, attack: 'direct' });
    const t = trace(r.state, r.events);
    const icon = t.indexOf('icon:shot');
    const canceled = t.indexOf('damageCanceled');
    expect(icon).toBeGreaterThan(-1);
    expect(canceled).toBeGreaterThan(icon);
    // Created by the icon's effect, the ability does nothing until its trigger (the canceled damage) happens...
    expect(t.slice(0, canceled).filter((x) => x.startsWith('auto:'))).toEqual([]);
    // ...then it is played in the next check timing, like any automatic ability, and deals its damage.
    expect(t.slice(canceled, canceled + 4)).toEqual(['damageCanceled', 'check', 'auto:shot:Y1', 'damage:1:1']);
    expect(t.filter((x) => x.startsWith('auto:'))).toEqual(['auto:shot:Y1']);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['B0']);
  });
});

// =============================================================================
// CONC-02: an effect is what an ability instructs; one-shot vs continuous (CR 4.1.2)
// =============================================================================

describe('CONC-02: effects are the content of abilities, and one-shot and continuous effects are told apart', () => {
  it('[CONC-02] the effect of an ability is its instructions, carried out in order; a one-shot part is done and over, a continuous part stays until its duration ends', () => {
    const s0 = mainPhase({ hand: ['PAIR'], deck: [...FILL, 'B1'] }, { hand: ['G0'] });
    const pair = cardIn(s0, 0, 'hand', 'PAIR');
    const r = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: pair, slot: 1 });

    // The ability's effect is exactly its two instructions, in the order written.
    expect(abilityTrace(r.state, r.events)).toEqual(['ability:PAIR:0:automatic', 'effect:PAIR:draw', 'effect:PAIR:power', 'modifier:PAIR:power:1500']);
    // One-shot: the card was drawn, and nothing of that instruction remains.
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
    // Continuous: a standing change on this card object.
    const epoch = r.state.cards[pair]?.epoch;
    expect(r.state.effects).toEqual([{ card: { card: pair, epoch }, stat: 'power', amount: 1500 }]);
    expect(currentPower(r.state, cat, pair)).toBe(3500);

    // Later in the turn the continuous part still applies, and the one-shot part never happens again.
    const atk = idleUntil(r.state, (st) => st.pending?.kind === 'attack');
    expect(currentPower(atk.state, cat, pair)).toBe(3500);
    expect(atk.events.filter((e) => e.kind === 'effect' || (e.kind === 'move' && e.reason === 'draw'))).toEqual([]);

    // After the turn the continuous part has ended; what the one-shot part did stays done.
    const next = idleUntil(atk.state, (st) => st.active === 1 && st.pending?.kind === 'clock');
    expect(currentPower(next.state, cat, pair)).toBe(2000);
    expect(next.state.effects).toEqual([]);
    expect(defsIn(next.state, 0, 'hand')).toEqual(['B1']);
    const t = trace(next.state, next.events);
    expect(t.indexOf('effectsExpired')).toBeGreaterThan(-1);
    expect(t.indexOf('effectsExpired')).toBeLessThan(t.indexOf('turnStart:1'));
  });

  it('[CONC-02] the ability language keeps the two kinds apart: only power and soul changes take a duration (turn or game); a one-shot instruction with a duration is rejected', () => {
    expect([...DURATIONS]).toEqual(['turn', 'game']);
    const everyone = { all: { side: 'you' } } as const;
    expect(abilityErrors('event', 'effect', [{ do: 'power', amount: 1000, target: everyone, duration: 'game' }])).toEqual([]);
    expect(abilityErrors('event', 'effect', [{ do: 'soul', amount: 1, target: everyone, duration: 'turn' }])).toEqual([]);
    expect(abilityErrors('event', 'effect', [{ do: 'draw', count: 1, duration: 'turn' }])).toEqual(['ABILITY_SHAPE@effect.0.duration']);
    expect(abilityErrors('event', 'effect', [{ do: 'stockFromDeck', count: 1, duration: 'game' }])).toEqual(['ABILITY_SHAPE@effect.0.duration']);
    expect(abilityErrors('event', 'effect', [{ do: 'power', amount: 1000, target: everyone, duration: 'forever' }])).toEqual(['ABILITY_STEP@effect.0.duration']);
  });
});

// =============================================================================
// ABL-01: three categories; activated abilities need a play timing and their cost (CR 8.1.1)
// =============================================================================

describe('ABL-01: activated abilities are used in a play timing by paying their cost', () => {
  it('[ABL-01] each category has its own marker in card text, and an activated ability is written as its cost in brackets followed by its effect', () => {
    expect(TRIAD.map((a) => `${a.kind}:${abilityText(a).split(' ')[0] ?? ''}`)).toEqual(['continuous:[CONT]', 'automatic:[AUTO]', 'activated:[ACT]']);
    const [ability] = def('ACT').abilities ?? [];
    if (!ability) throw new Error('ACT has no ability');
    expect(ability.kind).toBe('activated');
    expect(abilityText(ability)).toBe('[ACT] [(1), Rest this card] Draw 1 card.');
  });

  it('[ABL-01] only the player who holds a play timing may use an activated ability: the turn player in the main phase, not the opponent, and not during the clock decision, the climax phase or the attack declaration', () => {
    const p0: ZoneSpec = { stage: { 1: 'ACT', 2: 'Y0' }, stock: ['G0', 'G0'], hand: ['G0'] };
    const p1: ZoneSpec = { stage: { 1: 'ACT' }, stock: ['G0'] };

    // Main Phase play timing: the turn player may.
    const main = mainPhase(p0, p1);
    const mine = cardIn(main, 0, 'stage', 'ACT');
    const theirs = cardIn(main, 1, 'stage', 'ACT');
    expect(main.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(activations(main)).toEqual(['ACTIVATE:ACT:0']);
    expect(attempt(main, activate(0, mine))).toBe('ok');
    // The opponent holds no play timing now, even for their own character, whose cost they could pay.
    expect(attempt(main, activate(1, theirs))).toBe('NOT_YOUR_DECISION');
    expect(legalActions(main, cat, 1)).toEqual([]);

    // Clock Phase: the turn player is deciding about the clock, not holding a play timing.
    const clock = scenario('clock', p0, p1);
    expect(clock.pending).toEqual({ kind: 'clock', player: 0 });
    expect(attempt(clock, activate(0, cardIn(clock, 0, 'stage', 'ACT')))).toBe('ILLEGAL_ACTION');

    // Climax Phase play timing: only a climax may be played there.
    const cx = go(main, pass(0)).state;
    expect(cx.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    expect(activations(cx)).toEqual([]);
    expect(attempt(cx, activate(0, mine))).toBe('ILLEGAL_ACTION');

    // Attack Declaration Step: declare an attack or end the phase; there is no play timing.
    const atk = go(cx, pass(0)).state;
    expect(atk.pending).toEqual({ kind: 'attack', player: 0 });
    expect(attempt(atk, activate(0, mine))).toBe('ILLEGAL_ACTION');
  });

  it('[ABL-01] while an ability is resolving and waiting for a choice nobody holds a play timing, so no activated ability can be used until it is done', () => {
    const s0 = mainPhase({ stage: { 1: 'PICK', 2: 'Y0', 3: 'ACT' }, stock: ['G0', 'G0'] });
    const [pick, y0, act] = [cardIn(s0, 0, 'stage', 'PICK'), cardIn(s0, 0, 'stage', 'Y0'), cardIn(s0, 0, 'stage', 'ACT')];
    expect(activations(s0)).toEqual(['ACTIVATE:ACT:0', 'ACTIVATE:PICK:0']);

    const mid = go(s0, activate(0, pick)).state;
    expect(mid.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', as: 't', card: pick, options: [pick, y0, act], picked: [], min: 1, max: 1 });
    expect(attempt(mid, activate(0, act))).toBe('ILLEGAL_ACTION');
    expect(offers(mid)).toEqual(['CHOOSE_CARD:ACT', 'CHOOSE_CARD:PICK', 'CHOOSE_CARD:Y0']);

    // Once it has resolved, the player gets a play timing again and may use the other ability.
    const done = go(mid, choose(0, y0)).state;
    expect(done.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(currentPower(done, cat, y0)).toBe(3000);
    // One stock is left, so either ability may be used now.
    expect(activations(done)).toEqual(['ACTIVATE:ACT:0', 'ACTIVATE:PICK:0']);
  });

  it('[ABL-01] using an activated ability first pays its whole cost; only then is it played and its effect carried out, after which the player gets another play timing', () => {
    const s0 = mainPhase({ stage: { 1: 'ACT' }, stock: ['G0', 'B0'], deck: [...FILL, 'B1'] });
    const act = cardIn(s0, 0, 'stage', 'ACT');
    const r = go(s0, activate(0, act));
    expect(trace(r.state, r.events)).toEqual([
      'action:ACTIVATE:0',
      'move:cost:B0:stock->waiting',
      'orientation:ACT:rest',
      'ability:ACT:0:activated',
      'effect:ACT:draw',
      'move:draw:B1:deck->hand',
      'check',
      'playTiming:0:main',
    ]);
    expect(defsIn(r.state, 0, 'stock')).toEqual(['G0']);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
    // Rested, it cannot pay "rest this card" again, so the ability cannot be used, even with stock left.
    expect(activations(r.state)).toEqual([]);
    expect(attempt(r.state, activate(0, act))).toBe('ILLEGAL_ACTION');

    // With no stock to pay, the ability is not usable at all.
    const broke = mainPhase({ stage: { 1: 'ACT' } });
    expect(activations(broke)).toEqual([]);
    expect(attempt(broke, activate(0, cardIn(broke, 0, 'stage', 'ACT')))).toBe('ILLEGAL_ACTION');
  });

  it("[ABL-01] in the Counter Step the play timing belongs to the defending player and admits only counter abilities: their counter ability is offered, their main-phase one is not; the attacker may not use theirs, and the defender's counter ability is not usable in the attacker's main phase", () => {
    // Position 1 faces the opponent's position 3. The defender also has a main-phase ability (BOOST) it could pay for.
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'ACT' }, stock: ['G0'] }, { stage: { 2: 'BOOST', 3: 'CNT' }, stock: ['G0'] });
    const r = go(s0, { type: 'ATTACK', player: 0, slot: 1, attack: 'frontal' });
    expect(r.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    const cnt = cardIn(r.state, 1, 'stage', 'CNT');
    // Only abilities marked for the Counter Step may be used here (CR 7.4.1.2.1), so the main-phase one is left out.
    expect(offers(r.state)).toEqual(['ACTIVATE:CNT:0', 'PASS']);
    expect(attempt(r.state, activate(1, cardIn(r.state, 1, 'stage', 'BOOST')))).toBe('ILLEGAL_ACTION');
    expect(attempt(r.state, activate(0, cardIn(r.state, 0, 'stage', 'ACT')))).toBe('NOT_YOUR_DECISION');

    const used = go(r.state, activate(1, cnt));
    expect(trace(used.state, used.events).slice(0, 5)).toEqual([
      'action:ACTIVATE:1',
      'move:cost:G0:stock->waiting',
      'ability:CNT:0:activated',
      'effect:CNT:power',
      'modifier:CNT:power:2000',
    ]);

    const main = mainPhase({ stage: { 1: 'Y1' } }, { stage: { 1: 'CNT' }, stock: ['G0'] });
    expect(attempt(main, activate(1, cardIn(main, 1, 'stage', 'CNT')))).toBe('NOT_YOUR_DECISION');
  });
});

// =============================================================================
// ABL-04: only played abilities and cards produce effects; continuous ones never are played (CR 8.1.1.3, 8.6.1)
// =============================================================================

describe('ABL-04: activated and automatic abilities and cards in hand work by being played; continuous abilities are never played', () => {
  it('[ABL-04] a continuous ability is never played: its effect simply holds while its card is on the stage, with no ability played, nothing in standby and no prompt', () => {
    const s0 = mainPhase({ stage: { 1: 'AURA', 2: 'Y0' }, hand: ['B0', 'Y0b'] });
    const [aura, y0] = [cardIn(s0, 0, 'stage', 'AURA'), cardIn(s0, 0, 'stage', 'Y0')];
    expect(currentPower(s0, cat, y0)).toBe(3000);
    expect(currentPower(s0, cat, aura)).toBe(2000);
    expect(abilityTrace(s0, s0.log)).toEqual([]);
    expect(s0.standby).toEqual([]);
    expect(s0.effects).toEqual([]);

    // A character that arrives is affected at once, still without anything being played.
    const b0 = cardIn(s0, 0, 'hand', 'B0');
    const arrive = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: b0, slot: 3 });
    expect(currentPower(arrive.state, cat, b0)).toBe(3500);
    expect(abilityTrace(arrive.state, arrive.events)).toEqual([]);
    expect(arrive.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });

    // It lasts only as long as its source: once the card leaves the stage, the effect is gone.
    const y0b = cardIn(arrive.state, 0, 'hand', 'Y0b');
    const gone = go(arrive.state, { type: 'PLAY_CHARACTER', player: 0, card: y0b, slot: 1 });
    expect(where(gone.state, aura)).toBe('waiting:0');
    expect(currentPower(gone.state, cat, y0)).toBe(2000);
    expect(currentPower(gone.state, cat, b0)).toBe(2500);
    expect(currentPower(gone.state, cat, y0b)).toBe(2500);
    expect(abilityTrace(gone.state, gone.events)).toEqual([]);
  });

  it('[ABL-04] an automatic ability does nothing when its trigger happens: it waits in standby, and its effect happens only once it is played and resolved', () => {
    const s0 = climaxPhase({ deck: [...FILL, 'B1', 'B0'], hand: ['YX'], clock: ['Y0'], stage: { 1: 'WDRAW', 2: 'WSTOCK' } });
    expect(s0.pending).toEqual({ kind: 'play', player: 0, window: 'climax' });
    const r = go(s0, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s0, 0, 'hand', 'YX') });

    // Both triggered; neither has done anything yet.
    const pending = r.state.pending;
    if (pending?.kind !== 'autoOrder') throw new Error(`expected an autoOrder prompt, got ${pending?.kind ?? 'none'}`);
    const standby = r.state.standby.map((a) => (a.ability === 'card' ? `${defOfId(r.state, a.source.card)}:${a.index}:${a.on}` : a.ability));
    expect(standby).toEqual(['WDRAW:0:climaxPlayed', 'WSTOCK:0:climaxPlayed']);
    expect(defsIn(r.state, 0, 'hand')).toEqual([]);
    expect(defsIn(r.state, 0, 'stock')).toEqual([]);
    expect(abilityTrace(r.state, r.events)).toEqual([]);

    // Played one at a time; each effect happens when its ability resolves.
    const stocker = pending.options.find((a) => a.ability === 'card' && defOfId(r.state, a.source.card) === 'WSTOCK');
    if (!stocker) throw new Error('WSTOCK is not offered');
    const done = go(r.state, { type: 'ORDER_AUTO', player: 0, auto: stocker.id });
    expect(trace(done.state, done.events).filter((x) => /^(ability|effect|move):/.test(x))).toEqual([
      'ability:WSTOCK:0:automatic',
      'effect:WSTOCK:stockFromDeck',
      'move:effect:B0:deck->stock',
      'ability:WDRAW:0:automatic',
      'effect:WDRAW:draw',
      'move:draw:B1:deck->hand',
    ]);
    expect(defsIn(done.state, 0, 'stock')).toEqual(['B0']);
    expect(defsIn(done.state, 0, 'hand')).toEqual(['B1']);
    expect(done.state.standby).toEqual([]);
  });

  it('[ABL-04] an activated ability does nothing just by being on the stage; its effect happens only when its player uses it', () => {
    const s0 = mainPhase({ stage: { 1: 'ACT' }, stock: ['G0'], deck: [...FILL, 'B1'] });
    const skipped = idleUntil(s0, (st) => st.pending?.kind === 'attack');
    expect(abilityTrace(skipped.state, skipped.state.log)).toEqual([]);
    expect(defsIn(skipped.state, 0, 'hand')).toEqual([]);
    expect(defsIn(skipped.state, 0, 'stock')).toEqual(['G0']);

    const used = go(s0, activate(0, cardIn(s0, 0, 'stage', 'ACT')));
    expect(abilityTrace(used.state, used.events)).toEqual(['ability:ACT:0:activated', 'effect:ACT:draw']);
    expect(defsIn(used.state, 0, 'hand')).toEqual(['B1']);
  });

  it('[ABL-04] a card in hand does nothing until it is played: an event resolves its effect only once played, from the resolution zone, and then goes to the waiting room', () => {
    const s0 = mainPhase({ hand: ['EVDRAW'], deck: [...FILL, 'B1'] });
    const ev = cardIn(s0, 0, 'hand', 'EVDRAW');
    // Kept in hand through the main phase, it does nothing.
    const kept = go(s0, pass(0));
    expect(abilityTrace(kept.state, kept.state.log)).toEqual([]);
    expect(defsIn(kept.state, 0, 'hand')).toEqual(['EVDRAW']);

    const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: ev });
    expect(trace(r.state, r.events).filter((x) => /^(played|move|effect):/.test(x))).toEqual([
      'played:EVDRAW',
      'move:play:EVDRAW:hand->resolution',
      'effect:EVDRAW:draw',
      'move:draw:B1:deck->hand',
      'move:eventResolved:EVDRAW:resolution->waiting',
    ]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
    expect(defsIn(r.state, 0, 'waiting')).toEqual(['EVDRAW']);
  });
});

// =============================================================================
// ABL-05: one-shot, continuous (stated duration or the rest of the game) effects (CR 8.2.1, 8.8.1)
// =============================================================================

describe('ABL-05: one-shot effects happen once; continuous effects last for their duration, or the whole game without one', () => {
  it('[ABL-05] a one-shot effect is carried out exactly once and is then over: nothing of it is left to act later', () => {
    const s0 = mainPhase({ hand: ['ONCE', 'Y0'], deck: [...FILL, 'B1', 'B0'] });
    const r = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(s0, 0, 'hand', 'ONCE'), slot: 1 });
    expect(abilityTrace(r.state, r.events)).toEqual(['ability:ONCE:0:automatic', 'effect:ONCE:stockFromDeck']);
    expect(trace(r.state, r.events).filter((x) => x.startsWith('move:effect:'))).toEqual(['move:effect:B0:deck->stock']);
    expect(defsIn(r.state, 0, 'stock')).toEqual(['B0']);
    expect(r.state.effects).toEqual([]);
    expect(r.state.standby).toEqual([]);
    expect(r.state.resolving).toBeNull();

    // Nothing later repeats it: another character arrives, the turn moves on, the stock stays at one.
    const more = go(r.state, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(r.state, 0, 'hand', 'Y0'), slot: 2 });
    const atk = idleUntil(more.state, (st) => st.pending?.kind === 'attack');
    expect(abilityTrace(atk.state, [...more.events, ...atk.events])).toEqual([]);
    expect(defsIn(atk.state, 0, 'stock')).toEqual(['B0']);
  });

  it("[ABL-05] a continuous effect with a stated duration ('until end of turn') applies for the rest of the turn and then stops", () => {
    const [ability] = def('BOOST').abilities ?? [];
    if (!ability) throw new Error('BOOST has no ability');
    expect(abilityText(ability)).toBe('[ACT] [(1)] This card gets +2000 power until end of turn.');

    const s0 = mainPhase({ stage: { 1: 'BOOST' }, stock: ['G0'] }, { hand: ['G0'] });
    const boost = cardIn(s0, 0, 'stage', 'BOOST');
    const r = go(s0, activate(0, boost));
    expect(currentPower(r.state, cat, boost)).toBe(4000);
    expect(r.state.effects).toEqual([{ card: { card: boost, epoch: r.state.cards[boost]?.epoch }, stat: 'power', amount: 2000 }]);

    const atk = idleUntil(r.state, (st) => st.pending?.kind === 'attack');
    expect(currentPower(atk.state, cat, boost)).toBe(4000);

    const next = idleUntil(atk.state, (st) => st.active === 1 && st.pending?.kind === 'clock');
    expect(currentPower(next.state, cat, boost)).toBe(2000);
    expect(next.state.effects).toEqual([]);
    const t = trace(next.state, next.events);
    expect(t.indexOf('effectsExpired')).toBeGreaterThan(-1);
    expect(t.indexOf('effectsExpired')).toBeLessThan(t.indexOf('turnStart:1'));
  });

  it('[ABL-05] a continuous effect with no stated duration lasts for the rest of the game: through both players’ later turns, for as long as its card stays where it is', () => {
    const [ability] = def('BOOSTG').abilities ?? [];
    if (!ability) throw new Error('BOOSTG has no ability');
    expect(abilityText(ability)).toBe('[ACT] [(1)] This card gets +1000 power.');

    const s0 = mainPhase({ stage: { 1: 'BOOSTG' }, stock: ['G0'], hand: ['Y0'] });
    const card = cardIn(s0, 0, 'stage', 'BOOSTG');
    const r = go(s0, activate(0, card));
    expect(currentPower(r.state, cat, card)).toBe(3000);
    const effect = { card: { card, epoch: r.state.cards[card]?.epoch }, stat: 'power', amount: 1000, until: 'game' };
    expect(r.state.effects).toEqual([effect]);

    // The opponent's turn (turn 3): still there.
    const t3 = idleUntil(r.state, (st) => st.turn === 3 && st.pending?.kind === 'clock');
    expect(t3.state.active).toBe(1);
    expect(currentPower(t3.state, cat, card)).toBe(3000);
    expect(t3.state.effects).toEqual([effect]);
    expect(trace(t3.state, t3.events)).toContain('turnStart:1');

    // Its own next turn (turn 4): still there.
    const t4 = idleUntil(t3.state, (st) => st.turn === 4 && st.pending?.kind === 'clock');
    expect(t4.state.active).toBe(0);
    expect(currentPower(t4.state, cat, card)).toBe(3000);
    expect(t4.state.effects).toEqual([effect]);

    // Once the card leaves the stage it is a new object, and the effect no longer applies to it.
    const main = go(t4.state, { type: 'CLOCK', player: 0, card: null }).state;
    const out = go(main, { type: 'PLAY_CHARACTER', player: 0, card: cardIn(main, 0, 'hand', 'Y0'), slot: 1 });
    expect(where(out.state, card)).toBe('waiting:0');
    expect(currentPower(out.state, cat, card)).toBe(2000);
  });
});

// =============================================================================
// CARD-03: a name in quotes means a card with exactly that name (CR 2.1.2)
// =============================================================================

describe('CARD-03: quoted names refer to cards with exactly that name', () => {
  it('[CARD-03] a quoted climax name in a trigger means a climax with exactly that name: another print with that name counts; a longer, shorter, differently capitalized or different name does not', () => {
    expect(cardText(def('NAMEW'))).toEqual(['[AUTO] When "Yellow Dawn" is placed in your climax area, draw 1 card.']);
    const playClimax = (cx: string) => {
      // Yellow and red cards in the clock so either color of climax can be played.
      const s0 = climaxPhase({ deck: [...FILL, 'B1'], hand: [cx], clock: ['Y0', 'R0'], stage: { 1: 'NAMEW' } });
      const r = go(s0, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s0, 0, 'hand', cx) });
      expect(r.state.players[0].climax.map((c) => defOfId(r.state, c.id))).toEqual([cx]);
      return { abilities: abilityTrace(r.state, r.events), hand: defsIn(r.state, 0, 'hand') };
    };
    const fired = { abilities: ['ability:NAMEW:0:automatic', 'effect:NAMEW:draw'], hand: ['B1'] };
    const quiet = { abilities: [], hand: [] };
    expect(def('YX').name).toBe('Yellow Dawn');
    expect(playClimax('YX')).toEqual(fired);
    expect(playClimax('YXB')).toEqual(fired);
    expect(playClimax('YXS')).toEqual(quiet); // "Yellow Dawn Rising"
    expect(playClimax('YXP')).toEqual(quiet); // "Yellow Daw"
    expect(playClimax('YXU')).toEqual(quiet); // "YELLOW DAWN"
    expect(playClimax('RX')).toEqual(quiet); // "Red Dusk"
  });

  it('[CARD-03] a quoted name in a choice means characters with exactly that name, whichever print they are', () => {
    expect(cardText(def('EVNAME'))[0]).toContain('named "Yellow Scout"');
    const s0 = mainPhase({ hand: ['EVNAME'], stage: { 1: 'Y0', 2: 'Y0X', 3: 'Y0b', 4: 'Y1', 5: 'Y0L' } });
    const ev = cardIn(s0, 0, 'hand', 'EVNAME');
    const [y0, y0b] = [cardIn(s0, 0, 'stage', 'Y0'), cardIn(s0, 0, 'stage', 'Y0b')];
    expect(def('Y0b').name).toBe('Yellow Scout');
    expect(def('Y0X').name).toBe('Yellow Scout Elite');
    expect(def('Y0L').name).toBe('yellow scout');

    const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: ev });
    // "Yellow Scout Elite", "Yellow Ranger" and "yellow scout" are not "Yellow Scout".
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', as: 'x', card: ev, options: [y0, y0b], picked: [], min: 1, max: 1 });
    const done = go(r.state, choose(0, y0b));
    expect(abilityTrace(done.state, done.events)).toEqual(['chosen:Y0b', 'effect:EVNAME:power', 'modifier:Y0b:power:1000']);
    expect(currentPower(done.state, cat, y0b)).toBe(3500);
    expect(currentPower(done.state, cat, y0)).toBe(2000);
  });

  it('[CARD-03] a quoted climax name in a condition holds only while a climax with exactly that name is there', () => {
    expect(conditionText({ if: 'climax', name: 'Yellow Dawn' })).toBe('you have "Yellow Dawn" in the climax area');
    const resolve = (cx: string) => {
      const s0 = mainPhase({ hand: ['EVCXN'], climax: [cx], deck: [...FILL, 'B1'] });
      const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: cardIn(s0, 0, 'hand', 'EVCXN') });
      return { hand: defsIn(r.state, 0, 'hand'), stock: defsIn(r.state, 0, 'stock') };
    };
    const holds = { hand: ['B1'], stock: [] };
    const fails = { hand: [], stock: ['B1'] };
    expect(resolve('YX')).toEqual(holds);
    expect(resolve('YXB')).toEqual(holds);
    expect(resolve('YXS')).toEqual(fails);
    expect(resolve('YXP')).toEqual(fails);
    expect(resolve('YXU')).toEqual(fails);
    expect(resolve('RX')).toEqual(fails);
  });
});

// =============================================================================
// CARD-07: "character" with no zone named means a character on the stage (CR 2.3.2.1.2)
// =============================================================================

describe("CARD-07: 'character' alone means a character on the stage", () => {
  /** Characters in every other zone of player 0. */
  const elsewhere: ZoneSpec = { waiting: ['Y0', 'B1'], clock: ['B0'], level: ['G0'], stock: ['R0'], memory: ['Y0b'] };

  it("[CARD-07] choosing 'one of your characters' offers only characters on the stage; with none there, nothing is chosen even if other zones hold characters", () => {
    const s0 = mainPhase({ ...elsewhere, hand: ['EVPICK', 'Y1'], stage: { 1: 'Y0', 3: 'B0' } }, { stage: { 2: 'R0' } });
    const ev = cardIn(s0, 0, 'hand', 'EVPICK');
    const [y0, b0] = [cardIn(s0, 0, 'stage', 'Y0'), cardIn(s0, 0, 'stage', 'B0')];
    const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: ev });
    expect(r.state.pending).toEqual({ kind: 'pick', player: 0, purpose: 'target', as: 'x', card: ev, options: [y0, b0], picked: [], min: 1, max: 1 });

    const none = mainPhase({ ...elsewhere, hand: ['EVPICK', 'Y1'] });
    const rn = go(none, { type: 'PLAY_EVENT', player: 0, card: cardIn(none, 0, 'hand', 'EVPICK') });
    expect(rn.state.pending).toEqual({ kind: 'play', player: 0, window: 'main' });
    expect(abilityTrace(rn.state, rn.events).filter((x) => /^(chosen|modifier):/.test(x))).toEqual([]);
    expect(rn.state.effects).toEqual([]);
    expect(defsIn(rn.state, 0, 'waiting')).toEqual(['Y0', 'B1', 'EVPICK']);
  });

  it("[CARD-07] 'all of your characters' and a count of your characters cover only the stage", () => {
    const s0 = mainPhase({ ...elsewhere, hand: ['EVALL', 'Y1'], stage: { 2: 'B0', 4: 'Y0' } });
    const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: cardIn(s0, 0, 'hand', 'EVALL') });
    expect(abilityTrace(r.state, r.events)).toEqual(['effect:EVALL:power', 'modifier:B0:power:1000', 'modifier:Y0:power:1000']);
    expect(r.state.effects.map((e) => where(r.state, e.card.card))).toEqual(['stage:0', 'stage:0']);

    // "If there are 2 or more of your characters": one on the stage plus several elsewhere is not enough.
    expect(conditionText({ if: 'count', what: { side: 'you' }, min: 2 })).toBe('there are 2 or more of your characters on the stage');
    const resolve = (stage: ZoneSpec['stage']) => {
      const s = mainPhase({ ...elsewhere, hand: ['EVCOUNT', 'Y1'], stage, deck: [...FILL, 'B1'] });
      const rr = go(s, { type: 'PLAY_EVENT', player: 0, card: cardIn(s, 0, 'hand', 'EVCOUNT') });
      return { hand: defsIn(rr.state, 0, 'hand'), stock: defsIn(rr.state, 0, 'stock') };
    };
    expect(resolve({ 1: 'Y0' })).toEqual({ hand: ['Y1'], stock: ['R0', 'B1'] });
    expect(resolve({ 1: 'Y0', 5: 'B0' })).toEqual({ hand: ['Y1', 'B1'], stock: ['R0'] });
  });
});

// =============================================================================
// CARD-08: "climax" (or "CX") with no zone named means a climax in the climax area (CR 2.3.2.3.2-3)
// =============================================================================

describe("CARD-08: 'climax' alone means a climax in the climax area", () => {
  /** Climaxes in every other zone of player 0. */
  const elsewhere: ZoneSpec = { waiting: ['RX', 'YX', 'BX'], clock: ['BX'], level: ['YX'], stock: ['RX'] };

  const resolve = (ev: string, spec: ZoneSpec) => {
    const s0 = mainPhase({ ...elsewhere, ...spec, hand: [ev, 'YX'], deck: [...FILL, 'B1'] });
    const r = go(s0, { type: 'PLAY_EVENT', player: 0, card: cardIn(s0, 0, 'hand', ev) });
    return { hand: defsIn(r.state, 0, 'hand'), stock: defsIn(r.state, 0, 'stock') };
  };
  const holds = { hand: ['YX', 'B1'], stock: ['RX'] };
  const fails = { hand: ['YX'], stock: ['RX', 'B1'] };

  it("[CARD-08] 'if you have a climax' looks only at the climax area: climaxes in the hand, waiting room, clock, level or stock do not count", () => {
    expect(conditionText({ if: 'climax' })).toBe('you have a climax in the climax area');
    expect(resolve('EVCX', {})).toEqual(fails);
    expect(resolve('EVCX', { climax: ['BX'] })).toEqual(holds);
  });

  it('[CARD-08] counting climaxes with no zone named counts the climax area only; naming a zone counts that zone instead', () => {
    expect(conditionText({ if: 'count', what: { side: 'you', kind: 'climax' }, min: 1 })).toContain('in the climax area');
    expect(resolve('EVCXC', {})).toEqual(fails);
    expect(resolve('EVCXC', { climax: ['RX'] })).toEqual(holds);
    // The waiting room's climaxes count only when the text names the waiting room.
    expect(resolve('EVCXW', {})).toEqual(holds);
    expect(resolve('EVCXW', { waiting: [] })).toEqual(fails);
    expect(resolve('EVCXW', { waiting: [], climax: ['RX'] })).toEqual(fails);
  });
});

// =============================================================================
// CARD-10: traits (CR 2.5)
// =============================================================================

describe('CARD-10: traits are character information with no rules effect of their own', () => {
  it('[CARD-10] only characters have traits: the catalog accepts them on a character and rejects them on an event or a climax', () => {
    expect(validateCatalog({ SQ2: def('SQ2') })).toEqual([]);
    const onEvent = validateCatalog({ TE: { id: 'TE', name: 'Tagged Memo', kind: 'event', color: 'yellow', level: 0, cost: 0, traits: ['Squad'] } });
    expect(onEvent.map((e) => e.code)).toEqual(['CATALOG_FIELD']);
    expect(onEvent[0]?.message).toContain('only characters have traits');
    const onClimax = validateCatalog({ TX: { id: 'TX', name: 'Tagged Dawn', kind: 'climax', color: 'yellow', traits: ['Squad'] } });
    expect(onClimax.map((e) => e.code)).toEqual(['CATALOG_FIELD']);
    expect(onClimax[0]?.message).toContain('only characters have traits');
  });

  it('[CARD-10] a trait has no rules effect of its own: the same game played with and without traits on a card goes exactly the same way', () => {
    const plain: CardCatalog = { ...cat, K: unit('K', 'Night Sentry', { power: 4000 }) };
    const tagged: CardCatalog = { ...cat, K: unit('K', 'Night Sentry', { power: 4000, traits: ['Squad', 'Night'] }) };
    expect(validateCatalog(tagged)).toEqual([]);
    const players: ScenarioSpec['players'] = [
      { hand: ['K'], deck: FILL },
      { stage: { 3: 'R0' }, deck: FILL },
    ];
    let a = makeState(plain, { start: 'main', players });
    let b = makeState(tagged, { start: 'main', players });
    const k = cardIn(a, 0, 'hand', 'K');
    const actions: Action[] = [
      { type: 'PLAY_CHARACTER', player: 0, card: k, slot: 1 },
      pass(0),
      pass(0),
      { type: 'ATTACK', player: 0, slot: 1, attack: 'frontal' },
      pass(1),
    ];
    expect(stateHash(a)).toBe(stateHash(b));
    for (const action of actions) {
      expect(legalActions(b, tagged)).toEqual(legalActions(a, plain));
      a = go(a, action, plain).state;
      b = go(b, action, tagged).state;
      expect(stateHash(b)).toBe(stateHash(a));
    }
    // The battle happened (K 4000 beat R0 3000) the same way in both.
    expect(defsIn(a, 1, 'waiting')).toEqual(['R0']);
    expect(defsIn(b, 1, 'waiting')).toEqual(['R0']);
  });

  it('[CARD-10] abilities refer to a trait in double angle brackets, and affect only characters that have exactly that trait; a character with no traits never matches', () => {
    const [text] = cardText(def('SQL'));
    expect(text).toMatch(/^\[CONT\] All of your [«≪]Squad[»≫] characters get \+1000 power\.$/);

    const s0 = mainPhase({ stage: { 1: 'SQL', 2: 'SQ1', 3: 'SQ2', 4: 'NT', 5: 'SQR' } }, { stage: { 1: 'SQ1' } });
    const power = (player: PlayerId, d: string) => currentPower(s0, cat, cardIn(s0, player, 'stage', d));
    expect(power(0, 'SQ1')).toBe(3000); // «Squad»
    expect(power(0, 'SQ2')).toBe(3000); // «Night», «Squad»
    expect(power(0, 'NT')).toBe(2000); // no traits
    expect(power(0, 'SQR')).toBe(2000); // «Squadron» is another trait
    expect(power(0, 'SQL')).toBe(2000); // the leader itself has no traits
    expect(power(1, 'SQ1')).toBe(2000); // "your" characters only

    // «squad» written in lower case is not the same trait as «Squad».
    const s1 = mainPhase({ stage: { 1: 'SQL', 2: 'SQC', 3: 'SQ1' } });
    expect(currentPower(s1, cat, cardIn(s1, 0, 'stage', 'SQC'))).toBe(2000);
    expect(currentPower(s1, cat, cardIn(s1, 0, 'stage', 'SQ1'))).toBe(3000);
  });
});

// =============================================================================
// CARD-19: where card text works (CR 2.12)
// =============================================================================

describe('CARD-19: card text works on the stage (characters) or in the climax area (climaxes), unless meant for another zone', () => {
  it("[CARD-19] a character's continuous ability works only while that character is on the stage", () => {
    const off = mainPhase({
      stage: { 1: 'Y0' },
      hand: ['AURA'],
      waiting: ['AURA'],
      clock: ['AURA'],
      level: ['AURA'],
      stock: ['AURA'],
      memory: ['AURA'],
      deck: [...FILL, 'AURA'],
    });
    expect(currentPower(off, cat, cardIn(off, 0, 'stage', 'Y0'))).toBe(2000);

    const on = mainPhase({ stage: { 1: 'Y0', 4: 'AURA' } });
    expect(currentPower(on, cat, cardIn(on, 0, 'stage', 'Y0'))).toBe(3000);
  });

  it("[CARD-19] a character's automatic ability triggers only while it is on the stage", () => {
    const off = climaxPhase({ hand: ['YX', 'WDRAW'], waiting: ['WDRAW'], clock: ['Y0'], stage: { 1: 'Y0' }, deck: [...FILL, 'B1'] });
    const r = go(off, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(off, 0, 'hand', 'YX') });
    // The copies in the hand and the waiting room did not trigger at all: nothing waits in standby, and play moves on.
    expect(r.state.standby).toEqual([]);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(abilityTrace(r.state, r.events)).toEqual([]);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['WDRAW']);

    const on = climaxPhase({ hand: ['YX'], clock: ['Y0'], stage: { 1: 'WDRAW' }, deck: [...FILL, 'B1'] });
    const ron = go(on, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(on, 0, 'hand', 'YX') });
    expect(abilityTrace(ron.state, ron.events)).toEqual(['ability:WDRAW:0:automatic', 'effect:WDRAW:draw']);
    expect(defsIn(ron.state, 0, 'hand')).toEqual(['B1']);
  });

  it("[CARD-19] a character's activated ability can be used only from the stage", () => {
    // BOOST's cost is stock only, which could be paid wherever the card is.
    const s0 = mainPhase({ hand: ['BOOST'], waiting: ['BOOST'], stock: ['G0'], stage: { 1: 'Y0' } });
    const [inHand, inWaiting] = [cardIn(s0, 0, 'hand', 'BOOST'), cardIn(s0, 0, 'waiting', 'BOOST')];
    expect(activations(s0)).toEqual([]);
    expect(attempt(s0, activate(0, inHand))).toBe('ILLEGAL_ACTION');
    expect(attempt(s0, activate(0, inWaiting))).toBe('ILLEGAL_ACTION');

    // Played onto the stage, the same card's ability becomes usable; the copy in the waiting room still is not.
    const played = go(s0, { type: 'PLAY_CHARACTER', player: 0, card: inHand, slot: 2 }).state;
    expect(legalActions(played, cat).filter((a) => a.type === 'ACTIVATE')).toEqual([{ type: 'ACTIVATE', player: 0, card: inHand, ability: 0 }]);
  });

  it("[CARD-19] a climax's card text works only while it is in the climax area: in other zones it does nothing, and it stops when the climax leaves", () => {
    const off = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' }, hand: ['CXAURA'], waiting: ['CXAURA'], stock: ['CXAURA'], clock: ['CXAURA'] });
    expect(currentSoul(off, cat, cardIn(off, 0, 'stage', 'Y0'))).toBe(1);
    expect(currentSoul(off, cat, cardIn(off, 0, 'stage', 'Y1'))).toBe(1);

    const on = mainPhase({ stage: { 1: 'Y0', 2: 'Y1' }, climax: ['CXAURA'] }, { stage: { 1: 'R0' }, hand: ['G0'] });
    const [y0, y1, cx] = [cardIn(on, 0, 'stage', 'Y0'), cardIn(on, 0, 'stage', 'Y1'), cardIn(on, 0, 'climax', 'CXAURA')];
    expect(currentSoul(on, cat, y0)).toBe(2);
    expect(currentSoul(on, cat, y1)).toBe(2);
    expect(currentSoul(on, cat, cardIn(on, 1, 'stage', 'R0'))).toBe(1);

    // The End Phase puts the climax into the waiting room, and its text stops working.
    const next = idleUntil(on, (st) => st.active === 1 && st.pending?.kind === 'clock');
    expect(where(next.state, cx)).toBe('waiting:0');
    expect(currentSoul(next.state, cat, y0)).toBe(1);
    expect(currentSoul(next.state, cat, y1)).toBe(1);

    // A climax's automatic ability works once it is placed in the climax area.
    const s1 = climaxPhase({ hand: ['CXDRAW'], clock: ['Y0'], stage: { 1: 'Y0' }, deck: [...FILL, 'B1'] });
    const r = go(s1, { type: 'PLAY_CLIMAX', player: 0, card: cardIn(s1, 0, 'hand', 'CXDRAW') });
    expect(abilityTrace(r.state, r.events)).toEqual(['ability:CXDRAW:0:automatic', 'effect:CXDRAW:draw']);
    expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
  });

  it('[CARD-19] an ability meant to be used from another zone works there: Backup is used from the hand in the Counter Step, while the same card on the stage offers no Backup', () => {
    const s0 = attackPhase({ stage: { 1: 'Y1', 2: 'Y0' } }, { stage: { 3: 'BKH' }, hand: ['BKH'] });
    const r = go(s0, { type: 'ATTACK', player: 0, slot: 1, attack: 'frontal' });
    expect(r.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    const [inHand, onStage] = [cardIn(r.state, 1, 'hand', 'BKH'), cardIn(r.state, 1, 'stage', 'BKH')];
    expect(legalActions(r.state, cat)).toEqual([
      { type: 'BACKUP', player: 1, card: inHand },
      { type: 'PASS', player: 1 },
    ]);
    expect(attempt(r.state, { type: 'BACKUP', player: 1, card: onStage })).toBe('ILLEGAL_ACTION');

    const used = go(r.state, { type: 'BACKUP', player: 1, card: inHand });
    expect(used.events.filter((e) => e.kind === 'backup')).toEqual([expect.objectContaining({ player: 1, card: inHand, target: onStage, power: 2000 })]);
    expect(where(used.state, inHand)).toBe('waiting:1');
    expect(currentPower(used.state, cat, onStage)).toBe(4000);
  });
});
