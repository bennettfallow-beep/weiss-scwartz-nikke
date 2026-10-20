// Card faces as the screens show them: everything printed, in words, so no
// information is carried by color alone.

import { cardText, lookupDef } from '../engine';
import type { CardId, Color, Orientation } from '../engine';
import type { CardSource } from './types';
import { COLOR_NAMES, formatNumber, ICON_NAMES, KIND_NAMES, ORIENTATION_NAMES } from './words';

export interface CardTile {
  /** Instance id: only ever for a card the viewer can see. */
  readonly id: CardId;
  readonly defId: string;
  readonly name: string;
  readonly number: string;
  readonly kind: string;
  readonly color: string;
  readonly colorKey: Color;
  readonly level?: number;
  readonly cost?: number;
  readonly power?: number;
  readonly soul?: number;
  readonly triggers: readonly string[];
  readonly counter: boolean;
  /** "Backup +3,000 (level 1, 1 stock)". */
  readonly backup?: string;
}

export interface StageTile extends CardTile {
  readonly orientation: string;
  readonly orientationKey: Orientation;
  readonly powerNow: number;
  readonly soulNow: number;
  /** True when power or soul differs from the printed value. */
  readonly changed: boolean;
}

export interface CardDetail {
  readonly defId: string;
  readonly name: string;
  readonly number: string;
  readonly kind: string;
  readonly color: string;
  readonly colorKey: Color;
  readonly level?: number;
  readonly cost?: number;
  readonly power?: number;
  readonly soul?: number;
  readonly traits: readonly string[];
  readonly triggers: readonly string[];
  readonly counter: boolean;
  readonly backup?: string;
  /** The card's text, one line per ability. */
  readonly lines: readonly string[];
  /** Printed lines the engine does not play yet. */
  readonly unimplemented: readonly string[];
}

function backupText(b: { power: number; level: number; stock: number }): string {
  return `Backup +${formatNumber(b.power)} (level ${b.level}, ${b.stock} stock)`;
}

function face(cards: CardSource, defId: string) {
  const def = lookupDef(cards.catalog, defId);
  if (!def) return null;
  return {
    def,
    base: {
      defId,
      name: def.name,
      number: cards.display[defId]?.number ?? defId,
      kind: KIND_NAMES[def.kind],
      color: COLOR_NAMES[def.color],
      colorKey: def.color,
      ...(def.level !== undefined ? { level: def.level } : {}),
      ...(def.cost !== undefined ? { cost: def.cost } : {}),
      ...(def.power !== undefined ? { power: def.power } : {}),
      ...(def.soul !== undefined ? { soul: def.soul } : {}),
      triggers: (def.triggers ?? []).map((t) => ICON_NAMES[t]),
      counter: def.counter === true,
      ...(def.backup ? { backup: backupText(def.backup) } : {}),
    },
  };
}

/** A visible card's tile. Unknown definitions (never expected) show as a blank card. */
export function tileOf(cards: CardSource, id: CardId, defId: string): CardTile {
  const f = face(cards, defId);
  if (!f) return { id, defId, name: 'Unknown card', number: defId, kind: '', color: '', colorKey: 'yellow', triggers: [], counter: false };
  return { id, ...f.base };
}

export function stageTileOf(cards: CardSource, id: CardId, defId: string, orientation: Orientation, powerNow: number, soulNow: number): StageTile {
  const t = tileOf(cards, id, defId);
  return {
    ...t,
    orientation: ORIENTATION_NAMES[orientation],
    orientationKey: orientation,
    powerNow,
    soulNow,
    changed: powerNow !== (t.power ?? 0) || soulNow !== (t.soul ?? 0),
  };
}

/** Everything about a card definition, for the card detail sheet. */
export function cardDetail(cards: CardSource, defId: string): CardDetail | null {
  const f = face(cards, defId);
  if (!f) return null;
  const display = cards.display[defId];
  return {
    ...f.base,
    traits: [...(f.def.traits ?? [])],
    lines: display?.text && display.text.length > 0 ? [...display.text] : cardText(f.def),
    unimplemented: [...(display?.unimplemented ?? [])],
  };
}
