// Buttons and words (M5): every legal action has exactly one button (the
// mulligan: one per subset), every label reads as English, and every kind of
// decision and action gets described during ordinary games.

import { describe, expect, it } from 'vitest';

import { actionKey, legalActions, projectView } from '../../src/engine';
import type { Action } from '../../src/engine';
import { acceptHandoff, mulliganChoice, screenFor } from '../../src/session';
import type { Prompt } from '../../src/session';
import { describeAction, describePending } from '../../src/session/describe';
import { cards, DECKS, playOut, promptKeys, start, subsets } from './helpers';

const BAD_TEXT = /undefined|NaN|\[object|null|\bnot found\b/;

function allText(p: Prompt): string[] {
  const choices = [...p.choices, ...p.groups.flatMap((g) => g.choices)];
  return [p.title, p.text, ...choices.flatMap((c) => [c.label, c.detail ?? '']), ...(p.source ? [p.source.name, p.source.text] : [])];
}

describe('describing decisions', () => {
  it('each prompt offers exactly the legal actions, each once per place, in readable words', () => {
    const kinds = new Map<string, number>();
    const actions = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    let prompts = 0;
    for (let g = 0; g < 45; g++) {
      const mode = g % 3 === 2 ? 'computer' : 'hotseat';
      const decks = [DECKS[g % 3] as string, DECKS[Math.floor(g / 3) % 3] as string] as const;
      const session = start(mode === 'computer' ? { mode, decks, seed: `desc-${g}`, botSeed: `desc-bot-${g}` } : { mode, decks, seed: `desc-${g}` });
      playOut(session, `desc-${g}`, ({ kind, before, screen }) => {
        if (kind !== 'human' || !screen?.prompt) return;
        const p = screen.prompt;
        prompts++;
        const st = before.game.state;
        const pending = st.pending;
        if (!pending) throw new Error('prompt without a decision');
        bump(kinds, pending.kind === 'play' ? `play:${pending.window}` : pending.kind === 'pick' ? `pick:${pending.purpose}` : pending.kind === 'optional' ? `optional:${pending.purpose}` : pending.kind === 'choose' ? `choose:${pending.reason}` : pending.kind === 'confirm' ? `confirm:${pending.reason}` : pending.kind);
        const legal = legalActions(st, cards.catalog);
        for (const a of legal) bump(actions, a.type);
        const legalKeys = new Set(legal.map(actionKey));
        if (p.layout === 'subset') {
          const offered = new Set(subsets((p.subset ?? []).map((t) => t.id)).map((d) => mulliganChoice(before, d)?.key));
          expect(offered).toEqual(legalKeys);
          return;
        }
        const keys = promptKeys(p);
        expect(new Set(keys)).toEqual(legalKeys);
        // A key appears twice only for a swap, listed under both characters.
        const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
        for (const k of twice) expect((JSON.parse(k) as Action).type).toBe('SWAP');
        for (const g2 of p.groups) expect(new Set(g2.choices.map((c) => c.key)).size).toBe(g2.choices.length);
        for (const t of allText(p)) expect(t, `${p.kind}: ${t}`).not.toMatch(BAD_TEXT);
        for (const c of [...p.choices, ...p.groups.flatMap((x) => x.choices)]) expect(c.label.length).toBeGreaterThan(1);
      });
    }
    expect(prompts).toBeGreaterThan(5000);
    // Every kind of decision and action showed up in these games.
    const expectedKinds = [
      ...['mulligan', 'clock', 'levelUp', 'discard', 'attack', 'iconOrder', 'chooseSlot', 'chooseDest', 'encore', 'autoOrder'],
      ...['play:main', 'play:climax', 'play:counter'],
      ...['choose:return', 'choose:comeback', 'choose:gate', 'choose:standby', 'choose:choice', 'choose:encoreStep'],
      ...['confirm:pool', 'confirm:draw', 'confirm:treasure'],
      ...['pick:target', 'pick:costDiscard', 'pick:discard', 'pick:salvage', 'pick:lookTake', 'pick:orderTop', 'pick:orderBottom'],
      ...['optional:payCost', 'optional:may', 'optional:drawMore', 'optional:lookMore'],
    ];
    for (const k of expectedKinds) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(0);
    for (const t of ['MULLIGAN', 'CLOCK', 'PLAY_CHARACTER', 'PLAY_EVENT', 'PLAY_CLIMAX', 'SWAP', 'PASS', 'LEVEL_UP', 'ATTACK', 'BACKUP', 'ORDER_ICON', 'CHOOSE_CARD', 'CHOOSE_SLOT', 'CHOOSE_DEST', 'ACCEPT', 'ORDER_AUTO', 'ACTIVATE']) expect(actions.get(t) ?? 0, t).toBeGreaterThan(0);
  }, 240_000);

  it('the board labels every stage position and shows the opponent mirrored', () => {
    const s = acceptHandoff(start({ mode: 'hotseat', decks: ['yellow', 'red'], seed: 'board' }));
    const screen = screenFor(s);
    expect(screen?.you.front.map((x) => x.slot)).toEqual([1, 2, 3]);
    expect(screen?.you.back.map((x) => x.slot)).toEqual([4, 5]);
    expect(screen?.opponent.front.map((x) => x.slot)).toEqual([3, 2, 1]);
    expect(screen?.opponent.back.map((x) => x.slot)).toEqual([5, 4]);
    expect(screen?.you.front.map((x) => x.label)).toEqual(['Center left', 'Center', 'Center right']);
    expect(screen?.opponent.hand).toBeNull();
    expect(screen?.you.hand).toHaveLength(5);
    expect(screen?.header.turnOf).toBe('Setup');
  });
});

describe('exact wording', () => {
  // A started game gives a real context; these checks need only the words.
  const s = acceptHandoff(start({ mode: 'hotseat', decks: ['yellow', 'red'], seed: 'words' }));
  const p = s.holder ?? 0;
  const ctx = { cards, memory: s.game.memory[p], viewer: p, seats: s.seats, state: s.game.state, view: projectView(s.game.state, p, { catalog: cards.catalog }) };

  it('a refresh and a level up due together: choose which first', () => {
    const pending = { kind: 'interruptOrder', player: p, options: ['refresh', 'levelUp'] } as const;
    expect(describePending({ ...pending, options: [...pending.options] }, ctx)).toEqual({ title: 'Which first?', text: 'A refresh and a level up are both due. Choose which happens first.' });
    expect(describeAction({ type: 'CHOOSE_INTERRUPT', player: p, interrupt: 'refresh' }, null, ctx).label).toBe('Refresh first');
    expect(describeAction({ type: 'CHOOSE_INTERRUPT', player: p, interrupt: 'levelUp' }, null, ctx).label).toBe('Level up first');
  });

  it('deck order: the first card chosen ends up on top; the last chosen at the very bottom', () => {
    const base = { kind: 'pick', player: p, card: 'p0-00', options: [], picked: [], min: 1, max: 1 } as const;
    expect(describePending({ ...base, purpose: 'orderTop', options: [], picked: [] }, ctx).text).toBe('Put the cards back on top of your deck one at a time. The first one you choose ends up on top; the card you don’t choose goes lowest.');
    expect(describePending({ ...base, purpose: 'orderBottom', options: [], picked: [] }, ctx).text).toBe('Put the cards at the bottom of your deck one at a time. The first one you choose ends up highest; the card you don’t choose goes to the very bottom.');
  });

  it('counts, passes and yes/no questions', () => {
    const pick = (min: number, max: number, picked: string[]) => describePending({ kind: 'pick', player: p, purpose: 'discard', card: 'p0-00', options: [], picked, min, max }, ctx).text;
    expect(pick(2, 2, [])).toBe('Choose 2 to discard.');
    expect(pick(0, 1, [])).toBe('Choose up to 1 to discard.');
    expect(pick(1, 3, ['p0-01'])).toBe('Choose 1 to 3 (1 chosen) to discard.');
    expect(describeAction({ type: 'PASS', player: p }, { kind: 'play', player: p, window: 'counter' }, ctx).label).toBe('No counter');
    expect(describeAction({ type: 'PASS', player: p }, { kind: 'attack', player: p }, ctx).label).toBe('End attacks');
    expect(describeAction({ type: 'PASS', player: p }, { kind: 'optional', player: p, purpose: 'payCost', card: 'p0-00' }, ctx).label).toBe('Don’t pay');
    expect(describeAction({ type: 'ACCEPT', player: p }, { kind: 'confirm', player: p, reason: 'draw' }, ctx).label).toBe('Draw a card');
    expect(describeAction({ type: 'MULLIGAN', player: p, discard: [] }, null, ctx).label).toBe('Keep this hand');
    expect(describeAction({ type: 'MULLIGAN', player: p, discard: ['a', 'b'] }, null, ctx).label).toBe('Discard 2 cards and draw 2');
    expect(describeAction({ type: 'CLOCK', player: p, card: null }, null, ctx).label).toBe('Don’t clock');
  });

  it('moving into an empty position says "Move"; only two characters "Swap"', () => {
    const occupied = (slot: number) => ({ ...ctx, view: { ...ctx.view, players: ctx.view.players.map((pl, i) => (i === p ? { ...pl, stage: pl.stage.map((c, k) => (k + 1 === slot ? [{ id: 'x', def: 'y', orientation: 'stand' as const }] : [])) } : pl)) as typeof ctx.view.players } });
    expect(describeAction({ type: 'SWAP', player: p, a: 1, b: 4 }, null, occupied(4)).label).toBe('Move Back left to Center left');
    expect(describeAction({ type: 'SWAP', player: p, a: 1, b: 4 }, null, occupied(1)).label).toBe('Move Center left to Back left');
    const both = { ...ctx, view: { ...ctx.view, players: ctx.view.players.map((pl, i) => (i === p ? { ...pl, stage: pl.stage.map((_, k) => (k === 0 || k === 3 ? [{ id: `x${k}`, def: 'y', orientation: 'stand' as const }] : [])) } : pl)) as typeof ctx.view.players } };
    expect(describeAction({ type: 'SWAP', player: p, a: 1, b: 4 }, null, both).label).toBe('Swap Center left and Back left');
  });

  it('"up to" questions are worded for the first card too', () => {
    expect(describePending({ kind: 'optional', player: p, purpose: 'drawMore', card: 'p0-00' }, ctx).text).toBe('You may draw cards one at a time and stop whenever you like. Draw a card?');
    expect(describePending({ kind: 'optional', player: p, purpose: 'lookMore', card: 'p0-00' }, ctx).text).toBe('You may look at cards from the top of your deck one at a time. Look at a card?');
    expect(describeAction({ type: 'ACCEPT', player: p }, { kind: 'optional', player: p, purpose: 'lookMore', card: 'p0-00' }, ctx).label).toBe('Look at a card');
    const looking = { ...ctx, view: { ...ctx.view, look: { player: p, count: 1, cards: [] } } };
    expect(describeAction({ type: 'ACCEPT', player: p }, { kind: 'optional', player: p, purpose: 'lookMore', card: 'p0-00' }, looking).label).toBe('Look at one more card');
  });

  it('a card the reader has never seen is "a card"', () => {
    const hidden = s.game.state.players[p === 0 ? 1 : 0].hand[0] ?? '';
    expect(describeAction({ type: 'LEVEL_UP', player: p, card: hidden }, null, ctx).label).toBe('Level up with a card');
  });
});
