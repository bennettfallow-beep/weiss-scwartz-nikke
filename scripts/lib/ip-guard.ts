// Keeps official card data out of git (CLAUDE.md, IP rules). Personal card
// files for official sets live only in local-cards/ (gitignored) or on the
// device; the repository holds original cards only.

/** Set codes the repository may contain: the original SYN test set and test-only TST cards. */
export const ALLOWED_SET_CODES: readonly string[] = ['SYN', 'TST'];
export const PERSONAL_DIR = 'local-cards/';

/** A card number: a set code in capitals, a slash, a release code, a dash, a number (like the SYN cards). */
export const CARD_NUMBER_LIKE = /\b([A-Z][A-Z0-9]{1,5})\/([A-Z0-9]{1,8})-([A-Z0-9]{1,6})\b/g;

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|json|md|txt|ya?ml)$/;
const SKIP = new Set(['package-lock.json']);

export interface GuardInput {
  /** Every file git tracks, relative to the repository root, with "/" separators. */
  tracked: readonly string[];
  read: (path: string) => string;
  /** Whether git ignores this path. */
  ignored: (path: string) => boolean;
}

/** Problems, one line each; empty when the repository is clean. */
export function ipGuard(input: GuardInput): string[] {
  const problems: string[] = [];
  for (const f of input.tracked.filter((t) => t.startsWith(PERSONAL_DIR))) problems.push(`${f} is tracked, but ${PERSONAL_DIR} holds personal card data and must never be committed`);
  if (!input.ignored(`${PERSONAL_DIR}probe.json`)) problems.push(`${PERSONAL_DIR} is not ignored by git; add it to .gitignore`);

  for (const file of input.tracked) {
    if (!TEXT_FILE.test(file) || SKIP.has(file.split('/').pop() ?? '')) continue;
    const text = input.read(file);
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(CARD_NUMBER_LIKE)) {
        if (!ALLOWED_SET_CODES.includes(m[1] ?? '')) problems.push(`${file}:${i + 1}: card number ${m[0]} is not from an original set (${ALLOWED_SET_CODES.join(', ')})`);
      }
    });
    // Card pictures are links in personal files only; a tracked card file never has one.
    if (file.startsWith('src/cards/sets/') && file.endsWith('.json') && /"art"\s*:/.test(text)) problems.push(`${file}: a tracked card file must not link card art`);
  }
  return problems;
}
