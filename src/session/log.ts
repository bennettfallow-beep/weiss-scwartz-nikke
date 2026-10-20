// The game log in words, for one viewer. Built from events redacted for that
// viewer; a card is named only if the viewer has seen it.

import { lookupDef, projectEvents } from '../engine';
import type { Action, GameEvent, GameResult, LossReason, PlayerId } from '../engine';
import { cardName, formatNumber, ICON_NAMES, listWords, plural, SLOT_NAMES, who, whose, ZONE_NAMES } from './words';
import type { Names } from './words';

export interface LogLine {
  /** Stable key: the sequence number of the event that started the line. */
  readonly key: string;
  readonly turn: number;
  readonly kind: 'turn' | 'action' | 'info' | 'result';
  readonly text: string;
}

const REASONS: Readonly<Record<LossReason, string>> = {
  level4: 'reached level 4',
  deckOut: 'had no cards left in deck and waiting room',
  concede: 'conceded',
};

/** The result in words, from the viewer's side. */
export function resultText(n: Names, r: GameResult, neutral = false): string {
  if (r.kind === 'draw') return 'The game is a draw: both players lost at the same time.';
  const name = (p: PlayerId) => (neutral ? (n.seats[p]?.name ?? `Player ${p + 1}`) : who(n, p));
  const winner = name(r.winner);
  const loser = name(r.loser);
  return `${winner === 'You' ? 'You win' : `${winner} wins`}: ${loser === 'You' ? 'you' : loser} ${REASONS[r.reason]}.`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function actionText(n: Names, a: Action): string | null {
  const p = who(n, a.player);
  switch (a.type) {
    case 'MULLIGAN':
      return a.discard.length === 0 ? `${p} kept the opening hand.` : `${p} put back ${plural(a.discard.length, 'card')} and drew ${a.discard.length}.`;
    case 'CLOCK':
      return a.card === null ? `${p} did not clock.` : `${p} clocked ${cardName(n, a.card)} and drew 2.`;
    case 'PLAY_CHARACTER':
      return `${p} played ${cardName(n, a.card)} to ${SLOT_NAMES[a.slot]}.`;
    case 'PLAY_EVENT':
      return `${p} played the event ${cardName(n, a.card)}.`;
    case 'PLAY_CLIMAX':
      return `${p} played the climax ${cardName(n, a.card)}.`;
    case 'SWAP':
      return `${p} moved characters between ${SLOT_NAMES[a.a]} and ${SLOT_NAMES[a.b]}.`;
    case 'LEVEL_UP':
      return `${p} levelled up with ${cardName(n, a.card)}.`;
    case 'CONCEDE':
      return `${p} conceded.`;
    case 'CHOOSE_INTERRUPT':
      return `${p} chose to ${a.interrupt === 'refresh' ? 'refresh' : 'level up'} first.`;
    case 'PASS':
    case 'ATTACK':
    case 'BACKUP':
    case 'ORDER_ICON':
    case 'CHOOSE_CARD':
    case 'CHOOSE_SLOT':
    case 'CHOOSE_DEST':
    case 'ACCEPT':
    case 'ORDER_AUTO':
    case 'ACTIVATE':
    case 'REORDER':
      return null;
  }
}

function eventText(n: Names, e: GameEvent): { kind: LogLine['kind']; text: string } | null {
  switch (e.kind) {
    case 'setup':
      return { kind: 'info', text: `${who(n, e.starting)} ${e.starting === n.viewer ? 'go' : 'goes'} first (chosen at random).` };
    case 'turnStart':
      return { kind: 'turn', text: `Turn ${e.turn}: ${capital(whose(n, e.player))} turn` };
    case 'action': {
      const text = actionText(n, e.action);
      return text === null ? null : { kind: 'action', text };
    }
    case 'move':
      switch (e.reason) {
        case 'draw':
          return { kind: 'info', text: `${who(n, e.to.player)} drew ${cardName(n, e.card)}.` };
        case 'refreshClock':
          return { kind: 'info', text: `Refresh damage: ${cardName(n, e.card)} went to ${whose(n, e.to.player)} clock.` };
        case 'ruleAction':
          return { kind: 'info', text: `${cardName(n, e.card)} went to the ${ZONE_NAMES[e.to.zone]} (rule).` };
        case 'handLimit':
          return { kind: 'info', text: `${who(n, e.from.player)} discarded ${cardName(n, e.card)}.` };
        case 'encoreStep':
          return { kind: 'info', text: `${cardName(n, e.card)} went to the waiting room.` };
        case 'encore':
          return { kind: 'info', text: `${cardName(n, e.card)} came back with Encore${e.to.slot ? ` to ${SLOT_NAMES[e.to.slot]}` : ''}, rested.` };
        case 'icon':
        case 'effect':
          return { kind: 'info', text: `${cardName(n, e.card)} moved to ${whose(n, e.to.player)} ${ZONE_NAMES[e.to.zone]}.` };
        case 'cost':
          return e.from.zone === 'stock' ? { kind: 'info', text: `${who(n, e.from.player)} paid 1 stock.` } : { kind: 'info', text: `${who(n, e.from.player)} discarded ${cardName(n, e.card)} to pay a cost.` };
        case 'mulligan':
        case 'clock':
        case 'play':
        case 'eventResolved':
        case 'refresh':
        case 'levelUp':
        case 'climaxCleanup':
        case 'swap':
        case 'triggerCheck':
        case 'triggerToStock':
        case 'damage':
        case 'damageCancel':
        case 'damageToClock':
          return null;
      }
      return null;
    case 'refresh':
      return { kind: 'info', text: `${who(n, e.player)} refreshed: the waiting room was shuffled into the deck.` };
    case 'gameOver':
      return { kind: 'result', text: resultText(n, e.result) };
    case 'attack': {
      const attacker = cardName(n, e.card);
      const target = e.facing !== null ? cardName(n, e.facing) : null;
      const type = e.attack === 'direct' ? 'a direct attack' : e.attack === 'frontal' ? `a front attack on ${target ?? 'a character'}` : `a side attack on ${target ?? 'a character'}`;
      return { kind: 'action', text: `${attacker} made ${type}.` };
    }
    case 'triggerCheck':
      return { kind: 'info', text: `Trigger check: ${cardName(n, e.card)}${e.icons.length > 0 ? ` (${e.icons.map((i) => ICON_NAMES[i]).join(', ')})` : ' (no icon)'}.` };
    case 'modifier':
      return { kind: 'info', text: `${cardName(n, e.card)} gets ${e.amount >= 0 ? '+' : ''}${formatNumber(e.amount)} ${e.stat}.` };
    case 'damage':
      return { kind: 'info', text: `${who(n, e.target)} ${e.target === n.viewer ? 'take' : 'takes'} ${e.amount} damage${e.source !== null ? ` from ${cardName(n, e.source)}` : ''}.` };
    case 'damageCanceled':
      return { kind: 'info', text: `The damage was canceled by a climax.` };
    case 'damageTaken':
      return { kind: 'info', text: `${who(n, e.target)} took ${e.cards.length} damage.` };
    case 'battle': {
      const reversed = e.reversed.map((c) => cardName(n, c));
      return { kind: 'info', text: `Battle: ${cardName(n, e.attacker)} vs ${cardName(n, e.defender)}. Reversed: ${listWords(reversed)}.` };
    }
    case 'backup':
      return { kind: 'action', text: `${who(n, e.player)} used Backup (${cardName(n, e.card)}): +${formatNumber(e.power)} power.` };
    case 'ability': {
      const name = cardName(n, e.card);
      if (e.category === 'event') return null;
      return { kind: 'info', text: e.category === 'activated' ? `${who(n, e.player)} used an ability of ${name}.` : `${name}'s ability triggered.` };
    }
    case 'chosen':
      return { kind: 'info', text: `${who(n, e.player)} chose ${listWords(e.cards.map((c) => cardName(n, c)))}.` };
    case 'look':
      return e.player === n.viewer
        ? { kind: 'info', text: `You looked at ${listWords(e.cards.map((c) => cardName(n, c)))}.` }
        : { kind: 'info', text: `${who(n, e.player)} looked at ${plural(e.cards.length, 'card')} from the deck.` };
    case 'deckArranged': {
      const parts = [e.top > 0 ? `${plural(e.top, 'card')} on top` : '', e.bottom > 0 ? `${plural(e.bottom, 'card')} at the bottom` : ''].filter((x) => x !== '');
      return { kind: 'info', text: `${who(n, e.player)} put ${parts.join(' and ')} of the deck.` };
    }
    case 'ruleAction':
      return e.rule === 'insufficientPower' ? { kind: 'info', text: `${listWords(e.cards.map((c) => cardName(n, c)))} had 0 power or less and went to the waiting room.` } : null;
    case 'icon':
    case 'shuffle':
    case 'phase':
    case 'trigger':
    case 'checkTiming':
    case 'playTiming':
    case 'played':
    case 'orientation':
    case 'step':
    case 'auto':
    case 'effectsExpired':
    case 'abilityLapsed':
    case 'effect':
    case 'optional':
    case 'lookEnd':
      return null;
  }
}

/** Joins "You drew a card." lines that follow each other into one. */
function mergeDraws(lines: LogLine[], line: LogLine, drawer: string | null): void {
  const last = lines[lines.length - 1];
  if (drawer !== null && last && last.kind === 'info' && last.turn === line.turn && last.text.startsWith(`${drawer} drew `)) {
    const m = /^(.*) drew (\d+) cards?\.$/.exec(last.text);
    const count = m ? Number(m[2]) + 1 : 2;
    lines[lines.length - 1] = { ...last, text: `${drawer} drew ${count} cards.` };
    return;
  }
  lines.push(line);
}

/** Log lines for `viewer` from raw (unredacted) events. */
export function logLines(events: readonly GameEvent[], n: Names): LogLine[] {
  const out: LogLine[] = [];
  for (const e of projectEvents(events, n.viewer)) {
    const t = eventText(n, e);
    if (t === null) continue;
    const line: LogLine = { key: String(e.seq), turn: e.turn, kind: t.kind, text: t.text };
    // A drawn card the viewer cannot see is "a card"; several in a row read "drew 2 cards".
    if (e.kind === 'move' && e.reason === 'draw' && cardName(n, e.card) === 'a card') {
      const drawer = who(n, e.to.player);
      mergeDraws(out, { ...line, text: `${drawer} drew 1 card.` }, drawer);
    } else out.push(line);
  }
  return out;
}

/** The definition name behind a card id, if the viewer has seen it (used by tests). */
export function seenName(n: Names, id: string): string | null {
  const def = n.memory[id];
  return def !== undefined ? (lookupDef(n.cards.catalog, def)?.name ?? null) : null;
}
