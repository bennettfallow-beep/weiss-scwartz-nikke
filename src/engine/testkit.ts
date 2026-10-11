// Test support: build a game state from a readable spec and drive it.
// Used by tests only; the app goes through index.ts.

import { applyAction, blankState, instanceId } from './api/game';
import { deepClone } from './core/clone';
import { EngineFault } from './core/fault';
import { locate, moveCard } from './core/zones';
import { lookupDef } from './model/cards';
import { drawOne, queueDraws, run } from './rules/flow';
import { SLOTS } from './model/types';
import type { Action, CardCatalog, CardId, GameState, Orientation, PlayerId, Slot, TurnPhase, ZoneName } from './model/types';

type StageEntry = string | { def: string; orientation?: Orientation };

/** Zone contents as card definition ids, bottom -> top (the last entry is the top card). */
export interface ZoneSpec {
  deck?: string[];
  hand?: string[];
  waiting?: string[];
  clock?: string[];
  level?: string[];
  stock?: string[];
  memory?: string[];
  resolution?: string[];
  climax?: string[];
  /** One card per position normally; an array puts several there (to test CR 9.6.2). */
  stage?: Partial<Record<Slot, StageEntry | StageEntry[]>>;
}

export interface ScenarioSpec {
  seed?: string;
  players: [ZoneSpec, ZoneSpec];
  /** Turn player. Default 0. */
  active?: PlayerId;
  /** Starting player. Default: the active player. */
  starting?: PlayerId;
  /** Turn number. Default 2 (so first-turn rules do not apply). */
  turn?: number;
  /** Where the engine starts running: the start of a phase, or the mulligan. */
  start: TurnPhase | 'mulligan';
}

const LIST_ZONES = ['deck', 'hand', 'waiting', 'clock', 'level', 'stock', 'memory', 'resolution'] as const;

/** Builds a state from a spec and runs the engine to its first decision. */
export function makeState(catalog: CardCatalog, spec: ScenarioSpec): GameState {
  const s = blankState(spec.seed ?? 'scenario');
  s.active = spec.active ?? 0;
  s.starting = spec.starting ?? s.active;

  for (const player of [0, 1] as const) {
    const zs = spec.players[player];
    const p = s.players[player];
    let n = 0;
    const make = (def: string): CardId => {
      if (!lookupDef(catalog, def)) throw new EngineFault(`makeState: unknown card definition ${def}`);
      const id = instanceId(player, n++);
      s.cards[id] = { id, def, owner: player, epoch: 0 };
      return id;
    };
    for (const zone of LIST_ZONES) for (const def of zs[zone] ?? []) p[zone].push(make(def));
    for (const slot of SLOTS) {
      const entry = zs.stage?.[slot];
      if (entry === undefined) continue;
      for (const e of Array.isArray(entry) ? entry : [entry]) {
        const def = typeof e === 'string' ? e : e.def;
        const orientation = typeof e === 'string' ? 'stand' : (e.orientation ?? 'stand');
        s.seq += 1;
        (p.stage[slot - 1] as { id: CardId; orientation: Orientation; placedAt: number }[]).push({ id: make(def), orientation, placedAt: s.seq });
      }
    }
    for (const def of zs.climax ?? []) {
      s.seq += 1;
      p.climax.push({ id: make(def), placedAt: s.seq });
    }
    p.mulliganDone = spec.start !== 'mulligan';
  }

  if (spec.start === 'mulligan') {
    s.turn = 0;
    s.tasks = [{ t: 'mulligan', player: s.starting }, { t: 'mulligan', player: s.starting === 0 ? 1 : 0 }, { t: 'startTurn' }];
  } else {
    s.turn = spec.turn ?? 2;
    s.tasks = [{ t: 'phase', phase: spec.start }];
  }
  run(s, catalog);
  return s;
}

/** Applies actions in order; throws with the engine's message if one is illegal. */
export function act(state: GameState, catalog: CardCatalog, ...actions: Action[]): GameState {
  let s = state;
  for (const a of actions) {
    const r = applyAction(s, catalog, a);
    if (!r.ok) throw new Error(`${a.type} rejected: ${r.error.code} ${r.error.message}`);
    s = r.state;
  }
  return s;
}

/** The nth card with this definition in a zone (any stage position for 'stage'). */
export function cardIn(state: GameState, player: PlayerId, zone: ZoneName, def: string, nth = 0): CardId {
  const p = state.players[player];
  const pool: CardId[] =
    zone === 'stage' ? p.stage.flatMap((cards) => cards.map((c) => c.id)) : zone === 'climax' ? p.climax.map((c) => c.id) : [...p[zone]];
  const matches = pool.filter((id) => state.cards[id]?.def === def);
  const id = matches[nth];
  if (id === undefined) throw new Error(`no card ${def} #${nth} in player ${player}'s ${zone}`);
  return id;
}

/** Definition ids of a zone, bottom -> top. */
export function defsIn(state: GameState, player: PlayerId, zone: Exclude<ZoneName, 'stage' | 'climax'>): string[] {
  return state.players[player][zone].map((id) => state.cards[id]?.def ?? '?');
}

/** Low-level operations for tests that need to poke below the action API. They mutate their argument. */
export const ops = { deepClone, drawOne, queueDraws, moveCard, locate, run };
