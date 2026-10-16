// Card text from the ability language: deterministic plain English, one line
// per ability, in the usual card-text order (category, cost, condition,
// effect). The engine never reads this text; it is for players, tests and the
// card importer's preview.

import type { Ability, CardFilter, Condition, CostPart, CountSpec, Modifier, Selector, Side, Step, Target, Trigger } from './abilities';
import type { CardDef } from './types';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const whose = (side: Side) => (side === 'you' ? 'your' : "your opponent's");
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function levelText(level: CardFilter['level']): string {
  if (!level) return '';
  const { min, max } = level;
  if (min !== undefined && max !== undefined) return min === max ? `level ${min}` : `level ${min} to ${max}`;
  if (max !== undefined) return `level ${max} or lower`;
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
  const word = count === 1 ? base : `${base}s`;
  const named = f.name ? ` named "${f.name}"` : '';
  return [...qualifiers(f), word].join(' ') + named;
}

function selectorText(sel: Selector, count?: number, upTo?: boolean): string {
  const other = sel.other ? 'other ' : '';
  const named = sel.name ? ` named "${sel.name}"` : '';
  if (sel.role) {
    // There is at most one attacking and one defending character.
    return [...qualifiers(sel), `${whose(sel.side)} ${sel.role === 'attacker' ? 'attacking' : 'defending'} character`].join(' ') + named;
  }
  const desc = [...qualifiers(sel), `${other}characters`].join(' ') + named;
  if (count === undefined) return `all of ${whose(sel.side)} ${desc}`;
  return `${upTo ? 'up to ' : ''}${count} of ${whose(sel.side)} ${desc}`;
}

function targetText(t: Target, refs: ReadonlyMap<string, number>): string {
  if (t === 'this') return 'this card';
  if ('ref' in t) return (refs.get(t.ref) ?? 1) === 1 ? 'that character' : 'those characters';
  return selectorText(t.all);
}

function countSpecText(spec: CountSpec): string {
  const zone = spec.zone ?? (spec.kind === 'climax' ? 'climax' : 'stage');
  const what = noun(spec.kind === undefined && zone === 'stage' ? { ...spec, kind: 'character' } : spec, 2);
  const where = zone === 'stage' ? 'on the stage' : zone === 'climax' ? 'in the climax area' : `in the ${zone === 'waiting' ? 'waiting room' : zone}`;
  return `${whose(spec.side)} ${what} ${where}`;
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
          return `Put ${p.count === 1 ? 'a' : p.count} ${noun(p.filter ?? {}, p.count)} from your hand into your waiting room`;
        case 'rest':
          return 'Rest this card';
        case 'selfToWaiting':
          return 'Put this card into your waiting room';
      }
    })
    .join(', ');
}

function duration(d: Step & { duration?: 'turn' | 'game' }): string {
  return d.duration === 'game' ? '' : ' until end of turn';
}

/** Effect steps as sentences. `refs` maps choose names to their counts, for "that"/"those". */
export function effectText(steps: readonly Step[], refs: Map<string, number> = new Map()): string {
  return steps.map((step) => stepText(step, refs)).join(' ');
}

function stepText(step: Step, refs: Map<string, number>): string {
  switch (step.do) {
    case 'choose':
      refs.set(step.as, step.count);
      return `Choose ${selectorText(step.what, step.count, step.upTo === true)}.`;
    case 'draw':
      return `${step.player === 'opponent' ? 'Your opponent draws' : 'Draw'} ${step.upTo ? 'up to ' : ''}${plural(step.count, 'card')}.`;
    case 'discard': {
      const who = step.player === 'opponent' ? 'Your opponent puts' : 'Put';
      const whoseHand = step.player === 'opponent' ? 'their' : 'your';
      return `${who} ${step.upTo ? 'up to ' : ''}${step.count} ${noun(step.filter ?? {}, step.count)} from ${whoseHand} hand into ${whoseHand} waiting room.`;
    }
    case 'stockFromDeck':
      return `Put the top ${step.count === 1 ? 'card' : `${step.count} cards`} of your deck into your stock.`;
    case 'heal':
      return `Put the top ${step.count === 1 ? 'card' : `${step.count} cards`} of your clock into your waiting room.`;
    case 'power':
    case 'soul': {
      const t = targetText(step.target, refs);
      const verb = t === 'those characters' || t.startsWith('all of') ? 'get' : 'gets';
      if (typeof step.target === 'object' && 'all' in step.target && step.target.all.role) return `${cap(t)} gets ${signed(step.amount)} ${step.do}${duration(step)}.`;
      return `${cap(t)} ${verb} ${signed(step.amount)} ${step.do}${duration(step)}.`;
    }
    case 'damageOpp':
      return `Deal ${step.amount} damage to your opponent.`;
    case 'salvage':
      return `Choose ${step.upTo ? 'up to ' : ''}${step.count} ${noun(step.filter ?? {}, step.count)} in your waiting room, and return ${step.count === 1 ? 'it' : 'them'} to your hand.`;
    case 'lookTop': {
      const look = `Look at ${step.upTo ? 'up to ' : ''}${step.count} ${step.count === 1 ? 'card' : 'cards'} from the top of your deck`;
      const take = step.take
        ? `, choose ${step.take.upTo ? 'up to ' : ''}${step.take.count} ${noun(step.take.filter ?? {}, step.take.count)} among them, and put ${step.take.count === 1 ? 'it' : 'them'} into your ${step.take.to === 'waiting' ? 'waiting room' : step.take.to}`
        : '';
      const rest =
        step.rest === 'waiting'
          ? 'put the rest into your waiting room'
          : `put the rest ${step.rest === 'top' ? 'on top of' : 'on the bottom of'} your deck in any order`;
      return `${look}${take}, and ${rest}.`;
    }
    case 'sendToWaiting':
      return `Put ${targetText(step.target, refs)} into ${step.target === 'this' ? 'your' : "its owner's"} waiting room.`;
    case 'returnToHand':
      return `Return ${targetText(step.target, refs)} to ${step.target === 'this' ? 'your' : "its owner's"} hand.`;
    case 'may': {
      const action = effectText(step.steps, refs).replace(/\.$/, '');
      const then = step.then ? ` If you do, ${lower(effectText(step.then, refs))}` : '';
      const otherwise = step.else ? ` If you do not, ${lower(effectText(step.else, refs))}` : '';
      return `You may ${lower(action)}.${then}${otherwise}`;
    }
    case 'if': {
      const otherwise = step.else ? ` Otherwise, ${lower(effectText(step.else, new Map(refs)))}` : '';
      return `If ${conditionsText(step.when)}, ${lower(effectText(step.then, new Map(refs)))}${otherwise}`;
    }
  }
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

function modifierText(m: Modifier): string {
  const who = m.target === 'this' ? 'this card' : selectorText(m.target);
  return `${cap(who)} ${m.target === 'this' ? 'gets' : 'get'} ${signed(m.amount)} ${m.stat}.`;
}

/** One ability as card text, e.g. "[ACT] [(1), Rest this card] Choose 1 of your characters. ..." */
export function abilityText(a: Ability): string {
  switch (a.kind) {
    case 'activated': {
      const head = a.timing === 'counter' ? '[COUNTER] [ACT]' : '[ACT]';
      const when = a.when && a.when.length > 0 ? ` Use only if ${conditionsText(a.when)}.` : '';
      return `${head} [${costText(a.cost)}]${when} ${effectText(a.effect)}`;
    }
    case 'automatic': {
      const effect = effectText(a.effect);
      if (a.cost) return `[AUTO] [${costText(a.cost)}] ${triggerText(a.trigger)}, you may pay the cost. If you do, ${lower(effect)}`;
      return `[AUTO] ${triggerText(a.trigger)}, ${lower(effect)}`;
    }
    case 'continuous': {
      const mods = a.modifiers.map(modifierText).join(' ');
      return a.when && a.when.length > 0 ? `[CONT] While ${conditionsText(a.when)}, ${lower(mods)}` : `[CONT] ${mods}`;
    }
  }
}

/** Every line of a card's text: its abilities, or an event's effect. */
export function cardText(def: CardDef): string[] {
  if (def.kind === 'event') return def.effect && def.effect.length > 0 ? [effectText(def.effect)] : [];
  return (def.abilities ?? []).map(abilityText);
}
