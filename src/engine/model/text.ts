// Card text from the ability language: deterministic plain English, one line
// per ability, in the usual card-text order (category, cost, condition,
// effect). The engine never reads this text; it is for players, tests and the
// card importer's preview.
//
// Text must never make two different abilities read the same. Steps at the top
// of an effect are separate sentences; steps inside a branch ("if", "you may")
// are joined into one sentence with "then", so it is clear where the branch
// ends.

import type { Ability, CardFilter, Condition, CostPart, CountSpec, Modifier, Selector, Side, Step, Target, Trigger } from './abilities';
import type { CardDef } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const whose = (side: Side) => (side === 'you' ? 'your' : "your opponent's");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
type Refs = Map<string, number>;

function levelText(level: CardFilter['level']): string {
  if (!level) return '';
  const { min, max } = level;
  if (min !== undefined && max !== undefined) return min === max ? `level ${min}` : `level ${min} to ${max}`;
  if (max !== undefined) return max === 0 ? 'level 0' : `level ${max} or lower`;
  return `level ${min ?? 0} or higher`;
}

/** "level 1 or lower yellow «Squad»" style qualifiers, before the noun. */
function qualifiers(f: CardFilter): string[] {
  const out: string[] = [];
  const level = levelText(f.level);
  if (level) out.push(level);
  if (f.color) out.push(f.color);
  if (f.trait) out.push(`«${f.trait}»`);
  return out;
}

function noun(f: CardFilter, count: number): string {
  const base = f.kind ?? 'card';
  const word = count === 1 ? base : base === 'climax' ? 'climaxes' : `${base}s`;
  const named = f.name ? ` named "${f.name}"` : '';
  return [...qualifiers(f), word].join(' ') + named;
}

/** "a card", "an event", "2 characters". */
function counted(f: CardFilter, count: number): string {
  const n = noun(f, count);
  return count === 1 ? `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}` : `${count} ${n}`;
}

/** Describes characters a selector matches. Returns the phrase and whether it is grammatically singular. */
function selectorText(sel: Selector, count?: number, upTo?: boolean): { text: string; one: boolean } {
  const named = sel.name ? ` named "${sel.name}"` : '';
  if (sel.role) {
    // There is at most one attacking and one defending character.
    const text = [whose(sel.side), ...(sel.other ? ['other'] : []), ...qualifiers(sel), `${sel.role === 'attacker' ? 'attacking' : 'defending'} character`].join(' ') + named;
    return { text, one: true };
  }
  const desc = [...(sel.other ? ['other'] : []), ...qualifiers(sel), 'characters'].join(' ') + named;
  if (count === undefined) return { text: `all of ${whose(sel.side)} ${desc}`, one: false };
  return { text: `${upTo ? 'up to ' : ''}${count} of ${whose(sel.side)} ${desc}`, one: count === 1 && !upTo };
}

function targetText(t: Target, refs: Refs): { text: string; one: boolean } {
  if (t === 'this') return { text: 'this card', one: true };
  if ('ref' in t) return (refs.get(t.ref) ?? 1) === 1 ? { text: 'that character', one: true } : { text: 'those characters', one: false };
  return selectorText(t.all);
}

function countSpecText(spec: CountSpec): string {
  const zone = spec.zone ?? (spec.kind === 'climax' ? 'climax' : 'stage');
  const what = noun(spec.kind === undefined && zone === 'stage' ? { ...spec, kind: 'character' } : spec, 2);
  const where: Record<string, string> = {
    stage: 'on the stage',
    climax: 'in the climax area',
    hand: 'in the hand',
    waiting: 'in the waiting room',
    clock: 'in the clock',
    level: 'in the level zone',
    stock: 'in the stock',
  };
  return `${whose(spec.side)} ${what} ${where[zone] ?? ''}`.trim();
}

function bounds(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return min === max ? `exactly ${min}` : `${min} to ${max}`;
  if (max !== undefined) return `${max} or fewer`;
  return `${min ?? 0} or more`;
}

export function conditionText(c: Condition): string {
  switch (c.if) {
    case 'level':
      return `${c.side === 'opponent' ? "your opponent's" : 'your'} level is ${bounds(c.min, c.max)}`;
    case 'climax':
      return `${c.side === 'opponent' ? 'your opponent has' : 'you have'} ${c.name ? `"${c.name}"` : 'a climax'} in the climax area`;
    case 'count':
      return `there are ${bounds(c.min, c.max)} of ${countSpecText(c.what)}`;
    case 'turn':
      return c.side === 'you' ? 'it is your turn' : "it is your opponent's turn";
  }
}

const conditionsText = (cs: readonly Condition[]) => cs.map(conditionText).join(' and ');

export function costText(parts: readonly CostPart[]): string {
  return parts
    .map((p) => {
      switch (p.pay) {
        case 'stock':
          return `(${p.count})`;
        case 'discard':
          return `Put ${counted(p.filter ?? {}, p.count)} from your hand into your waiting room`;
        case 'rest':
          return 'Rest this card';
        case 'selfToWaiting':
          return 'Put this card into your waiting room';
      }
    })
    .join(', ');
}

const until = (step: { duration?: 'turn' | 'game' }) => (step.duration === 'game' ? '' : ' until end of turn');
const moveDest = (t: Target, refs: Refs, zone: 'waiting room' | 'hand') => {
  if (t === 'this') return `your ${zone}`;
  return targetText(t, refs).one ? `its owner's ${zone}` : `their owners' ${zone === 'hand' ? 'hands' : 'waiting rooms'}`;
};

/**
 * One step as a lowercase clause. `imperative` asks for a form that can follow
 * "you may" ("give that character +1000 power", "have your opponent draw").
 */
function clause(step: Step, refs: Refs, imperative = false): string {
  switch (step.do) {
    case 'choose':
      refs.set(step.as, step.count);
      // There is only one attacking or defending character; "up to" makes choosing it optional.
      if (step.what.role && step.upTo) return `you may choose ${selectorText(step.what).text}`;
      return `choose ${selectorText(step.what, step.count, step.upTo === true).text}`;
    case 'draw': {
      const n = `${step.upTo ? 'up to ' : ''}${plural(step.count, 'card')}`;
      if (step.player !== 'opponent') return `draw ${n}`;
      return imperative ? `have your opponent draw ${n}` : `your opponent draws ${n}`;
    }
    case 'discard': {
      const n = `${step.upTo ? 'up to ' : ''}${step.count} ${noun(step.filter ?? {}, step.count)}`;
      if (step.player !== 'opponent') return `put ${n} from your hand into your waiting room`;
      return `${imperative ? 'have your opponent put' : 'your opponent puts'} ${n} from their hand into their waiting room`;
    }
    case 'stockFromDeck':
      return `put the top ${step.count === 1 ? 'card' : `${step.count} cards`} of your deck into your stock`;
    case 'heal':
      return `put the top ${step.count === 1 ? 'card' : `${step.count} cards`} of your clock into your waiting room`;
    case 'power':
    case 'soul': {
      const t = targetText(step.target, refs);
      if (imperative) return `give ${t.text} ${signed(step.amount)} ${step.do}${until(step)}`;
      return `${t.text} ${t.one ? 'gets' : 'get'} ${signed(step.amount)} ${step.do}${until(step)}`;
    }
    case 'damageOpp':
      return `deal ${step.amount} damage to your opponent`;
    case 'salvage':
      return `choose ${step.upTo ? 'up to ' : ''}${step.count} ${noun(step.filter ?? {}, step.count)} in your waiting room and return ${step.count === 1 ? 'it' : 'them'} to your hand`;
    case 'lookTop': {
      const look = `look at ${step.upTo ? 'up to ' : ''}${plural(step.count, 'card')} from the top of your deck`;
      const take = step.take
        ? `, choose ${step.take.upTo ? 'up to ' : ''}${step.take.count} ${noun(step.take.filter ?? {}, step.take.count)} among them and put ${step.take.count === 1 ? 'it' : 'them'} into your ${step.take.to === 'waiting' ? 'waiting room' : step.take.to}`
        : '';
      const rest = step.rest === 'waiting' ? 'put the rest into your waiting room' : `put the rest ${step.rest === 'top' ? 'on top of' : 'on the bottom of'} your deck in any order`;
      return `${look}${take}, and ${rest}`;
    }
    case 'sendToWaiting':
      return `put ${targetText(step.target, refs).text} into ${moveDest(step.target, refs, 'waiting room')}`;
    case 'returnToHand':
      return `return ${targetText(step.target, refs).text} to ${moveDest(step.target, refs, 'hand')}`;
    case 'may': {
      // Inside a sentence the parts are separated by semicolons, so the branch's end stays clear.
      const action = clause(step.steps[0] ?? { do: 'damageOpp', amount: 0 }, refs, true);
      const then = step.then ? `; if you do, ${branch(step.then, refs, step.else !== undefined)}` : '';
      const otherwise = step.else ? `; if you do not, ${branch(step.else, new Map(refs))}` : '';
      return `you may ${action}${then}${otherwise}`;
    }
    case 'if': {
      const otherwise = step.else ? `; otherwise, ${branch(step.else, new Map(refs))}` : '';
      return `if ${conditionsText(step.when)}, ${branch(step.then, new Map(refs), step.else !== undefined)}${otherwise}`;
    }
  }
}

/**
 * Steps as one clause joined by `sep`. A nested "you may" or "if" is put in
 * parentheses when something follows it (a later step, or with `closeLast` the
 * enclosing step's own "if you do not" / "otherwise" part), so it is clear
 * where it ends.
 */
function joined(steps: readonly Step[], refs: Refs, sep: string, closeLast = false): string {
  return steps
    .map((step, i) => {
      const text = clause(step, refs);
      return (step.do === 'may' || step.do === 'if') && (i < steps.length - 1 || closeLast) ? `(${text})` : text;
    })
    .join(sep);
}

/** The steps of a branch as one clause: "a, then b, then c". */
function branch(steps: readonly Step[], refs: Refs, closeLast = false): string {
  return joined(steps, refs, ', then ', closeLast);
}

/** Effect steps as sentences, one per top-level step. */
export function effectText(steps: readonly Step[], refs: Refs = new Map()): string {
  return steps.map((step) => `${cap(clause(step, refs))}.`).join(' ');
}

function triggerText(t: Trigger): string {
  switch (t.on) {
    case 'play':
      return 'When this card is played and placed';
    case 'attack':
      return 'When this card attacks';
    case 'reversed':
      return 'When this card becomes reversed';
    case 'climaxPlayed':
      return `When ${t.name ? `"${t.name}"` : 'a climax'} is placed in your climax area`;
  }
}

/** Modifiers as one clause; modifiers on the same characters are joined ("+1000 power and +1 soul"). */
function modifiersText(mods: readonly Modifier[]): string {
  const groups: { who: { text: string; one: boolean }; key: string; changes: string[] }[] = [];
  for (const m of mods) {
    const who = m.target === 'this' ? { text: 'this card', one: true } : selectorText(m.target);
    const key = JSON.stringify(m.target);
    const change = `${signed(m.amount)} ${m.stat}`;
    const group = groups.find((g) => g.key === key);
    if (group) group.changes.push(change);
    else groups.push({ who, key, changes: [change] });
  }
  return groups.map((g) => `${g.who.text} ${g.who.one ? 'gets' : 'get'} ${g.changes.join(' and ')}`).join(', and ');
}

/** One ability as card text, e.g. "[ACT] [(1), Rest this card] Choose 1 of your other characters. ..." */
export function abilityText(a: Ability): string {
  switch (a.kind) {
    case 'activated': {
      const head = a.timing === 'counter' ? '[COUNTER] [ACT]' : '[ACT]';
      const when = a.when && a.when.length > 0 ? ` Use only if ${conditionsText(a.when)}.` : '';
      return `${head} [${costText(a.cost)}]${when} ${effectText(a.effect)}`;
    }
    case 'automatic': {
      const refs: Refs = new Map();
      // Everything after a declined cost is skipped, so the whole effect hangs off "if you do".
      if (a.cost) return `[AUTO] [${costText(a.cost)}] ${triggerText(a.trigger)}, you may pay the cost. If you do, ${joined(a.effect, refs, '; ')}.`;
      const [first, ...more] = a.effect;
      const lead = `[AUTO] ${triggerText(a.trigger)}, ${first ? clause(first, refs) : ''}.`;
      return more.length > 0 ? `${lead} ${effectText(more, refs)}` : lead;
    }
    case 'continuous': {
      const mods = modifiersText(a.modifiers);
      return a.when && a.when.length > 0 ? `[CONT] While ${conditionsText(a.when)}, ${mods}.` : `[CONT] ${cap(mods)}.`;
    }
  }
}

/** Every line of a card's text: its abilities, or an event's effect. */
export function cardText(def: CardDef): string[] {
  if (def.kind === 'event') return def.effect && def.effect.length > 0 ? [effectText(def.effect)] : [];
  return (def.abilities ?? []).map(abilityText);
}
