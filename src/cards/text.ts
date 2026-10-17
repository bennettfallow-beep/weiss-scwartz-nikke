// Names and printed card text as they come in from card files.
//
// The engine compares names exactly (CR 2.1.1), so every name is stored in one
// normal form. Printed text lines are display-only; they are normalized so the
// same meaning always reads the same way.

/** Characters that mean a name still carries print-only marks (CR 2.1.1.1-2.1.1.2). */
const LEFTOVER_MARKS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /[̵-̸]/u, what: 'a strike-through or overlay mark' },
  { pattern: /<\s*\/?\s*(ruby|rt|rp|rb)\b/iu, what: 'reading-aid (ruby) markup' },
  { pattern: /[\r\n]/u, what: 'a line break' },
];

/**
 * The rules name in its one normal form: Unicode NFC, no space at either end,
 * and single spaces inside (CR 2.1.1). Reading aids and struck-through parts
 * are never part of it; a card file keeps them in `printedName`.
 */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
}

/** Why `raw` cannot be a rules name, or null if it can. */
export function nameProblem(raw: string): string | null {
  const found = LEFTOVER_MARKS.find((m) => m.pattern.test(raw));
  return found ? `contains ${found.what}; put the printed form in printedName and the rules name in name` : null;
}

/** Whether a name is already in normal form. */
export const isNormalName = (raw: string): boolean => normalizeName(raw) === raw && nameProblem(raw) === null;

const ICON_WORDS = {
  STAND: { verb: 'stand', state: 'standing' },
  REST: { verb: 'rest', state: 'rested' },
  REVERSE: { verb: 'reverse', state: 'reversed' },
} as const;

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** True when `offset` starts a sentence in `text`. */
const sentenceStart = (text: string, offset: number) => /(^|[.!?:]\s+|["'(「]\s*)$/u.test(text.slice(0, offset));

/**
 * One printed text line in normal form:
 * - the stand, rest and reverse icons, written `[STAND]` `[REST]` `[REVERSE]`
 *   (or in 【】), become the words they stand for (CR 4.6.1.1.1, 4.6.1.2.1,
 *   4.6.1.3.1); after "become"/"is" they read as the state ("rested");
 * - "CX phase" means the climax phase (CR 6.6.2). A bare "CX" is left alone.
 * Normalizing twice changes nothing.
 */
export function normalizeCardText(line: string): string {
  const icons = line.replace(/[[【]\s*(STAND|REST|REVERSE)\s*[\]】]/giu, (_m, icon: string, offset: number, all: string) => {
    const words = ICON_WORDS[icon.toUpperCase() as keyof typeof ICON_WORDS];
    const afterBe = /\b(becomes?|became|is|are|was|were|be|being)\s+$/iu.test(all.slice(0, offset));
    const word = afterBe ? words.state : words.verb;
    return sentenceStart(all, offset) ? capitalize(word) : word;
  });
  return icons.replace(/\bCX(\s+)(phase)\b/giu, (_m, space: string, phase: string, offset: number, all: string) => {
    const proper = phase.charAt(0) === 'P';
    const text = `${proper ? 'Climax' : 'climax'}${space}${phase}`;
    return sentenceStart(all, offset) ? capitalize(text) : text;
  });
}
