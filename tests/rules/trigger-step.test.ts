// Rule tests for M2: the Trigger Step (CR 7.3), the trigger icons (CR 2.11,
// 4.12) and the resolution zone as the trigger check uses it (CR 3.2.5,
// 3.13.1.2). Every title starts with the rules-matrix row id(s) it covers.
import { describe, expect, it } from 'vitest';

import { applyAction, currentSoul, HIDDEN, legalActions, projectEvents, projectView, validate } from '../../src/engine';
import type { Action, AttackType, CardCatalog, CardDef, CardId, GameEvent, GameState, PlayerId, Slot, TriggerIcon } from '../../src/engine';
import { cardIn, defsIn, makeState, ops } from '../../src/engine/testkit';
import type { ZoneSpec } from '../../src/engine/testkit';
import { catalog } from '../helpers/catalog';

// --- Synthetic cards (original, invented for these tests) --------------------

const unit = (id: string, name: string, triggers?: readonly TriggerIcon[], more: Partial<CardDef> = {}): CardDef => ({
  id,
  name,
  kind: 'character',
  color: 'yellow',
  level: 0,
  cost: 0,
  power: 1500,
  soul: 1,
  ...(triggers === undefined ? {} : { triggers }),
  ...more,
});
const burst = (id: string, name: string, triggers: readonly TriggerIcon[]): CardDef => ({ id, name, kind: 'climax', color: 'yellow', triggers });
const memo = (id: string, name: string, triggers?: readonly TriggerIcon[]): CardDef => ({
  id,
  name,
  kind: 'event',
  color: 'yellow',
  level: 0,
  cost: 0,
  ...(triggers === undefined ? {} : { triggers }),
});

const extra: CardDef[] = [
  unit('NOICON', 'Quiet Courier'), // no triggers field at all
  unit('EMPTYICON', 'Blank Courier', []), // an explicitly empty icon list
  memo('EVNOICON', 'Plain Memo'),
  unit('DRAWK', 'Letter Carrier', ['draw']),
  unit('POOLK', 'Supply Runner', ['pool']),
  unit('COMEK', 'Field Medic', ['comeback']),
  unit('TREAK', 'Lucky Scavenger', ['treasure']),
  unit('SOULK', 'Bright Vanguard', ['soul']),
  unit('SDK', 'Bright Herald', ['draw', 'soul']),
  memo('SOULE', 'Bright Memo', ['soul']),
  memo('DRAWE', 'Dispatch Note', ['draw']),
  unit('R2', 'Crimson Lancer', undefined, { color: 'red', level: 2, cost: 2, power: 7500 }),
  burst('SOUL2X', 'Twin Sunrise', ['soul', 'soul']),
  burst('RETX', 'Recall Wind', ['return']),
  burst('SHOTX', 'Echo Volley', ['shot']),
  burst('TREAX', 'Buried Cache', ['treasure']),
  burst('GATEX', 'Open Gate', ['gate']),
  burst('STBYX', 'Reserve Call', ['standby']),
  burst('CHOX', 'Crossroads', ['choice']),
  burst('DPX', 'Supply Drop', ['draw', 'pool']),
  burst('DPCX', 'Triple Signal', ['draw', 'pool', 'comeback']),
  burst('TSX', 'Golden Charge', ['treasure', 'soul']),
];

const cat: CardCatalog = { ...catalog, ...Object.fromEntries(extra.map((d) => [d.id, d])) };

// --- Helpers -----------------------------------------------------------------

/** Plain cards (no icons, not climaxes) so nobody decks out and no damage is canceled by accident. */
const FILL = ['G0', 'G0', 'G0', 'G0', 'G0', 'G0'];

/**
 * The attacking player's default stage: Y1 (soul 1) attacks from position 1;
 * Y0 on position 2 stays standing so the engine stops at the next attack
 * decision instead of running on into the next turn.
 */
const ATTACKERS = { 1: 'Y1', 2: 'Y0' } as const;

/** Player 0 attacks (unless `active` says otherwise); zones as given, bottom -> top. */
function attackPhase(p0: ZoneSpec, p1: ZoneSpec, active: PlayerId = 0): GameState {
  return makeState(cat, { players: [p0, p1], start: 'attack', active });
}

/** Player 0 with the default attackers and `top` as the card its trigger check will reveal. */
function withTop(top: string, p0: ZoneSpec = {}, p1: ZoneSpec = {}): GameState {
  return attackPhase({ deck: [...FILL, top], stage: ATTACKERS, ...p0 }, { deck: [...FILL], ...p1 });
}

interface Step {
  state: GameState;
  events: GameEvent[];
}

/** Applies one action and throws with the engine's reason if it is refused. */
function go(s: GameState, action: Action, c: CardCatalog = cat): Step {
  const r = applyAction(s, c, action);
  if (!r.ok) throw new Error(`${action.type} rejected: ${r.error.code} ${r.error.message}`);
  return { state: r.state, events: r.events };
}

/** Applies several actions, returning the final state and every event along the way. */
function goAll(s: GameState, actions: readonly Action[], c: CardCatalog = cat): Step {
  let state = s;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = go(state, a, c);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events };
}

const attack = (s: GameState, kind: AttackType = 'direct', slot: Slot = 1, player: PlayerId = s.active): Step =>
  go(s, { type: 'ATTACK', player, slot, attack: kind });

const defOfId = (s: GameState, id: CardId | null): string => (id === null ? '-' : (s.cards[id]?.def ?? '?'));

/** The milestones of the Attack Phase that the trigger rules order, with cards shown by definition id. */
function trace(s: GameState, events: readonly GameEvent[]): string[] {
  return events.flatMap((e): string[] => {
    if (e.kind === 'step') return [`step:${e.step}`];
    if (e.kind === 'trigger') return [`trigger:${e.condition}`];
    if (e.kind === 'checkTiming') return ['check'];
    if (e.kind === 'move') return [`move:${e.reason}:${defOfId(s, e.card)}:${e.from.zone}->${e.to.zone}`];
    if (e.kind === 'triggerCheck') return [`triggerCheck:${defOfId(s, e.card)}:${e.icons.length > 0 ? e.icons.join('+') : 'none'}`];
    if (e.kind === 'icon') return [`icon:${e.icon}`];
    if (e.kind === 'modifier') return [`modifier:${defOfId(s, e.card)}:${e.stat}:${e.amount}`];
    if (e.kind === 'damage') return [`damage:${e.target}:${e.amount}`];
    if (e.kind === 'damageCanceled' || e.kind === 'damageTaken') return [e.kind];
    if (e.kind === 'auto') return [`auto:${e.ability}`];
    if (e.kind === 'ruleAction') return [`rule:${e.rule}:${e.cards.map((c) => defOfId(s, c)).join(',')}`];
    if (e.kind === 'playTiming') return [`playTiming:${e.player}:${e.window}`];
    return [];
  });
}

/** The trace of one Trigger Step: from its 'step:trigger' up to and including the next step it leads to. */
function triggerStep(s: GameState, events: readonly GameEvent[]): string[] {
  const t = trace(s, events);
  const start = t.indexOf('step:trigger');
  if (start < 0) throw new Error('no Trigger Step in these events');
  const next = t.findIndex((x, i) => i > start && x.startsWith('step:'));
  return next < 0 ? t.slice(start) : t.slice(start, next + 1);
}

const iconsDone = (events: readonly GameEvent[]): TriggerIcon[] =>
  events.flatMap((e) => (e.kind === 'icon' ? [e.icon] : []));

/** Definitions on each stage position with orientation, e.g. 'Y2:rest'. Index i is position i + 1. */
function stageOf(s: GameState, player: PlayerId): string[][] {
  return s.players[player].stage.map((cards) => cards.map((c) => `${defOfId(s, c.id)}:${c.orientation}`));
}

const sorted = <T>(xs: readonly T[]): T[] => [...xs].sort();

// =============================================================================
// CARD-18 / ZONE-13 / ZONE-37: the revealed card and the resolution zone
// =============================================================================

describe('the trigger check card', () => {
  it('[CARD-18] the icons printed on the revealed card decide which trigger actions happen', () => {
    // Same attack, three different top cards: the actions follow the card's icons and nothing else.
    const none = attack(withTop('NOICON'));
    expect(iconsDone(none.events)).toEqual([]);
    expect(none.state.pending).toEqual({ kind: 'attack', player: 0 });

    const soul = attack(withTop('YX'));
    expect(iconsDone(soul.events)).toEqual(['soul']);
    expect(trace(soul.state, soul.events)).toContain('modifier:Y1:soul:1');

    const draw = attack(withTop('DRAWK'));
    expect(iconsDone(draw.events)).toEqual(['draw']);
    expect(draw.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'draw' });

    // Two icons on one card: both are carried out, one action each.
    const two = goAll(withTop('DPX'), [
      { type: 'ATTACK', player: 0, slot: 1, attack: 'direct' },
      { type: 'ORDER_ICON', player: 0, icon: 'pool' },
      { type: 'PASS', player: 0 },
      { type: 'PASS', player: 0 },
    ]);
    expect(iconsDone(two.events)).toEqual(['pool', 'draw']);
  });

  it('[CARD-18] icons do nothing on a card revealed outside the Trigger Step, such as a damage card', () => {
    // Player 1's damage reveals a treasure card and then a draw card. Neither icon is carried out:
    // no icon event, no prompt, and the treasure card does not go to its owner's hand.
    const s = withTop('NOICON', {}, { deck: [...FILL, 'DRAWK', 'TREAK'] });
    const r = attack(s);
    expect(trace(r.state, r.events).filter((x) => x.startsWith('icon:'))).toEqual([]);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(r.state, 1, 'clock')).toEqual(['TREAK', 'DRAWK']);
    expect(defsIn(r.state, 1, 'hand')).toEqual([]);
    expect(defsIn(r.state, 1, 'stock')).toEqual([]);
  });

  it('[ZONE-13] the trigger check takes the top card of the deck and puts it face up in the resolution zone', () => {
    const s = attackPhase({ deck: ['G0', 'B0', 'DRAWK'], stage: ATTACKERS }, { deck: [...FILL] });
    const top = cardIn(s, 0, 'deck', 'DRAWK');
    const r = attack(s);

    // Paused on the draw prompt, the revealed card is in the resolution zone and the rest of the deck is untouched.
    expect(r.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'draw' });
    expect(r.state.players[0].resolution).toEqual([top]);
    expect(defsIn(r.state, 0, 'deck')).toEqual(['G0', 'B0']);
    const reveal = r.events.filter((e) => e.kind === 'move' && e.card === top);
    expect(reveal).toEqual([expect.objectContaining({ from: { player: 0, zone: 'deck' }, to: { player: 0, zone: 'resolution' }, reason: 'triggerCheck' })]);

    // Face up: both players see which card it is, in the zone and in the event stream.
    for (const viewer of [0, 1] as const) {
      expect(projectView(r.state, viewer).players[0].resolution).toEqual([{ id: top, def: 'DRAWK' }]);
      const seen = projectEvents(r.events, viewer).filter((e) => e.kind === 'move' && e.to.zone === 'resolution');
      expect(seen.map((e) => (e.kind === 'move' ? e.card : null))).toEqual([top]);
    }
  });

  it('[ZONE-13] cards flipped from the deck by damage also pass through the resolution zone, one at a time', () => {
    const s = withTop('NOICON', {}, { deck: ['G0', 'G0', 'B0', 'R0'] });
    const r = attack(s);
    const damage = trace(r.state, r.events).filter((x) => x.startsWith('move:damage'));
    // Each card is revealed into the resolution zone; only after both are revealed do they go to the clock.
    expect(damage).toEqual([
      'move:damage:R0:deck->resolution',
      'move:damage:B0:deck->resolution',
      'move:damageToClock:R0:resolution->clock',
      'move:damageToClock:B0:resolution->clock',
    ]);
  });

  it("[ZONE-37] the checked card stays in the resolution zone while its icon resolves, then goes face down on top of its owner's stock", () => {
    const s = withTop('DRAWK', { stock: ['B0', 'B0'] });
    const checked = cardIn(s, 0, 'deck', 'DRAWK');
    const r = attack(s);
    expect(r.state.players[0].resolution).toEqual([checked]);
    expect(defsIn(r.state, 0, 'stock')).toEqual(['B0', 'B0']);

    for (const answer of ['ACCEPT', 'PASS'] as const) {
      const done = go(r.state, { type: answer, player: 0 });
      expect(done.state.players[0].resolution).toEqual([]);
      // On top of the stock that was already there.
      expect(done.state.players[0].stock).toEqual([...r.state.players[0].stock, checked]);
      const toStock = done.events.filter((e) => e.kind === 'move' && e.card === checked);
      expect(toStock).toEqual([
        expect.objectContaining({ from: { player: 0, zone: 'resolution' }, to: { player: 0, zone: 'stock' }, reason: 'triggerToStock' }),
      ]);
      // The icon's action (the draw, if taken) happens before the card leaves the resolution zone.
      const t = trace(done.state, done.events);
      const stockAt = t.indexOf('move:triggerToStock:DRAWK:resolution->stock');
      expect(stockAt).toBeGreaterThanOrEqual(0);
      if (answer === 'ACCEPT') expect(t.indexOf('move:draw:G0:deck->hand')).toBeLessThan(stockAt);
      // Face down: neither player is shown which card went to stock.
      for (const viewer of [0, 1] as const) {
        const view = projectView(done.state, viewer).players[0];
        expect(view.counts.stock).toBe(3);
        expect(JSON.stringify(view)).not.toContain(checked);
        const seen = projectEvents(done.events, viewer).filter((e) => e.kind === 'move' && e.to.zone === 'stock');
        expect(seen.map((e) => (e.kind === 'move' ? e.card : null))).toEqual([HIDDEN]);
      }
    }
  });

  it("[ZONE-37] the checked card goes to its owner's stock, not the turn player's, when the two differ", () => {
    // A card owned by player 1 is put on top of player 0's deck, so player 0's trigger check reveals it.
    const s = withTop('NOICON', {}, { hand: ['B1'] });
    const foreign = cardIn(s, 1, 'hand', 'B1');
    ops.moveCard(s, foreign, { player: 0, zone: 'deck' }, 'effect');
    const r = attack(s);
    expect(r.events.filter((e) => e.kind === 'triggerCheck')).toEqual([expect.objectContaining({ player: 0, card: foreign })]);
    const moves = r.events.filter((e) => e.kind === 'move' && e.card === foreign);
    expect(moves.map((e) => (e.kind === 'move' ? [e.reason, e.to] : null))).toEqual([
      ['triggerCheck', { player: 0, zone: 'resolution' }],
      ['triggerToStock', { player: 1, zone: 'stock' }],
    ]);
    expect(r.state.players[1].stock).toEqual([foreign]);
    expect(defsIn(r.state, 0, 'stock')).toEqual([]);
  });
});

// =============================================================================
// TRG: what each trigger icon does (CR 4.12)
// =============================================================================

describe('TRG: trigger icon actions', () => {
  it('[TRG-01] the turn player carries out the icon actions: with player 1 attacking, player 1 gets every prompt and uses their own deck', () => {
    const s = attackPhase({ deck: [...FILL], hand: ['B1'] }, { deck: ['G0', 'B0', 'R0', 'DPX'], stage: ATTACKERS }, 1);
    expect(s.pending).toEqual({ kind: 'attack', player: 1 });
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'iconOrder', player: 1, icons: ['draw', 'pool'] });

    // Player 0 has nothing to decide and cannot answer for player 1.
    expect(legalActions(r.state, cat, 0)).toEqual([]);
    expect(validate(r.state, cat, { type: 'ORDER_ICON', player: 0, icon: 'draw' })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_DECISION' } });

    const a = go(r.state, { type: 'ORDER_ICON', player: 1, icon: 'draw' });
    expect(a.state.pending).toEqual({ kind: 'confirm', player: 1, reason: 'draw' });
    expect(validate(a.state, cat, { type: 'ACCEPT', player: 0 })).toMatchObject({ ok: false, error: { code: 'NOT_YOUR_DECISION' } });
    const b = go(a.state, { type: 'ACCEPT', player: 1 });
    expect(b.state.pending).toEqual({ kind: 'confirm', player: 1, reason: 'pool' });
    const c = go(b.state, { type: 'ACCEPT', player: 1 });

    // Player 1's deck fed player 1's hand and stock; player 0's zones are untouched.
    expect(defsIn(c.state, 1, 'hand')).toEqual(['R0']);
    expect(defsIn(c.state, 1, 'stock')).toEqual(['B0', 'DPX']);
    expect(defsIn(c.state, 0, 'hand')).toEqual(['B1']);
    expect(defsIn(c.state, 0, 'stock')).toEqual([]);
    const performers = [...r.events, ...a.events, ...b.events, ...c.events].flatMap((e) => (e.kind === 'icon' || e.kind === 'triggerCheck' ? [`${e.kind}:${e.player}`] : []));
    expect(performers).toEqual(['triggerCheck:1', 'icon:1', 'icon:1']);
  });

  it('[TRG-02] a revealed card without trigger icons does nothing: no action, no prompt, straight to stock', () => {
    for (const top of ['NOICON', 'EMPTYICON', 'EVNOICON']) {
      const s = withTop(top, { hand: ['B1'], waiting: ['Y2'] }, { stage: { 4: 'B0' } });
      const r = attack(s);
      expect(triggerStep(r.state, r.events)).toEqual([
        'step:trigger',
        'trigger:triggerStepStart',
        'check',
        `move:triggerCheck:${top}:deck->resolution`,
        `triggerCheck:${top}:none`,
        `move:triggerToStock:${top}:resolution->stock`,
        'check',
        'step:damage',
      ]);
      // Only the Direct Attack bonus touched the attacker's soul, so 2 damage was dealt.
      expect(trace(r.state, r.events).filter((x) => x.startsWith('modifier:') || x.startsWith('damage:'))).toEqual(['modifier:Y1:soul:1', 'damage:1:2']);
      expect(defsIn(r.state, 0, 'stock')).toEqual([top]);
      expect(defsIn(r.state, 0, 'hand')).toEqual(['B1']);
      expect(defsIn(r.state, 0, 'waiting')).toEqual(['Y2']);
      expect(stageOf(r.state, 1)[3]).toEqual(['B0:stand']);
      expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
    }
  });

  it('[TRG-03] a soul icon gives the attacker +1 soul with no chance to decline, and it lasts until the end of the turn', () => {
    const s = withTop('YX', {}, { stage: { 3: 'R0' } });
    const attacker = cardIn(s, 0, 'stage', 'Y1');
    const other = cardIn(s, 0, 'stage', 'Y0');
    const r = attack(s, 'frontal');

    // No decision for player 0 anywhere in the Trigger Step: the next decision is player 1's Counter Step.
    expect(r.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });
    expect(triggerStep(r.state, r.events)).toEqual([
      'step:trigger',
      'trigger:triggerStepStart',
      'check',
      'move:triggerCheck:YX:deck->resolution',
      'triggerCheck:YX:soul',
      'icon:soul',
      'modifier:Y1:soul:1',
      'move:triggerToStock:YX:resolution->stock',
      'check',
      'step:counter',
    ]);
    expect(currentSoul(r.state, cat, attacker)).toBe(2);
    expect(currentSoul(r.state, cat, other)).toBe(1); // only the attacking character
    expect(currentSoul(r.state, cat, cardIn(r.state, 1, 'stage', 'R0'))).toBe(1);

    // The extra soul is real: the attack deals 2 damage.
    const d = go(r.state, { type: 'PASS', player: 1 });
    expect(trace(d.state, d.events).filter((x) => x.startsWith('damage:'))).toEqual(['damage:1:2']);
    expect(currentSoul(d.state, cat, attacker)).toBe(2);

    // After the turn ends the attacker is back to its printed soul.
    expect(d.state.pending).toEqual({ kind: 'attack', player: 0 });
    const next = go(d.state, { type: 'PASS', player: 0 });
    expect(next.state.active).toBe(1);
    expect(next.events.some((e) => e.kind === 'effectsExpired')).toBe(true);
    expect(currentSoul(next.state, cat, attacker)).toBe(1);
  });

  it('[TRG-03] two soul icons on one card give +1 soul twice', () => {
    const s = withTop('SOUL2X', {}, { stage: { 3: 'R0' } });
    const r = attack(s, 'frontal');
    expect(iconsDone(r.events)).toEqual(['soul', 'soul']);
    expect(trace(r.state, r.events).filter((x) => x.startsWith('modifier:'))).toEqual(['modifier:Y1:soul:1', 'modifier:Y1:soul:1']);
    expect(currentSoul(r.state, cat, cardIn(r.state, 0, 'stage', 'Y1'))).toBe(3);
  });

  it("[TRG-04] a return icon offers any one character on the opponent's stage (optional); the chosen one goes to its owner's hand", () => {
    const p1: ZoneSpec = { stage: { 2: { def: 'R1', orientation: 'rest' }, 3: 'R0', 4: 'B0' } };
    const s = withTop('RETX', {}, p1);
    const r = attack(s, 'frontal');
    const theirs = [cardIn(s, 1, 'stage', 'R1'), cardIn(s, 1, 'stage', 'R0'), cardIn(s, 1, 'stage', 'B0')];
    expect(r.state.pending).toMatchObject({ kind: 'choose', player: 0, reason: 'return', optional: true });
    // Every opponent character (center or back, standing or rested) and none of the attacker's own.
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted(theirs));
    expect(legalActions(r.state, cat)).toEqual(
      expect.arrayContaining([{ type: 'PASS', player: 0 }, ...theirs.map((card) => ({ type: 'CHOOSE_CARD', player: 0, card }))]),
    );
    expect(legalActions(r.state, cat)).toHaveLength(4);

    // Choosing the rested center character sends it to player 1's hand.
    const chosen = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 1, 'stage', 'R1') });
    expect(defsIn(chosen.state, 1, 'hand')).toEqual(['R1']);
    expect(stageOf(chosen.state, 1)).toEqual([[], [], ['R0:stand'], ['B0:stand'], []]);
    expect(trace(chosen.state, chosen.events).slice(0, 2)).toEqual(['move:icon:R1:stage->hand', 'move:triggerToStock:RETX:resolution->stock']);

    // Declining moves nothing.
    const declined = go(r.state, { type: 'PASS', player: 0 });
    expect(stageOf(declined.state, 1)).toEqual([[], ['R1:rest'], ['R0:stand'], ['B0:stand'], []]);
    expect(defsIn(declined.state, 1, 'hand')).toEqual([]);
    expect(trace(declined.state, declined.events)[0]).toBe('move:triggerToStock:RETX:resolution->stock');
  });

  it("[TRG-04] the returned character goes to its owner's hand even when the opponent is only its master; no opponent character means no prompt", () => {
    // A card owned by player 0 sits on player 1's stage, so player 1 is its master.
    const s = withTop('RETX', { waiting: ['B1'] });
    const borrowed = cardIn(s, 0, 'waiting', 'B1');
    ops.moveCard(s, borrowed, { player: 1, zone: 'stage', slot: 5 }, 'effect');
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'choose', player: 0, reason: 'return', options: [borrowed], optional: true });
    const done = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: borrowed });
    expect(defsIn(done.state, 0, 'hand')).toEqual(['B1']);
    expect(defsIn(done.state, 1, 'hand')).toEqual([]);

    // With no character on the opponent's stage there is nothing to choose and play goes on.
    const empty = attack(withTop('RETX'));
    expect(iconsDone(empty.events)).toEqual(['return']);
    expect(triggerStep(empty.state, empty.events).slice(-4)).toEqual(['icon:return', 'move:triggerToStock:RETX:resolution->stock', 'check', 'step:damage']);
  });

  it("[TRG-05] a pool icon offers to put the top card of the turn player's own deck into stock; declining moves nothing", () => {
    const s = attackPhase({ deck: ['G0', 'B0', 'POOLK'], stage: ATTACKERS }, { deck: [...FILL] });
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'pool' });
    expect(legalActions(r.state, cat)).toEqual([
      { type: 'ACCEPT', player: 0 },
      { type: 'PASS', player: 0 },
    ]);

    const yes = go(r.state, { type: 'ACCEPT', player: 0 });
    expect(trace(yes.state, yes.events).slice(0, 2)).toEqual(['move:icon:B0:deck->stock', 'move:triggerToStock:POOLK:resolution->stock']);
    expect(defsIn(yes.state, 0, 'stock')).toEqual(['B0', 'POOLK']);
    expect(defsIn(yes.state, 0, 'deck')).toEqual(['G0']);
    expect(defsIn(yes.state, 1, 'stock')).toEqual([]);

    const no = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(no.state, 0, 'stock')).toEqual(['POOLK']);
    expect(defsIn(no.state, 0, 'deck')).toEqual(['G0', 'B0']);
  });

  it("[TRG-06] a comeback icon offers only the characters in the turn player's own waiting room; the chosen one goes to hand", () => {
    const s = withTop('COMEK', { waiting: ['Y0', 'YE0', 'YX', 'R1'] }, { waiting: ['B0'] });
    const r = attack(s);
    const options = [cardIn(s, 0, 'waiting', 'Y0'), cardIn(s, 0, 'waiting', 'R1')];
    expect(r.state.pending).toMatchObject({ kind: 'choose', player: 0, reason: 'comeback', optional: true });
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted(options));

    const chosen = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'R1') });
    expect(defsIn(chosen.state, 0, 'hand')).toEqual(['R1']);
    expect(defsIn(chosen.state, 0, 'waiting')).toEqual(['Y0', 'YE0', 'YX']);
    expect(trace(chosen.state, chosen.events)[0]).toBe('move:icon:R1:waiting->hand');

    const declined = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(declined.state, 0, 'hand')).toEqual([]);
    expect(defsIn(declined.state, 0, 'waiting')).toEqual(['Y0', 'YE0', 'YX', 'R1']);

    // Only an event and a climax in the waiting room: no prompt.
    const none = attack(withTop('COMEK', { waiting: ['YE0', 'YX'] }, { waiting: ['B0'] }));
    expect(iconsDone(none.events)).toEqual(['comeback']);
    expect(none.state.pending).toEqual({ kind: 'attack', player: 0 });
    expect(defsIn(none.state, 0, 'hand')).toEqual([]);
  });

  it('[TRG-07] a draw icon offers one optional draw', () => {
    const s = attackPhase({ deck: ['G0', 'B0', 'DRAWK'], hand: ['Y3'], stage: ATTACKERS }, { deck: [...FILL] });
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'draw' });

    const yes = go(r.state, { type: 'ACCEPT', player: 0 });
    expect(defsIn(yes.state, 0, 'hand')).toEqual(['Y3', 'B0']);
    expect(defsIn(yes.state, 0, 'deck')).toEqual(['G0']);
    expect(trace(yes.state, yes.events).filter((x) => x.includes('->hand'))).toEqual(['move:draw:B0:deck->hand']);

    const no = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(no.state, 0, 'hand')).toEqual(['Y3']);
    expect(defsIn(no.state, 0, 'deck')).toEqual(['G0', 'B0']);
  });

  it("[TRG-08] shot: when the attacker's damage is canceled, the opponent takes 1 more damage as an automatic ability", () => {
    // Player 1's top card is a climax, so the attack's damage is canceled; the next card is plain.
    const s = withTop('SHOTX', {}, { deck: ['G0', 'G0', 'B0', 'YX'] });
    const r = attack(s);
    expect(iconsDone(r.events)).toEqual(['shot']);
    const t = trace(r.state, r.events);
    const from = t.indexOf('step:damage');
    expect(t.slice(from, from + 14)).toEqual([
      'step:damage',
      'trigger:damageStepStart',
      'check',
      'damage:1:2',
      'move:damage:YX:deck->resolution',
      'move:damageCancel:YX:resolution->waiting',
      'damageCanceled',
      'check',
      'auto:shot',
      'damage:1:1',
      'move:damage:B0:deck->resolution',
      'move:damageToClock:B0:resolution->clock',
      'damageTaken',
      'trigger:attackEnd',
    ]);
    expect(defsIn(r.state, 1, 'clock')).toEqual(['B0']);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['YX']);
    expect(r.events.filter((e) => e.kind === 'auto')).toEqual([expect.objectContaining({ player: 0, ability: 'shot' })]);
  });

  it('[TRG-08] shot does nothing when the damage is not canceled, and it never fires for another character', () => {
    // First attack (with shot): 2 plain cards, not canceled. Second attack by Y0: a climax cancels it.
    // (The G0s are left for player 1's next turn, which this runs into.)
    const s = withTop('SHOTX', {}, { deck: ['G0', 'G0', 'G0', 'YX', 'B0', 'B0'] });
    const first = attack(s);
    expect(iconsDone(first.events)).toEqual(['shot']);
    expect(trace(first.state, first.events).filter((x) => x.startsWith('damage'))).toEqual(['damage:1:2', 'damageTaken']);
    const second = attack(first.state, 'direct', 2);
    expect(iconsDone(second.events)).toEqual([]);
    expect(trace(second.state, second.events).filter((x) => x.startsWith('damage') || x.startsWith('auto'))).toEqual(['damage:1:2', 'damageCanceled']);
    expect(defsIn(second.state, 1, 'clock')).toEqual(['B0', 'B0']);
    expect(defsIn(second.state, 1, 'waiting')).toEqual(['YX']);
  });

  it("[TRG-08] shot's extra damage is an ordinary damage process: it can be canceled too, and that does not fire shot again", () => {
    const s = withTop('SHOTX', {}, { deck: ['G0', 'G0', 'YX', 'RX'] });
    const r = attack(s);
    expect(trace(r.state, r.events).filter((x) => x.startsWith('damage') || x.startsWith('auto'))).toEqual([
      'damage:1:2',
      'damageCanceled',
      'auto:shot',
      'damage:1:1',
      'damageCanceled',
    ]);
    expect(defsIn(r.state, 1, 'waiting')).toEqual(['RX', 'YX']);
    expect(defsIn(r.state, 1, 'clock')).toEqual([]);
    expect(r.state.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[TRG-12] treasure: the card goes to its owner\'s hand without asking, then the deck top may go to stock; the card never goes to stock', () => {
    const s = attackPhase({ deck: ['G0', 'B0', 'TREAX'], stage: ATTACKERS }, { deck: [...FILL] });
    const treasure = cardIn(s, 0, 'deck', 'TREAX');
    const r = attack(s);
    // Before any decision the card is already in hand.
    expect(triggerStep(r.state, r.events)).toEqual([
      'step:trigger',
      'trigger:triggerStepStart',
      'check',
      'move:triggerCheck:TREAX:deck->resolution',
      'triggerCheck:TREAX:treasure',
      'icon:treasure',
      'move:icon:TREAX:resolution->hand',
    ]);
    expect(r.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'treasure' });
    expect(r.state.players[0].hand).toEqual([treasure]);
    expect(r.state.players[0].resolution).toEqual([]);

    const yes = go(r.state, { type: 'ACCEPT', player: 0 });
    expect(triggerStep(yes.state, [...r.events, ...yes.events]).slice(7)).toEqual(['move:icon:B0:deck->stock', 'check', 'step:damage']);
    expect(defsIn(yes.state, 0, 'stock')).toEqual(['B0']);
    expect(yes.state.players[0].hand).toEqual([treasure]);
    expect(defsIn(yes.state, 0, 'deck')).toEqual(['G0']);

    const no = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(no.state, 0, 'stock')).toEqual([]);
    expect(no.state.players[0].hand).toEqual([treasure]);
    expect(defsIn(no.state, 0, 'deck')).toEqual(['G0', 'B0']);
    expect(no.events.some((e) => e.kind === 'move' && e.reason === 'triggerToStock')).toBe(false);
  });

  it("[TRG-13] a gate icon offers only the climaxes in the turn player's own waiting room; the chosen one goes to hand", () => {
    const s = withTop('GATEX', { waiting: ['YX', 'Y0', 'YE0', 'BX'] }, { waiting: ['RX'] });
    const r = attack(s);
    const options = [cardIn(s, 0, 'waiting', 'YX'), cardIn(s, 0, 'waiting', 'BX')];
    expect(r.state.pending).toMatchObject({ kind: 'choose', player: 0, reason: 'gate', optional: true });
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted(options));

    const chosen = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'BX') });
    expect(defsIn(chosen.state, 0, 'hand')).toEqual(['BX']);
    expect(defsIn(chosen.state, 0, 'waiting')).toEqual(['YX', 'Y0', 'YE0']);
    expect(trace(chosen.state, chosen.events)[0]).toBe('move:icon:BX:waiting->hand');

    const declined = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(declined.state, 0, 'hand')).toEqual([]);
    expect(defsIn(declined.state, 0, 'waiting')).toEqual(['YX', 'Y0', 'YE0', 'BX']);

    // No climax of their own in the waiting room: no prompt.
    const none = attack(withTop('GATEX', { waiting: ['Y0', 'YE0'] }, { waiting: ['RX'] }));
    expect(iconsDone(none.events)).toEqual(['gate']);
    expect(none.state.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it("[TRG-14] a standby icon offers own waiting-room characters up to the player's level + 1, with no color or cost check, and puts one rested on any position", () => {
    // Level 1, no stock, no red card in level or clock.
    const p0: ZoneSpec = { level: ['Y0'], waiting: ['Y0', 'Y1', 'Y2', 'Y3', 'R2', 'YE0', 'YX'] };
    const s = withTop('STBYX', p0, { waiting: ['Y0'] });
    const r = attack(s);
    const eligible = ['Y0', 'Y1', 'Y2', 'R2'].map((d) => cardIn(s, 0, 'waiting', d));
    expect(r.state.pending).toMatchObject({ kind: 'choose', player: 0, reason: 'standby', optional: true });
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted(eligible));

    // A level 2, cost 2 red character: level 1 + 1, unaffordable and off-color, yet allowed.
    const picked = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'R2') });
    expect(picked.state.pending).toEqual({ kind: 'chooseSlot', player: 0, card: cardIn(s, 0, 'waiting', 'R2'), options: [1, 2, 3, 4, 5] });
    for (const slot of [3, 5] as const) {
      const placed = go(picked.state, { type: 'CHOOSE_SLOT', player: 0, slot });
      expect(stageOf(placed.state, 0)[slot - 1]).toEqual(['R2:rest']);
      expect(trace(placed.state, placed.events)[0]).toBe(`move:icon:R2:waiting->stage`);
      // No cost was paid: the only stock card is the trigger card itself.
      expect(defsIn(placed.state, 0, 'stock')).toEqual(['STBYX']);
      expect(defsIn(placed.state, 0, 'waiting')).toEqual(['Y0', 'Y1', 'Y2', 'Y3', 'YE0', 'YX']);
    }

    const declined = go(r.state, { type: 'PASS', player: 0 });
    expect(stageOf(declined.state, 0)).toEqual([['Y1:rest'], ['Y0:stand'], [], [], []]);
    expect(defsIn(declined.state, 0, 'waiting')).toEqual(['Y0', 'Y1', 'Y2', 'Y3', 'R2', 'YE0', 'YX']);
  });

  it('[TRG-14] at level 0 standby reaches level 1 characters but not level 2', () => {
    const s = withTop('STBYX', { waiting: ['Y0', 'Y1', 'Y2'] });
    const r = attack(s);
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted([cardIn(s, 0, 'waiting', 'Y0'), cardIn(s, 0, 'waiting', 'Y1')]));

    // Only characters above the limit: nothing to choose, no prompt.
    const none = attack(withTop('STBYX', { waiting: ['Y2', 'Y3'] }));
    expect(iconsDone(none.events)).toEqual(['standby']);
    expect(none.state.pending).toEqual({ kind: 'attack', player: 0 });
  });

  it('[TRG-15] standby may target an occupied position; the character already there goes to the waiting room by the multiple-characters rule action', () => {
    const p0: ZoneSpec = { level: ['Y0'], waiting: ['Y2'], stage: { ...ATTACKERS, 4: 'B0' } };
    const s = withTop('STBYX', p0);
    const r = attack(s);
    const picked = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'Y2') });
    if (picked.state.pending?.kind !== 'chooseSlot') throw new Error('expected a position prompt');
    expect(picked.state.pending.options).toEqual([1, 2, 3, 4, 5]); // occupied positions included

    const placed = go(picked.state, { type: 'CHOOSE_SLOT', player: 0, slot: 4 });
    expect(trace(placed.state, placed.events).slice(0, 6)).toEqual([
      'move:icon:Y2:waiting->stage',
      'move:triggerToStock:STBYX:resolution->stock',
      'check',
      'rule:extraCards:B0',
      'move:ruleAction:B0:stage->waiting',
      'step:damage',
    ]);
    expect(stageOf(placed.state, 0)[3]).toEqual(['Y2:rest']);
    expect(defsIn(placed.state, 0, 'waiting')).toEqual(['B0']);

    // Even the attacker's own position may be chosen: the attacker is the one placed earlier, so it leaves.
    const onAttacker = go(picked.state, { type: 'CHOOSE_SLOT', player: 0, slot: 1 });
    expect(stageOf(onAttacker.state, 0)[0]).toEqual(['Y2:rest']);
    expect(defsIn(onAttacker.state, 0, 'waiting')).toEqual(['Y1']);
    expect(trace(onAttacker.state, onAttacker.events)).toContain('rule:extraCards:Y1');
  });

  it("[TRG-16] a choice icon offers own waiting-room characters with a soul trigger icon, then sends the chosen one to hand or stock", () => {
    const p0: ZoneSpec = { waiting: ['SOULK', 'SDK', 'DRAWK', 'YX', 'Y0', 'SOULE'] };
    const s = withTop('CHOX', p0, { waiting: ['SOULK'] });
    const r = attack(s);
    const eligible = [cardIn(s, 0, 'waiting', 'SOULK'), cardIn(s, 0, 'waiting', 'SDK')];
    expect(r.state.pending).toMatchObject({ kind: 'choose', player: 0, reason: 'choice', optional: true });
    expect(sorted(r.state.pending?.kind === 'choose' ? r.state.pending.options : [])).toEqual(sorted(eligible));

    const sdk = cardIn(s, 0, 'waiting', 'SDK');
    const picked = go(r.state, { type: 'CHOOSE_CARD', player: 0, card: sdk });
    expect(picked.state.pending).toEqual({ kind: 'chooseDest', player: 0, card: sdk, options: ['hand', 'stock'] });
    expect(legalActions(picked.state, cat)).toEqual([
      { type: 'CHOOSE_DEST', player: 0, dest: 'hand' },
      { type: 'CHOOSE_DEST', player: 0, dest: 'stock' },
    ]);
    const toHand = go(picked.state, { type: 'CHOOSE_DEST', player: 0, dest: 'hand' });
    expect(defsIn(toHand.state, 0, 'hand')).toEqual(['SDK']);
    expect(defsIn(toHand.state, 0, 'stock')).toEqual(['CHOX']);

    const toStock = goAll(r.state, [
      { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'SOULK') },
      { type: 'CHOOSE_DEST', player: 0, dest: 'stock' },
    ]);
    expect(defsIn(toStock.state, 0, 'stock')).toEqual(['SOULK', 'CHOX']);
    expect(defsIn(toStock.state, 0, 'hand')).toEqual([]);
    expect(defsIn(toStock.state, 0, 'waiting')).toEqual(['SDK', 'DRAWK', 'YX', 'Y0', 'SOULE']);

    const declined = go(r.state, { type: 'PASS', player: 0 });
    expect(defsIn(declined.state, 0, 'waiting')).toEqual(['SOULK', 'SDK', 'DRAWK', 'YX', 'Y0', 'SOULE']);
    expect(defsIn(declined.state, 0, 'stock')).toEqual(['CHOX']);

    // A soul-icon climax or event is not a character, and a character without a soul icon does not qualify.
    const none = attack(withTop('CHOX', { waiting: ['DRAWK', 'YX', 'SOULE', 'Y0'] }));
    expect(iconsDone(none.events)).toEqual(['choice']);
    expect(none.state.pending).toEqual({ kind: 'attack', player: 0 });
  });
});

// =============================================================================
// TSTEP: the Trigger Step (CR 7.3)
// =============================================================================

describe('TSTEP: the Trigger Step', () => {
  it('[TSTEP-01] the step opens with its trigger condition and a check timing, then the turn player reveals the deck top and carries out its icons', () => {
    const s = attackPhase({ deck: ['B0', 'R0', 'YX'], stage: ATTACKERS }, { deck: [...FILL] });
    const top = cardIn(s, 0, 'deck', 'YX');
    const r = attack(s);
    expect(triggerStep(r.state, r.events)).toEqual([
      'step:trigger',
      'trigger:triggerStepStart',
      'check',
      'move:triggerCheck:YX:deck->resolution',
      'triggerCheck:YX:soul',
      'icon:soul',
      'modifier:Y1:soul:1',
      'move:triggerToStock:YX:resolution->stock',
      'check',
      'step:damage',
    ]);
    const tc = r.events.filter((e) => e.kind === 'triggerCheck');
    expect(tc).toEqual([expect.objectContaining({ player: 0, card: top, icons: ['soul'] })]);
    // Only the top card was taken.
    expect(defsIn(r.state, 0, 'deck')).toEqual(['B0', 'R0']);
  });

  it('[TSTEP-02] with several different icons the turn player picks the order, and the actions happen in that order', () => {
    const s = attackPhase({ deck: ['G0', 'B0', 'R0', 'DPX'], stage: ATTACKERS }, { deck: [...FILL] });
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'iconOrder', player: 0, icons: ['draw', 'pool'] });
    expect(legalActions(r.state, cat)).toEqual([
      { type: 'ORDER_ICON', player: 0, icon: 'draw' },
      { type: 'ORDER_ICON', player: 0, icon: 'pool' },
    ]);

    // Pool first: the deck top (R0) goes to stock, then the draw takes the next card (B0).
    const poolFirst = goAll(r.state, [
      { type: 'ORDER_ICON', player: 0, icon: 'pool' },
      { type: 'ACCEPT', player: 0 },
      { type: 'ACCEPT', player: 0 },
    ]);
    expect(iconsDone(poolFirst.events)).toEqual(['pool', 'draw']);
    expect(defsIn(poolFirst.state, 0, 'stock')).toEqual(['R0', 'DPX']);
    expect(defsIn(poolFirst.state, 0, 'hand')).toEqual(['B0']);

    // Draw first: the other way round.
    const drawFirst = goAll(r.state, [
      { type: 'ORDER_ICON', player: 0, icon: 'draw' },
      { type: 'ACCEPT', player: 0 },
      { type: 'ACCEPT', player: 0 },
    ]);
    expect(iconsDone(drawFirst.events)).toEqual(['draw', 'pool']);
    expect(defsIn(drawFirst.state, 0, 'stock')).toEqual(['B0', 'DPX']);
    expect(defsIn(drawFirst.state, 0, 'hand')).toEqual(['R0']);
  });

  it('[TSTEP-02] with three different icons the player is asked again for the remaining ones until one is left', () => {
    const s = withTop('DPCX', { waiting: ['Y0'] });
    const r = attack(s);
    expect(r.state.pending?.kind).toBe('iconOrder');
    expect(sorted(r.state.pending?.kind === 'iconOrder' ? r.state.pending.icons : [])).toEqual(['comeback', 'draw', 'pool']);

    const a = goAll(r.state, [
      { type: 'ORDER_ICON', player: 0, icon: 'comeback' },
      { type: 'PASS', player: 0 },
    ]);
    expect(a.state.pending?.kind).toBe('iconOrder');
    expect(sorted(a.state.pending?.kind === 'iconOrder' ? a.state.pending.icons : [])).toEqual(['draw', 'pool']);

    const b = goAll(a.state, [
      { type: 'ORDER_ICON', player: 0, icon: 'pool' },
      { type: 'PASS', player: 0 },
    ]);
    // The last icon needs no ordering: it is offered directly.
    expect(b.state.pending).toEqual({ kind: 'confirm', player: 0, reason: 'draw' });
    expect(iconsDone([...r.events, ...a.events, ...b.events])).toEqual(['comeback', 'pool', 'draw']);
  });

  it('[TSTEP-03] the icons carried out are the ones the card had on entering the resolution zone: lost icons still happen, gained ones do not', () => {
    const base = cat.DPX as CardDef;
    const lost: CardCatalog = { ...cat, DPX: { ...base, triggers: [] } };
    const gained: CardCatalog = { ...cat, DPX: { ...base, triggers: ['draw', 'pool', 'soul'] } };
    const s = attackPhase({ deck: ['G0', 'B0', 'R0', 'DPX'], stage: ATTACKERS }, { deck: [...FILL] });
    const r = attack(s); // revealed with draw + pool
    expect(r.state.pending).toEqual({ kind: 'iconOrder', player: 0, icons: ['draw', 'pool'] });

    // The card loses both icons after it entered the resolution zone: both actions still happen.
    const afterLoss = goAll(
      r.state,
      [
        { type: 'ORDER_ICON', player: 0, icon: 'pool' },
        { type: 'ACCEPT', player: 0 },
        { type: 'ACCEPT', player: 0 },
      ],
      lost,
    );
    expect(iconsDone(afterLoss.events)).toEqual(['pool', 'draw']);
    expect(defsIn(afterLoss.state, 0, 'stock')).toEqual(['R0', 'DPX']);
    expect(defsIn(afterLoss.state, 0, 'hand')).toEqual(['B0']);

    // The card gains a soul icon after it entered the resolution zone: no soul action.
    const afterGain = goAll(
      r.state,
      [
        { type: 'ORDER_ICON', player: 0, icon: 'draw' },
        { type: 'ACCEPT', player: 0 },
        { type: 'ACCEPT', player: 0 },
      ],
      gained,
    );
    expect(iconsDone(afterGain.events)).toEqual(['draw', 'pool']);
    expect(trace(afterGain.state, [...r.events, ...afterGain.events]).filter((x) => x.startsWith('modifier:') || x.startsWith('damage:'))).toEqual([
      'modifier:Y1:soul:1', // the Direct Attack bonus only
      'damage:1:2',
    ]);
  });

  it('[TSTEP-04] after its icons the checked card goes face down into stock, whatever its card type', () => {
    for (const [top, kind] of [
      ['NOICON', 'character'],
      ['EVNOICON', 'event'],
      ['DRAWE', 'event'],
      ['BX', 'climax'],
    ] as const) {
      const s = withTop(top);
      expect(cat[top]?.kind).toBe(kind);
      const checked = cardIn(s, 0, 'deck', top);
      let step = attack(s);
      const events = [...step.events];
      if (step.state.pending?.kind === 'confirm') {
        // Still in the resolution zone while the icon's choice is open.
        expect(step.state.players[0].resolution).toEqual([checked]);
        step = go(step.state, { type: 'PASS', player: 0 });
        events.push(...step.events);
      }
      const t = triggerStep(step.state, events);
      expect(t.slice(-3)).toEqual([`move:triggerToStock:${top}:resolution->stock`, 'check', 'step:damage']);
      expect(step.state.players[0].stock).toEqual([checked]);
      expect(step.state.players[0].waiting).toEqual([]);
      expect(projectEvents(events, 1).filter((e) => e.kind === 'move' && e.to.zone === 'stock').map((e) => (e.kind === 'move' ? e.card : null))).toEqual([HIDDEN]);
    }
  });

  it('[TSTEP-04] a card that already left the resolution zone (treasure) is not put into stock, while its other icons still happen', () => {
    const s = withTop('TSX');
    const card = cardIn(s, 0, 'deck', 'TSX');
    const r = attack(s);
    expect(r.state.pending).toEqual({ kind: 'iconOrder', player: 0, icons: ['treasure', 'soul'] });
    const done = goAll(r.state, [
      { type: 'ORDER_ICON', player: 0, icon: 'treasure' },
      { type: 'PASS', player: 0 },
    ]);
    const t = triggerStep(done.state, [...r.events, ...done.events]);
    expect(t).toEqual([
      'step:trigger',
      'trigger:triggerStepStart',
      'check',
      'move:triggerCheck:TSX:deck->resolution',
      'triggerCheck:TSX:treasure+soul',
      'icon:treasure',
      'move:icon:TSX:resolution->hand',
      'icon:soul',
      'modifier:Y1:soul:1',
      'check',
      'step:damage',
    ]);
    expect(done.state.players[0].hand).toEqual([card]);
    expect(done.state.players[0].stock).toEqual([]);
    expect(trace(done.state, done.events)).toContain('damage:1:3');
  });

  it('[TSTEP-06] after the trigger check a check timing runs; a Frontal Attack then goes to the Counter Step, Direct and Side Attacks to the Damage Step', () => {
    const tail = (kind: AttackType): { t: string[]; step: Step } => {
      const s = withTop('NOICON', {}, kind === 'direct' ? {} : { stage: { 3: 'R0' } });
      const step = attack(s, kind);
      const t = trace(step.state, step.events);
      return { t: t.slice(t.indexOf('move:triggerToStock:NOICON:resolution->stock')), step };
    };

    const frontal = tail('frontal');
    expect(frontal.t.slice(0, 6)).toEqual([
      'move:triggerToStock:NOICON:resolution->stock',
      'check',
      'step:counter',
      'trigger:counterStepStart',
      'check',
      'playTiming:1:counter',
    ]);
    expect(frontal.step.state.pending).toEqual({ kind: 'play', player: 1, window: 'counter' });

    for (const kind of ['direct', 'side'] as const) {
      const r = tail(kind);
      expect(r.t.slice(0, 4)).toEqual(['move:triggerToStock:NOICON:resolution->stock', 'check', 'step:damage', 'trigger:damageStepStart']);
      expect(r.t).not.toContain('step:counter');
      expect(r.t.some((x) => x.startsWith('playTiming:'))).toBe(false);
    }
  });

  it('[TSTEP-06] that check timing is fully resolved, automatic abilities included, before the next step begins', () => {
    // Standby onto an occupied position: the rule action removes B0, whose Encore (3 stock) then waits for an answer.
    const p0: ZoneSpec = { level: ['Y0'], waiting: ['Y2'], stock: ['G0', 'G0', 'G0'], stage: { ...ATTACKERS, 4: 'B0' } };
    const s = withTop('STBYX', p0);
    const placed = goAll(attack(s).state, [
      { type: 'CHOOSE_CARD', player: 0, card: cardIn(s, 0, 'waiting', 'Y2') },
      { type: 'CHOOSE_SLOT', player: 0, slot: 4 },
    ]);
    const b0 = cardIn(s, 0, 'stage', 'B0');
    expect(placed.state.pending).toEqual({ kind: 'encore', player: 0, card: b0, slot: 4, cost: 3 });
    expect(placed.state.step).toBe('trigger');
    const t = trace(placed.state, placed.events);
    expect(t.slice(t.indexOf('move:triggerToStock:STBYX:resolution->stock'))).toEqual([
      'move:triggerToStock:STBYX:resolution->stock',
      'check',
      'rule:extraCards:B0',
      'move:ruleAction:B0:stage->waiting',
    ]);

    const declined = go(placed.state, { type: 'PASS', player: 0 });
    expect(trace(declined.state, declined.events).slice(0, 2)).toEqual(['step:damage', 'trigger:damageStepStart']);
  });
});
