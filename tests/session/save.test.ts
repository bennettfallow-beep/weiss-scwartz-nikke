// Saves and replays (M5, pure part; storage and screens come in M6). A save
// rebuilds the exact game; loading checks every field and reports a code
// instead of crashing; normalizing twice changes nothing.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { stateHash } from '../../src/engine';
import type { CardCatalog } from '../../src/engine';
import {
  catalogFingerprint,
  checkReplay,
  exportReplay,
  loadSave,
  normalizeSave,
  parseSave,
  SAVE_ERROR_CODES,
  screenFor,
  toSave,
} from '../../src/session';
import type { SaveV1, Session } from '../../src/session';
import { cards, playOut, start } from './helpers';

function midGame(mode: 'hotseat' | 'computer', steps: number): Session {
  let n = 0;
  let out: Session | null = null;
  const s = start(mode === 'hotseat' ? { mode, decks: ['yellow', 'red'], seed: `save-${mode}` } : { mode, decks: ['yellow', 'red'], seed: `save-${mode}`, botSeed: `save-bot-${mode}` });
  playOut(s, `save-${mode}`, ({ after }) => {
    if (++n === steps) out = after;
  });
  if (!out) throw new Error('game ended too soon');
  return out;
}

function roundTrip(s: Session, botSeed?: string) {
  const parsed = parseSave(JSON.stringify(toSave(s)));
  if (!parsed.ok) throw new Error(parsed.error.code);
  const norm = normalizeSave(parsed.raw);
  if (!norm.ok) throw new Error(norm.error.code);
  expect(norm.changed).toBe(false);
  return loadSave(norm.save as SaveV1, [cards], botSeed === undefined ? {} : { botSeed });
}

describe('saves', () => {
  const hot = midGame('hotseat', 120);
  const pc = midGame('computer', 80);
  const save = toSave(hot);

  it('a save rebuilds the same game, memory and undo point included, in both modes', () => {
    for (const s of [hot, pc]) {
      const r = roundTrip(s, s.mode === 'computer' ? 'fresh-bot' : undefined);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.warnings).toEqual([]);
      expect(stateHash(r.session.game.state)).toBe(stateHash(s.game.state));
      expect(r.session.game.memory).toEqual(s.game.memory);
      expect(r.session.game.marks).toEqual(s.game.marks);
      expect(r.session.game.prev === null).toBe(s.game.prev === null);
      expect(r.session.seats).toEqual(s.seats);
      // Hot-seat resumes with a handoff; against the computer the human's board shows at once.
      expect(r.session.holder).toBe(s.mode === 'computer' ? s.holder : null);
      if (s.mode === 'computer') expect(screenFor(r.session)).not.toBeNull();
    }
  }, 60_000);

  it('the computer gets a fresh seed when a game is continued, never the game seed', () => {
    const pcSave = toSave(pc);
    expect((loadSave(pcSave, [cards]) as { error: { code: string } }).error.code).toBe('SAVE_SEED');
    expect((loadSave(pcSave, [cards], { botSeed: pcSave.setup.seed }) as { error: { code: string } }).error.code).toBe('SAVE_SEED');
  });

  it('normalizing is idempotent, whatever extra fields a file carries', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 8 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 4 }), fc.string({ maxLength: 50 }), (junk, name) => {
        const raw = { ...junk, ...save, seats: [{ ...save.seats[0], name, extra: junk }, save.seats[1]] };
        const once = normalizeSave(raw);
        if (!once.ok) return;
        const twice = normalizeSave(once.save);
        expect(twice.ok && twice.changed).toBe(false);
        expect(twice.ok && twice.save).toEqual(once.save);
      }),
      { numRuns: 200 },
    );
  });

  it('every kind of broken save is rejected with its own code', () => {
    const bad: [string, unknown, string][] = [
      ['not an object', [], 'SAVE_NOT_OBJECT'],
      ['wrong format', { ...save, format: 'other' }, 'SAVE_FORMAT'],
      ['newer version', { ...save, version: 2 }, 'SAVE_VERSION_NEWER'],
      ['no version', { ...save, version: '1' }, 'SAVE_VERSION_UNKNOWN'],
      ['old version with no upgrade', { ...save, version: 0 }, 'SAVE_VERSION_UNKNOWN'],
      ['other rules version', { ...save, rules: '2.09' }, 'SAVE_RULES'],
      ['bad fingerprint', { ...save, catalog: 'xyz' }, 'SAVE_FIELD'],
      ['unknown mode', { ...save, mode: 'online' }, 'SAVE_FIELD'],
      ['one seat', { ...save, seats: [save.seats[0]] }, 'SAVE_FIELD'],
      ['seats do not match the mode', { ...save, seats: [save.seats[0], { ...save.seats[1], kind: 'computer' }] }, 'SAVE_FIELD'],
      ['seat without a deck', { ...save, seats: [{ ...save.seats[0], deck: '' }, save.seats[1]] }, 'SAVE_FIELD'],
      ['empty seed', { ...save, setup: { ...save.setup, seed: '' } }, 'SAVE_SETUP'],
      ['one deck', { ...save, setup: { ...save.setup, decks: [save.setup.decks[0]] } }, 'SAVE_SETUP'],
      ['action not an object', { ...save, actions: [...save.actions.slice(0, 3), 7] }, 'SAVE_ACTION'],
      ['unknown action', { ...save, actions: [{ type: 'CHEAT', player: 0 }] }, 'SAVE_ACTION'],
      ['bad hash', { ...save, hash: 'abc' }, 'SAVE_FIELD'],
    ];
    const seen = new Set<string>();
    for (const [what, raw, code] of bad) {
      const r = normalizeSave(raw);
      expect(r.ok ? 'ok' : r.error.code, what).toBe(code);
      seen.add(code);
    }
    expect((parseSave('{') as { error: { code: string } }).error.code).toBe('SAVE_NOT_JSON');
    expect((parseSave(42) as { error: { code: string } }).error.code).toBe('SAVE_NOT_JSON');
    expect((parseSave(' '.repeat(2_000_001)) as { error: { code: string } }).error.code).toBe('SAVE_TOO_LARGE');
    // A save for other cards, or with an action that cannot be played, fails to load with a code.
    expect((loadSave({ ...save, catalog: '0'.repeat(32) }, [cards]) as { error: { code: string } }).error.code).toBe('SAVE_CATALOG');
    const broken = { ...save, actions: [...save.actions.slice(0, 10), { type: 'LEVEL_UP', player: 0, card: 'p0-00' }, ...save.actions.slice(10)] } as SaveV1;
    const r = loadSave(broken, [cards]);
    expect(r.ok ? 'ok' : `${r.error.code}@${r.error.index}`).toBe('SAVE_REPLAY@10');
    for (const code of [...seen, 'SAVE_NOT_JSON', 'SAVE_TOO_LARGE', 'SAVE_CATALOG', 'SAVE_REPLAY', 'SAVE_SEED']) expect(SAVE_ERROR_CODES).toContain(code);
  });

  it('a migration chain upgrades older saves', () => {
    const old = { ...save, version: 0, seats: undefined, players: save.seats };
    const migrations = { 0: (r: Record<string, unknown>) => ({ ...r, version: 1, seats: r.players }) };
    const r = normalizeSave(old, { migrations });
    expect(r.ok && r.save).toEqual(save);
  });

  it('a changed engine (different final hash) still loads, with a warning', () => {
    const r = loadSave({ ...save, hash: 'f'.repeat(32) }, [cards]);
    expect(r.ok && r.warnings.map((w) => w.code)).toEqual(['SAVE_HASH_CHANGED']);
  });

  it('the save keeps the seed (it must, to continue the game) but the screens never show it', () => {
    expect(save.setup.seed).toBe('save-hotseat');
    const r = loadSave(save, [cards]);
    if (!r.ok) throw new Error(r.error.code);
    expect(JSON.stringify(screenFor(r.session))).not.toContain(save.setup.seed);
  });
});

describe('replays', () => {
  it('are only made once the game is over, and play back to the same game', () => {
    const s = start({ mode: 'hotseat', decks: ['blue', 'red'], seed: 'replay-a' });
    expect((exportReplay(s) as { error: { code: string } }).error.code).toBe('GAME_NOT_OVER');
    const end = playOut(s, 'replay-a');
    const r = exportReplay(end);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replay.result).toEqual(end.game.state.result);
    expect(checkReplay(r.replay, [cards])).toEqual({ ok: true });
    const norm = normalizeSave(JSON.parse(JSON.stringify(r.replay)), { kind: 'replay' });
    expect(norm.ok && norm.changed).toBe(false);
    expect((normalizeSave(r.replay) as { error: { code: string } }).error.code).toBe('SAVE_FORMAT');
    const tampered = { ...r.replay, actions: r.replay.actions.slice(0, -1) };
    expect((checkReplay(tampered, [cards]) as { error: { code: string } }).error.code).toBe('SAVE_REPLAY');
  }, 60_000);
});

describe('catalog fingerprint', () => {
  it('ignores key order and copies, and changes with any change to a card', () => {
    const catalog = cards.catalog;
    const reversed = Object.fromEntries(Object.entries(catalog).reverse()) as CardCatalog;
    const copy = JSON.parse(JSON.stringify(catalog)) as CardCatalog;
    expect(catalogFingerprint(reversed)).toBe(cards.fingerprint);
    expect(catalogFingerprint(copy)).toBe(cards.fingerprint);
    const [id, def] = Object.entries(catalog).find(([, d]) => (d.abilities?.length ?? 0) > 0) ?? [];
    if (!id || !def) throw new Error('no card with abilities');
    expect(catalogFingerprint({ ...catalog, [id]: { ...def, power: (def.power ?? 0) + 500 } })).not.toBe(cards.fingerprint);
    expect(catalogFingerprint({ ...catalog, [id]: { ...def, abilities: def.abilities?.slice(1) ?? [] } })).not.toBe(cards.fingerprint);
  });
});
