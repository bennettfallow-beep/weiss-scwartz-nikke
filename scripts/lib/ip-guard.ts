// Keeps official card data out of git (CLAUDE.md, IP rules). Personal card
// files for official sets live only in local-cards/ (gitignored) or on the
// device; the repository holds original cards only.

/** Set codes the repository may contain: the original SYN test set and test-only TST cards. */
export const ALLOWED_SET_CODES: readonly string[] = ['SYN', 'TST'];
export const PERSONAL_DIR = 'local-cards/';

/**
 * A card number: a set code, a slash (also written JSON-escaped), a release
 * code that starts with a letter and has digits, a dash, and a number with at
 * least two digits, in any case. Paths such as "docs/rules-matrix" or
 * "draft/2020-12" do not fit, so they never match.
 */
export const CARD_NUMBER_LIKE = /\b([A-Za-z][A-Za-z0-9]{1,5})(?:\/|\\\/|\\u002[fF])([A-Za-z]{1,4}\d{1,4}[A-Za-z]{0,3})-([A-Za-z]{0,3}\d{2,4}[A-Za-z]{0,6})\b/g;

const allowed = (code: string) => ALLOWED_SET_CODES.includes(code.toUpperCase());

export interface GuardInput {
  /** Every file git tracks or would add (not ignored), relative to the repository root, with "/" separators. */
  files: readonly string[];
  /** The file's text, or null when it is binary or no longer exists. */
  read: (path: string) => string | null;
  /** Whether git ignores this path. */
  ignored: (path: string) => boolean;
}

/** Card-set files (an object with a list of cards) found in a JSON text, if it is one. */
function cardSetIn(text: string): { code?: unknown; cards: unknown[] } | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const { set, cards } = value as { set?: { code?: unknown }; cards?: unknown };
    return Array.isArray(cards) ? { code: set?.code, cards } : null;
  } catch {
    return null;
  }
}

/** Problems, one line each; empty when the repository is clean. */
export function ipGuard(input: GuardInput): string[] {
  const problems: string[] = [];
  for (const f of input.files.filter((t) => t.startsWith(PERSONAL_DIR))) problems.push(`${f} is in git, but ${PERSONAL_DIR} holds personal card data and must never be committed`);
  if (!input.ignored(`${PERSONAL_DIR}probe.json`)) problems.push(`${PERSONAL_DIR} is not ignored by git; add it to .gitignore`);

  for (const file of input.files) {
    if (file === 'package-lock.json') continue;
    const text = input.read(file);
    if (text === null) continue;
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(CARD_NUMBER_LIKE)) {
        if (!allowed(m[1] ?? '')) problems.push(`${file}:${i + 1}: card number ${m[0]} is not from an original set (${ALLOWED_SET_CODES.join(', ')})`);
      }
    });
    // Any card-set file in git is an original set, and links no card art (pictures are for personal files only).
    if (/\.json$/i.test(file)) {
      const set = cardSetIn(text);
      if (set && typeof set.code === 'string' && !allowed(set.code)) problems.push(`${file}: a card set with code ${set.code} is not an original set`);
      if (set?.cards.some((c) => typeof c === 'object' && c !== null && Object.hasOwn(c, 'art'))) problems.push(`${file}: a card file in git must not link card art`);
    }
  }
  return problems;
}
