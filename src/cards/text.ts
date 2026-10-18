// Names and printed card text as they come in from card files.
//
// The engine compares names exactly (CR 2.1.1), so every name is stored in one
// normal form. Printed text lines are display-only; they are normalized so the
// same meaning always reads the same way.

/** Characters that mean a name still carries print-only marks (CR 2.1.1.1-2.1.1.2), or is not one line. */
const LEFTOVER_MARKS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /[\u0335-\u0338]/u, what: 'a strike-through or overlay mark' },
  { pattern: /<\s*\/?\s*(ruby|rt|rp|rb)\b/iu, what: 'reading-aid (ruby) markup' },
  { pattern: /[\r\n\v\f\u0085\u2028\u2029]/u, what: 'a line break' },
];

/**
 * Invisible formatting characters (soft hyphen, zero-width spaces and joiners,
 * direction marks, variation selectors, byte-order mark). Web pages often
 * carry them; two names that differ only by them look the same and are the
 * same name.
 */
// Combining characters are listed apart from the others so none can combine with its neighbour in the class.
const INVISIBLE = /[\u00ad\u061c\u115f\u1160\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]|\u034f|\u17b4|\u17b5|[\u180b-\u180f]|[\ufe00-\ufe0f]/gu;

/**
 * The rules name in its one normal form: Unicode NFC, no invisible formatting
 * characters, no space at either end, and single spaces inside (CR 2.1.1).
 * Reading aids and struck-through parts are never part of it; a card file
 * keeps them in `printedName`.
 */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(INVISIBLE, '').trim().replace(/\s+/gu, ' ');
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

/** How much text before a match decides its form; keeps each line linear in its length. */
const LOOK_BACK = 40;
const before = (all: string, offset: number) => all.slice(Math.max(0, offset - LOOK_BACK), offset);
const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** True when `offset` starts a sentence in `text`. */
const sentenceStart = (all: string, offset: number) => {
  const prefix = before(all, offset);
  return (offset <= LOOK_BACK && /^\s*$/u.test(prefix)) || /([.!?:]\s+|["'(\u300c]\s*)$/u.test(prefix);
};
/** The icon describes a state: after a form of "be", "become", "remain" or "stay" (also with "not" or "still"), or after "as". */
const statePosition = (all: string, offset: number) =>
  /\b(?:(?:is|are|was|were|be|being|been|becomes?|became|becoming|remains?|stays?|it's|that's)(?:n't)?(?:\s+(?:not|still|already))?|as)\s+$/iu.test(before(all, offset));
/** The icon is used as an adjective before a noun ("your [REST] characters"). */
const beforeNoun = (all: string, end: number) => /^\s+(?:characters?|cards?)\b/iu.test(all.slice(end, end + 16));

/**
 * One printed text line in normal form:
 * - the stand, rest and reverse icons, written `[STAND]` `[REST]` `[REVERSE]`
 *   (upper case, or in 【】), become the words they stand for (CR 4.6.1.1.1,
 *   4.6.1.2.1, 4.6.1.3.1): the state ("rested") after "is", "becomes", "as"
 *   and before "character(s)", otherwise the verb ("rest");
 * - "CX phase" means the climax phase (CR 6.6.2). A bare "CX" is left alone.
 * Normalizing twice changes nothing: the words written are lower or title
 * case, and only the upper-case tokens are replaced.
 */
export function normalizeCardText(line: string): string {
  const icons = line.replace(/[[\u3010]\s*(STAND|REST|REVERSE)\s*[\]\u3011]/gu, (match: string, icon: keyof typeof ICON_WORDS, offset: number, all: string) => {
    const words = ICON_WORDS[icon];
    const word = statePosition(all, offset) || beforeNoun(all, offset + match.length) ? words.state : words.verb;
    return sentenceStart(all, offset) ? capitalize(word) : word;
  });
  return icons.replace(/\bCX(\s+)(phase)\b/giu, (_m, space: string, phase: string, offset: number, all: string) => {
    const proper = phase.charAt(0) === 'P';
    const text = `${proper ? 'Climax' : 'climax'}${space}${phase}`;
    return sentenceStart(all, offset) ? capitalize(text) : text;
  });
}
