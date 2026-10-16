// Trigger conditions of card automatic abilities (CR 8.7.1-8.7.2). Each time a
// condition is met, every matching ability enters standby once (CR 8.7.2.1);
// standby abilities are played in the next check timing (rules/autos.ts).

import type { CardCatalog, CardId, GameState } from '../model/types';
import type { TriggerKind } from '../model/abilities';
import { defOf } from '../core/zones';
import { nextId } from './damage';
import { refOf } from './effects';
import { stageCharacters, workingMaster } from './select';

function standBy(s: GameState, catalog: CardCatalog, card: CardId, matches: (trigger: { on: TriggerKind; name?: string }) => boolean, on: TriggerKind): void {
  const abilities = defOf(s, catalog, card).abilities;
  if (!abilities) return;
  // CR 2.12 / 4.3.5: only abilities working in their zone, mastered by that zone's player.
  const master = workingMaster(s, catalog, card);
  if (master === null) return;
  abilities.forEach((a, index) => {
    if (a.kind === 'automatic' && matches(a.trigger)) s.standby.push({ id: nextId(s), ability: 'card', player: master, source: refOf(s, card), index, on });
  });
}

/** "When this card is played and placed": a character on the stage, or a climax in the climax area. */
export function firePlayed(s: GameState, catalog: CardCatalog, card: CardId): void {
  standBy(s, catalog, card, (t) => t.on === 'play', 'play');
  if (defOf(s, catalog, card).kind !== 'climax') return;
  // "When a climax is played into your climax area" on the master's characters.
  const master = workingMaster(s, catalog, card);
  if (master === null) return;
  const name = defOf(s, catalog, card).name;
  for (const character of stageCharacters(s, catalog, master)) {
    standBy(s, catalog, character, (t) => t.on === 'climaxPlayed' && (t.name === undefined || t.name === name), 'climaxPlayed');
  }
}

/** "When this card attacks." */
export function fireAttack(s: GameState, catalog: CardCatalog, attacker: CardId): void {
  standBy(s, catalog, attacker, (t) => t.on === 'attack', 'attack');
}

/** "When this card becomes reversed." */
export function fireReversed(s: GameState, catalog: CardCatalog, card: CardId): void {
  standBy(s, catalog, card, (t) => t.on === 'reversed', 'reversed');
}
