// Which parts of the ability language a set of cards uses. check:cards uses it
// to prove the test set exercises every feature; the keys come from the
// engine's own lists, so a new feature counts as missing until a card uses it.

import { ABILITY_KINDS, ABILITY_TIMINGS, CONDITION_KINDS, COST_KINDS, COUNT_ZONES, DURATIONS, LOOK_DESTINATIONS, LOOK_REST, STEP_KINDS, TRIGGER_KINDS } from '../engine';
import type { Ability, CardDef, CardFilter, Condition, CostPart, Selector, Step, Target } from '../engine';

const FILTER_FIELDS = ['kind', 'name', 'trait', 'color', 'level'] as const;

/** Every feature key the language has. */
export function allFeatures(): string[] {
  return [
    ...ABILITY_KINDS.map((k) => `ability:${k}`),
    ...ABILITY_TIMINGS.map((t) => `timing:${t}`),
    ...TRIGGER_KINDS.map((t) => `trigger:${t}`),
    'trigger:climaxPlayed.name',
    ...STEP_KINDS.map((s) => `step:${s}`),
    ...COST_KINDS.map((c) => `cost:${c}`),
    'cost:discard.filter',
    'cost:automatic',
    ...CONDITION_KINDS.map((c) => `condition:${c}`),
    // Optional parts of conditions that take another path in the engine.
    'condition:climax.name',
    ...(['level', 'climax', 'count', 'turn'] as const).map((c) => `condition:${c}.opponent`),
    'condition:activated.when',
    'condition:continuous.when',
    ...COUNT_ZONES.map((z) => `countZone:${z}`),
    ...DURATIONS.map((d) => `duration:${d}`),
    ...LOOK_DESTINATIONS.map((d) => `lookTo:${d}`),
    ...LOOK_REST.map((r) => `lookRest:${r}`),
    ...FILTER_FIELDS.map((f) => `filter:${f}`),
    'target:this',
    'target:ref',
    'target:all',
    'selector:opponent',
    'selector:other',
    'selector:attacker',
    'selector:defender',
    'modifier:power',
    'modifier:soul',
    'modifier:selector',
    'upTo',
    'player:opponent',
    'may:then',
    'may:else',
    'if:else',
    'lookTop:take',
    'lookTop:filter',
  ];
}

/** The feature keys used by these card definitions. */
export function featuresOf(defs: readonly CardDef[]): Set<string> {
  const used = new Set<string>();
  const filter = (f: CardFilter | undefined) => {
    for (const field of FILTER_FIELDS) if (f?.[field] !== undefined) used.add(`filter:${field}`);
  };
  const selector = (s: Selector) => {
    filter(s);
    if (s.side === 'opponent') used.add('selector:opponent');
    if (s.other) used.add('selector:other');
    if (s.role) used.add(`selector:${s.role}`);
  };
  const target = (t: Target) => {
    if (t === 'this') used.add('target:this');
    else if ('ref' in t) used.add('target:ref');
    else {
      used.add('target:all');
      selector(t.all);
    }
  };
  const condition = (c: Condition) => {
    used.add(`condition:${c.if}`);
    if ((c.if === 'count' ? c.what.side : c.side) === 'opponent') used.add(`condition:${c.if}.opponent`);
    if (c.if === 'climax' && c.name) used.add('condition:climax.name');
    if (c.if === 'count') {
      filter(c.what);
      if (c.what.zone) used.add(`countZone:${c.what.zone}`);
    }
  };
  const cost = (parts: readonly CostPart[] | undefined) => {
    for (const p of parts ?? []) {
      used.add(`cost:${p.pay}`);
      if (p.pay === 'discard' && p.filter) {
        used.add('cost:discard.filter');
        filter(p.filter);
      }
    }
  };
  const steps = (list: readonly Step[] | undefined): void => {
    for (const s of list ?? []) {
      used.add(`step:${s.do}`);
      if ('upTo' in s && s.upTo) used.add('upTo');
      if ('player' in s && s.player === 'opponent') used.add('player:opponent');
      // A change with no duration lasts until end of turn.
      if (s.do === 'power' || s.do === 'soul') used.add(`duration:${s.duration ?? 'turn'}`);
      switch (s.do) {
        case 'choose':
          selector(s.what);
          break;
        case 'discard':
        case 'salvage':
          filter(s.filter);
          break;
        case 'power':
        case 'soul':
        case 'sendToWaiting':
        case 'returnToHand':
          target(s.target);
          break;
        case 'lookTop':
          used.add(`lookRest:${s.rest}`);
          if (s.take) {
            used.add('lookTop:take');
            used.add(`lookTo:${s.take.to}`);
            if (s.take.upTo) used.add('upTo');
            if (s.take.filter) {
              used.add('lookTop:filter');
              filter(s.take.filter);
            }
          }
          break;
        case 'may':
          steps(s.steps);
          if (s.then) used.add('may:then');
          if (s.else) used.add('may:else');
          steps(s.then);
          steps(s.else);
          break;
        case 'if':
          s.when.forEach(condition);
          if (s.else) used.add('if:else');
          steps(s.then);
          steps(s.else);
          break;
        case 'draw':
        case 'stockFromDeck':
        case 'heal':
        case 'damageOpp':
          break;
      }
    }
  };
  const ability = (a: Ability) => {
    used.add(`ability:${a.kind}`);
    switch (a.kind) {
      case 'activated':
        used.add(`timing:${a.timing}`);
        cost(a.cost);
        if (a.when?.length) used.add('condition:activated.when');
        a.when?.forEach(condition);
        steps(a.effect);
        break;
      case 'automatic':
        used.add(`trigger:${a.trigger.on}`);
        if (a.trigger.on === 'climaxPlayed' && a.trigger.name) used.add('trigger:climaxPlayed.name');
        if (a.cost) used.add('cost:automatic');
        cost(a.cost);
        steps(a.effect);
        break;
      case 'continuous':
        if (a.when?.length) used.add('condition:continuous.when');
        a.when?.forEach(condition);
        for (const m of a.modifiers) {
          used.add(`modifier:${m.stat}`);
          if (m.target !== 'this') {
            used.add('modifier:selector');
            selector(m.target);
          }
        }
        break;
    }
  };
  for (const def of defs) {
    def.abilities?.forEach(ability);
    steps(def.effect);
  }
  return used;
}

/** Feature keys the language has that these cards never use. */
export function missingFeatures(defs: readonly CardDef[]): string[] {
  const used = featuresOf(defs);
  return allFeatures().filter((f) => !used.has(f));
}
