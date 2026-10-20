// Plain-English labels for every action a player can take and every question
// the game can ask. Names come only from what the viewer has seen.

import { abilityText, currentLevel, facing, lookupDef } from '../engine';
import type { Action, CardId, GameState, GameView, Pending, PlayerId, Slot, StandbyAuto } from '../engine';
import { cardName, formatNumber, ICON_NAMES, plural, SLOT_NAMES, STEP_NAMES } from './words';
import type { Names } from './words';

export interface DescribeContext extends Names {
  /** The viewer's view of the game (made with the catalog, so stage cards carry power and soul). */
  readonly view: GameView;
  /** Read only for public facts (a stage card's current level). */
  readonly state: GameState;
}

export interface Described {
  readonly label: string;
  readonly detail?: string;
}

function stageOccupant(ctx: DescribeContext, player: PlayerId, slot: Slot) {
  return ctx.view.players[player].stage[slot - 1]?.[0] ?? null;
}

function costDetail(ctx: DescribeContext, card: CardId): string | undefined {
  const defId = ctx.memory[card];
  const def = defId !== undefined ? lookupDef(ctx.cards.catalog, defId) : undefined;
  if (!def) return undefined;
  return `Level ${def.level ?? 0} · Cost ${def.cost ?? 0}`;
}

function withDetail(label: string, detail: string | undefined): Described {
  return detail === undefined ? { label } : { label, detail };
}

function abilityLine(ctx: DescribeContext, card: CardId, index: number): string {
  const defId = ctx.memory[card];
  const ability = defId !== undefined ? lookupDef(ctx.cards.catalog, defId)?.abilities?.[index] : undefined;
  return ability ? abilityText(ability) : 'its ability';
}

function autoLabel(ctx: DescribeContext, a: StandbyAuto): Described {
  switch (a.ability) {
    case 'encore':
      return { label: `Encore for ${cardName(ctx, a.card.card)} first` };
    case 'shot':
      return { label: `Shot of ${cardName(ctx, a.source.card)} first` };
    case 'card':
      return { label: `${cardName(ctx, a.source.card)} first`, detail: abilityLine(ctx, a.source.card, a.index) };
  }
}

function passLabel(p: Pending | null): string {
  if (p === null) return 'Pass';
  switch (p.kind) {
    case 'play':
      return p.window === 'main' ? 'End main phase' : p.window === 'climax' ? 'No climax' : 'No counter';
    case 'attack':
      return 'End attacks';
    case 'pick':
      return p.picked.length > 0 ? 'Done' : 'Choose none';
    case 'choose':
      return 'Don’t choose';
    case 'confirm':
      return 'Skip';
    case 'encore':
      return 'Don’t encore';
    case 'optional':
      return p.purpose === 'payCost' ? 'Don’t pay' : p.purpose === 'may' ? 'No' : p.purpose === 'drawMore' ? 'Stop drawing' : 'Stop looking';
    case 'mulligan':
    case 'clock':
    case 'levelUp':
    case 'interruptOrder':
    case 'discard':
    case 'iconOrder':
    case 'chooseSlot':
    case 'chooseDest':
    case 'autoOrder':
      return 'Pass';
  }
}

function acceptLabel(ctx: DescribeContext, p: Pending | null): Described {
  if (p === null) return { label: 'Yes' };
  switch (p.kind) {
    case 'confirm':
      return p.reason === 'draw' ? { label: 'Draw a card' } : { label: 'Put the top card of your deck into your stock' };
    case 'encore':
      return { label: `Encore: pay ${p.cost} stock`, detail: `${cardName(ctx, p.card)} returns to ${SLOT_NAMES[p.slot]}, rested` };
    case 'optional':
      if (p.purpose === 'lookMore') return { label: (ctx.view.look?.count ?? 0) > 0 ? 'Look at one more card' : 'Look at a card' };
      return { label: p.purpose === 'payCost' ? 'Pay the cost' : p.purpose === 'may' ? 'Yes' : 'Draw a card' };
    case 'mulligan':
    case 'clock':
    case 'play':
    case 'levelUp':
    case 'interruptOrder':
    case 'discard':
    case 'attack':
    case 'iconOrder':
    case 'choose':
    case 'chooseSlot':
    case 'chooseDest':
    case 'autoOrder':
    case 'pick':
      return { label: 'Yes' };
  }
}

function chooseCardLabel(ctx: DescribeContext, card: CardId, p: Pending | null): Described {
  const name = cardName(ctx, card);
  if (p === null) return { label: `Choose ${name}` };
  switch (p.kind) {
    case 'discard':
      return { label: `Discard ${name}` };
    case 'choose':
      switch (p.reason) {
        case 'return':
          return { label: `Return ${name} to its owner’s hand` };
        case 'comeback':
        case 'gate':
          return { label: `Return ${name} to your hand` };
        case 'standby':
          return { label: `Put ${name} on your stage` };
        case 'choice':
          return { label: `Choose ${name}` };
        case 'encoreStep':
          return { label: `Put ${name} into the waiting room` };
      }
      return { label: `Choose ${name}` };
    case 'pick':
      switch (p.purpose) {
        case 'target':
          return { label: `Choose ${name}` };
        case 'costDiscard':
          return { label: `Discard ${name} to pay the cost` };
        case 'discard':
          return { label: `Discard ${name}` };
        case 'salvage':
          return { label: `Return ${name} to your hand` };
        case 'lookTake':
          return { label: `Take ${name}` };
        case 'orderTop':
          return withDetail(`Put ${name} next`, p.picked.length === 0 ? 'It ends up on top' : undefined);
        case 'orderBottom':
          return { label: `Put ${name} next` };
      }
      return { label: `Choose ${name}` };
    case 'mulligan':
    case 'clock':
    case 'play':
    case 'levelUp':
    case 'interruptOrder':
    case 'attack':
    case 'iconOrder':
    case 'chooseSlot':
    case 'chooseDest':
    case 'confirm':
    case 'encore':
    case 'autoOrder':
    case 'optional':
      return { label: `Choose ${name}` };
  }
}

function attackLabel(ctx: DescribeContext, a: Extract<Action, { type: 'ATTACK' }>): Described {
  const me = stageOccupant(ctx, a.player, a.slot);
  const name = me ? cardName(ctx, me.id) : 'Your character';
  const opp = ctx.view.players[a.player === 0 ? 1 : 0];
  const f = facing(a.slot);
  const target = f !== null ? (opp.stage[f - 1]?.[0] ?? null) : null;
  switch (a.attack) {
    case 'direct':
      return { label: `${name}: Direct attack`, detail: 'Nothing in front: +1 soul for this attack' };
    case 'frontal': {
      const versus = target ? `${formatNumber(me?.power ?? 0)} vs ${formatNumber(target.power ?? 0)} power (${cardName(ctx, target.id)})` : undefined;
      return withDetail(`${name}: Front attack`, versus);
    }
    case 'side': {
      const level = target ? currentLevel(ctx.state, ctx.cards.catalog, target.id) : 0;
      return { label: `${name}: Side attack`, detail: `No battle; ${level > 0 ? `−${level} soul` : 'no soul lost'} (${target ? cardName(ctx, target.id) : 'the facing card'}’s level)` };
    }
  }
}

/** A button label (and optional detail line) for one legal action, in the context of the pending decision. */
export function describeAction(a: Action, p: Pending | null, ctx: DescribeContext): Described {
  switch (a.type) {
    case 'MULLIGAN':
      return a.discard.length === 0 ? { label: 'Keep this hand' } : { label: `Discard ${plural(a.discard.length, 'card')} and draw ${a.discard.length}` };
    case 'CLOCK':
      return a.card === null ? { label: 'Don’t clock' } : { label: `Clock ${cardName(ctx, a.card)}`, detail: 'Then draw 2 cards' };
    case 'PLAY_CHARACTER': {
      const there = stageOccupant(ctx, a.player, a.slot);
      const parts = [costDetail(ctx, a.card), there ? `replaces ${cardName(ctx, there.id)}` : undefined].filter((x): x is string => x !== undefined);
      return withDetail(`Play to ${SLOT_NAMES[a.slot]}`, parts.length > 0 ? parts.join(' · ') : undefined);
    }
    case 'PLAY_EVENT':
      return withDetail('Play this event', costDetail(ctx, a.card));
    case 'PLAY_CLIMAX':
      return { label: 'Play as your climax' };
    case 'SWAP': {
      const atA = stageOccupant(ctx, a.player, a.a);
      const atB = stageOccupant(ctx, a.player, a.b);
      if (atA && atB) return { label: `Swap ${SLOT_NAMES[a.a]} and ${SLOT_NAMES[a.b]}` };
      return atA ? { label: `Move ${SLOT_NAMES[a.a]} to ${SLOT_NAMES[a.b]}` } : { label: `Move ${SLOT_NAMES[a.b]} to ${SLOT_NAMES[a.a]}` };
    }
    case 'PASS':
      return { label: passLabel(p) };
    case 'LEVEL_UP':
      return { label: `Level up with ${cardName(ctx, a.card)}`, detail: 'The other 6 go to your waiting room' };
    case 'CHOOSE_INTERRUPT':
      return { label: a.interrupt === 'refresh' ? 'Refresh first' : 'Level up first' };
    case 'ATTACK':
      return attackLabel(ctx, a);
    case 'BACKUP': {
      const def = lookupDef(ctx.cards.catalog, ctx.memory[a.card] ?? '');
      const b = def?.backup;
      return b ? { label: `Backup: +${formatNumber(b.power)} power`, detail: `Pay ${b.stock} stock and discard this card` } : { label: 'Use Backup' };
    }
    case 'ORDER_ICON':
      return { label: `${ICON_NAMES[a.icon]} first` };
    case 'CHOOSE_CARD':
      return chooseCardLabel(ctx, a.card, p);
    case 'CHOOSE_SLOT': {
      const there = stageOccupant(ctx, a.player, a.slot);
      return withDetail(`Put it in ${SLOT_NAMES[a.slot]}`, there ? `replaces ${cardName(ctx, there.id)}` : undefined);
    }
    case 'CHOOSE_DEST':
      return { label: a.dest === 'hand' ? 'To your hand' : 'To your stock' };
    case 'ACCEPT':
      return acceptLabel(ctx, p);
    case 'ORDER_AUTO': {
      const auto = p?.kind === 'autoOrder' ? p.options.find((o) => o.id === a.auto) : undefined;
      return auto ? autoLabel(ctx, auto) : { label: 'This one first' };
    }
    case 'ACTIVATE':
      return { label: 'Use ability', detail: abilityLine(ctx, a.card, a.ability) };
    case 'REORDER':
      return { label: 'Reorder' };
    case 'CONCEDE':
      return { label: 'Concede' };
  }
}

function countWords(p: Extract<Pending, { kind: 'pick' }>): string {
  const range = p.min === p.max ? `${p.max}` : p.min === 0 ? `up to ${p.max}` : `${p.min} to ${p.max}`;
  return p.picked.length > 0 ? `${range} (${p.picked.length} chosen)` : range;
}

/** Title and instruction for the decision the viewer must make. */
export function describePending(p: Pending, ctx: DescribeContext): { title: string; text: string } {
  switch (p.kind) {
    case 'mulligan':
      return { title: 'Mulligan', text: 'Choose any cards to put into your waiting room, then draw that many. You can do this once.' };
    case 'clock':
      return { title: 'Clock phase', text: 'You may put 1 card from your hand into your clock. If you do, draw 2 cards.' };
    case 'play':
      if (p.window === 'main') return { title: 'Main phase', text: 'Tap a card to see what it can do, or end your main phase.' };
      if (p.window === 'climax') return { title: 'Climax phase', text: 'You may play 1 climax.' };
      return { title: 'Counter step', text: 'Your character is under a front attack. You may play 1 counter card, or use Backup or a counter ability, or do nothing.' };
    case 'levelUp':
      return { title: 'Level up', text: 'Your clock reached 7. Choose 1 of those cards for your level zone.' };
    case 'interruptOrder':
      return { title: 'Which first?', text: 'A refresh and a level up are both due. Choose which happens first.' };
    case 'discard': {
      const left = p.count - p.picked.length;
      return { title: 'Hand limit', text: `You have more than 7 cards. Choose ${plural(left, 'more card')} to discard.` };
    }
    case 'attack':
      return { title: 'Attack', text: 'Choose a character to attack with, or end your attacks.' };
    case 'iconOrder':
      return { title: 'Trigger', text: 'The trigger card has several icons. Choose which to carry out first.' };
    case 'choose': {
      const text: Record<typeof p.reason, string> = {
        return: 'Return trigger: you may return 1 of your opponent’s characters to its owner’s hand.',
        comeback: 'Comeback trigger: you may return 1 character from your waiting room to your hand.',
        gate: 'Gate trigger: you may return 1 climax from your waiting room to your hand.',
        standby: 'Standby trigger: you may put 1 character from your waiting room onto your stage, rested.',
        choice: 'Choice trigger: you may choose 1 character with a Soul icon from your waiting room.',
        encoreStep: 'Encore step: choose a reversed character to put into the waiting room (its Encore can then bring it back).',
      };
      return { title: p.reason === 'encoreStep' ? STEP_NAMES.encore : 'Trigger', text: text[p.reason] };
    }
    case 'chooseSlot':
      return { title: 'Standby', text: `Choose where ${cardName(ctx, p.card)} goes. A character already there goes to the waiting room.` };
    case 'chooseDest':
      return { title: 'Choice', text: `Put ${cardName(ctx, p.card)} into your hand or your stock.` };
    case 'confirm':
      return p.reason === 'draw'
        ? { title: 'Draw trigger', text: 'You may draw 1 card.' }
        : { title: p.reason === 'pool' ? 'Pool trigger' : 'Treasure trigger', text: 'You may put the top card of your deck into your stock.' };
    case 'encore':
      return { title: 'Encore', text: `Pay ${p.cost} stock to put ${cardName(ctx, p.card)} back on ${SLOT_NAMES[p.slot]}, rested?` };
    case 'autoOrder':
      return { title: 'Which first?', text: 'Several abilities are waiting. Choose which one happens first.' };
    case 'pick': {
      const source = cardName(ctx, p.card);
      const n = countWords(p);
      switch (p.purpose) {
        case 'target':
          return { title: source, text: `Choose ${n}.` };
        case 'costDiscard':
          return { title: source, text: `To pay the cost, choose ${n} to discard.` };
        case 'discard':
          return { title: source, text: `Choose ${n} to discard.` };
        case 'salvage':
          return { title: source, text: `Choose ${n} to return to your hand.` };
        case 'lookTake':
          return { title: source, text: `Choose ${n} of the cards you are looking at.` };
        case 'orderTop':
          return { title: source, text: 'Put the cards back on top of your deck one at a time. The first one you choose ends up on top; the card you don’t choose goes lowest.' };
        case 'orderBottom':
          return { title: source, text: 'Put the cards at the bottom of your deck one at a time. The first one you choose ends up highest; the card you don’t choose goes to the very bottom.' };
      }
      return { title: source, text: `Choose ${n}.` };
    }
    case 'optional': {
      const source = cardName(ctx, p.card);
      switch (p.purpose) {
        case 'payCost':
          return { title: source, text: 'Pay the cost of this ability?' };
        case 'may':
          return { title: source, text: 'Do you want to do this?' };
        case 'drawMore':
          return { title: source, text: 'You may draw cards one at a time and stop whenever you like. Draw a card?' };
        case 'lookMore':
          return { title: source, text: (ctx.view.look?.count ?? 0) > 0 ? 'Look at one more card from the top of your deck?' : 'You may look at cards from the top of your deck one at a time. Look at a card?' };
      }
      return { title: source, text: 'Do you want to do this?' };
    }
  }
}

/** Short words for a decision someone else is making (public: only its kind is known). */
export function pendingWords(kind: Pending['kind']): string {
  switch (kind) {
    case 'mulligan':
      return 'is deciding on a mulligan';
    case 'clock':
      return 'is in the clock phase';
    case 'play':
      return 'is deciding what to play';
    case 'levelUp':
      return 'is levelling up';
    case 'interruptOrder':
    case 'iconOrder':
    case 'autoOrder':
      return 'is choosing an order';
    case 'discard':
      return 'is discarding down to 7';
    case 'attack':
      return 'is deciding on an attack';
    case 'choose':
    case 'chooseSlot':
    case 'chooseDest':
    case 'pick':
      return 'is choosing';
    case 'confirm':
    case 'optional':
      return 'is deciding';
    case 'encore':
      return 'is deciding on Encore';
  }
}

