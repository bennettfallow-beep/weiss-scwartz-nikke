// The decision in front of the viewer, as buttons. Every button carries the
// key of one legal action, and every legal action has a button (or, for the
// mulligan, a set of cards to toggle): the UI never makes up a move.

import { abilityText, actionKey, cardText, lookupDef } from '../engine';
import type { Action, CardId, Pending, PlayerId, Slot } from '../engine';
import { describeAction, describePending } from './describe';
import type { DescribeContext } from './describe';
import { tileOf } from './tiles';
import type { CardTile } from './tiles';
import { cardName } from './words';

export interface Choice {
  /** actionKey of the legal action this button plays. */
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  /** The card the choice is about, when the viewer can see it. */
  readonly card?: CardTile;
  readonly tone: 'primary' | 'neutral';
}

/** Everything one card can do now, in a play window. */
export interface ChoiceGroup {
  readonly zone: 'hand' | 'stage' | 'climax';
  readonly slot?: Slot;
  readonly card: CardTile;
  readonly choices: readonly Choice[];
}

export interface Prompt {
  readonly kind: Pending['kind'];
  readonly title: string;
  readonly text: string;
  /** list: buttons; byCard: tap a card for its choices; subset: toggle cards (mulligan). */
  readonly layout: 'list' | 'byCard' | 'subset';
  /** Buttons not tied to a card (list: all of them). */
  readonly choices: readonly Choice[];
  readonly groups: readonly ChoiceGroup[];
  /** Mulligan: the hand cards that can be put back. */
  readonly subset: readonly CardTile[] | null;
  /** Cards already chosen in a multi-card pick, by name. */
  readonly picked: readonly string[];
  /** The ability asking, when an ability asks. */
  readonly source: { readonly name: string; readonly text: string } | null;
}

function cardOf(a: Action): CardId | null {
  switch (a.type) {
    case 'CLOCK':
      return a.card;
    case 'PLAY_CHARACTER':
    case 'PLAY_EVENT':
    case 'PLAY_CLIMAX':
    case 'LEVEL_UP':
    case 'BACKUP':
    case 'CHOOSE_CARD':
    case 'ACTIVATE':
      return a.card;
    case 'MULLIGAN':
    case 'SWAP':
    case 'PASS':
    case 'CHOOSE_INTERRUPT':
    case 'ATTACK':
    case 'ORDER_ICON':
    case 'CHOOSE_SLOT':
    case 'CHOOSE_DEST':
    case 'ACCEPT':
    case 'ORDER_AUTO':
    case 'REORDER':
    case 'CONCEDE':
      return null;
  }
}

function visibleTile(ctx: DescribeContext, id: CardId | null): CardTile | undefined {
  if (id === null) return undefined;
  const def = ctx.memory[id];
  return def !== undefined ? tileOf(ctx.cards, id, def) : undefined;
}

function choiceOf(a: Action, p: Pending, ctx: DescribeContext, withCard: boolean): Choice {
  const d = describeAction(a, p, ctx);
  const card = withCard ? visibleTile(ctx, cardOf(a)) : undefined;
  return {
    key: actionKey(a),
    label: d.label,
    ...(d.detail !== undefined ? { detail: d.detail } : {}),
    ...(card ? { card } : {}),
    tone: a.type === 'PASS' ? 'neutral' : 'primary',
  };
}

/** Where a card the viewer can act with sits: hand, a stage position or the climax area. */
function placeOf(ctx: DescribeContext, player: PlayerId, card: CardId): { zone: ChoiceGroup['zone']; slot?: Slot } | null {
  const me = ctx.view.players[player];
  if (me.hand?.some((c) => c.id === card)) return { zone: 'hand' };
  const i = me.stage.findIndex((cards) => cards.some((c) => c.id === card));
  if (i >= 0) return { zone: 'stage', slot: (i + 1) as Slot };
  if (me.climax.some((c) => c.id === card)) return { zone: 'climax' };
  return null;
}

function sourceOf(ctx: DescribeContext, p: Pending): Prompt['source'] {
  if (p.kind !== 'pick' && p.kind !== 'optional') return null;
  const r = ctx.view.resolving;
  const name = cardName(ctx, p.card);
  if (!r) return { name, text: '' };
  const def = lookupDef(ctx.cards.catalog, r.def);
  if (!def) return { name, text: '' };
  const ability = r.index !== null ? def.abilities?.[r.index] : undefined;
  return { name, text: ability ? abilityText(ability) : cardText(def).join(' ') };
}

/** The prompt for `p` (the viewer's own decision) with exactly the legal actions `legal`. */
export function buildPrompt(p: Pending, legal: readonly Action[], ctx: DescribeContext): Prompt {
  const { title, text } = describePending(p, ctx);
  const picked = p.kind === 'pick' || p.kind === 'discard' ? p.picked.map((c) => cardName(ctx, c)) : [];
  const base = { kind: p.kind, title, text, picked, source: sourceOf(ctx, p) };
  if (p.kind === 'mulligan') {
    const hand = ctx.view.players[p.player].hand ?? [];
    return { ...base, layout: 'subset', choices: [], groups: [], subset: hand.map((c) => tileOf(ctx.cards, c.id, c.def)) };
  }
  if (p.kind !== 'play') {
    return { ...base, layout: 'list', choices: legal.map((a) => choiceOf(a, p, ctx, true)), groups: [], subset: null };
  }
  // Play windows: group the choices by the card they use.
  const groups = new Map<CardId, { zone: ChoiceGroup['zone']; slot?: Slot; choices: Choice[] }>();
  const loose: Choice[] = [];
  const add = (card: CardId, a: Action) => {
    const place = placeOf(ctx, p.player, card);
    if (!place) {
      loose.push(choiceOf(a, p, ctx, true));
      return;
    }
    const g = groups.get(card) ?? { ...place, choices: [] };
    g.choices.push(choiceOf(a, p, ctx, false));
    groups.set(card, g);
  };
  for (const a of legal) {
    if (a.type === 'SWAP') {
      const stage = ctx.view.players[p.player].stage;
      const at = [a.a, a.b].map((s) => stage[s - 1]?.[0]?.id).filter((id): id is CardId => id !== undefined);
      for (const id of at) add(id, a);
      continue;
    }
    const card = cardOf(a);
    if (card !== null) add(card, a);
    else loose.push(choiceOf(a, p, ctx, true));
  }
  // Hand cards in hand order, then stage positions in order, then the climax.
  const me = ctx.view.players[p.player];
  const order = [...(me.hand ?? []).map((c) => c.id), ...me.stage.flatMap((cards) => cards.map((c) => c.id)), ...me.climax.map((c) => c.id)];
  const out: ChoiceGroup[] = [];
  for (const id of order) {
    const g = groups.get(id);
    const card = visibleTile(ctx, id);
    if (g && card) out.push({ zone: g.zone, ...(g.slot !== undefined ? { slot: g.slot } : {}), card, choices: g.choices });
  }
  return { ...base, layout: 'byCard', choices: loose, groups: out, subset: null };
}
