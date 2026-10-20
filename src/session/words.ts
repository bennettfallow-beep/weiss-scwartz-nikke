// Words the screens use for rules terms. Plain English, no Intl (pure layer).

import type { AttackStep, CardKind, Color, Orientation, Phase, PlayerId, Slot, TriggerIcon, ZoneName } from '../engine';
import { lookupDef } from '../engine';
import type { CardSource, Memory, Seat } from './types';

export const SLOT_NAMES: Readonly<Record<Slot, string>> = { 1: 'Center left', 2: 'Center', 3: 'Center right', 4: 'Back left', 5: 'Back right' };
export const PHASE_NAMES: Readonly<Record<Phase, string>> = {
  setup: 'Setup',
  stand: 'Stand phase',
  draw: 'Draw phase',
  clock: 'Clock phase',
  main: 'Main phase',
  climax: 'Climax phase',
  attack: 'Attack phase',
  end: 'End phase',
  gameOver: 'Game over',
};
export const STEP_NAMES: Readonly<Record<AttackStep, string>> = {
  declaration: 'Attack declaration',
  trigger: 'Trigger step',
  counter: 'Counter step',
  damage: 'Damage step',
  battle: 'Battle step',
  encore: 'Encore step',
};
export const ICON_NAMES: Readonly<Record<TriggerIcon, string>> = {
  soul: 'Soul',
  return: 'Return',
  pool: 'Pool',
  comeback: 'Comeback',
  draw: 'Draw',
  shot: 'Shot',
  treasure: 'Treasure',
  gate: 'Gate',
  standby: 'Standby',
  choice: 'Choice',
};
export const COLOR_NAMES: Readonly<Record<Color, string>> = { yellow: 'Yellow', green: 'Green', red: 'Red', blue: 'Blue' };
export const KIND_NAMES: Readonly<Record<CardKind, string>> = { character: 'Character', event: 'Event', climax: 'Climax' };
export const ORIENTATION_NAMES: Readonly<Record<Orientation, string>> = { stand: 'Standing', rest: 'Rested', reverse: 'Reversed' };
export const ZONE_NAMES: Readonly<Record<ZoneName, string>> = {
  deck: 'deck',
  hand: 'hand',
  waiting: 'waiting room',
  clock: 'clock',
  level: 'level zone',
  stock: 'stock',
  memory: 'memory',
  resolution: 'resolution zone',
  stage: 'stage',
  climax: 'climax area',
};

/** 6500 -> "6,500". */
export function formatNumber(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** +1,000 or -500. */
export function signed(n: number): string {
  return n >= 0 ? `+${formatNumber(n)}` : formatNumber(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Everything a describer needs to name players and cards for one viewer. */
export interface Names {
  readonly cards: CardSource;
  readonly memory: Memory;
  readonly viewer: PlayerId;
  readonly seats: readonly [Seat, Seat];
}

/** "You" for the viewer, the seat name for the other player. */
export function who(n: Names, p: PlayerId): string {
  return p === n.viewer ? 'You' : (n.seats[p]?.name ?? `Player ${p + 1}`);
}

/** "your" for the viewer, "Player 2's" for the other player. */
export function whose(n: Names, p: PlayerId): string {
  return p === n.viewer ? 'your' : `${n.seats[p]?.name ?? `Player ${p + 1}`}'s`;
}

/** The definition id of a card the viewer has seen, or null. */
export function defIdOf(n: Names, id: string): string | null {
  return n.memory[id] ?? null;
}

/** A card's name if the viewer has seen it, else "a card". */
export function cardName(n: Names, id: string): string {
  const def = defIdOf(n, id);
  return (def !== null ? lookupDef(n.cards.catalog, def)?.name : undefined) ?? 'a card';
}

/** "A and B", "A, B and C". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
