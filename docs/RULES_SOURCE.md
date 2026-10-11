# Rules source

The engine implements one document:

| Field | Value |
|---|---|
| Title | Weiß Schwarz (English Edition) Comprehensive Rules |
| Version | 2.10 |
| Last updated (per the document) | 2025-09-17 |
| Pages | 24 |
| SHA-256 of the PDF | `22ba30c0eae920dd36dcdd3e0fef13a84f1992235edf59351f0c6a66492d026a` |
| Publisher | Bushiroad (official rules page: en.ws-tcg.com/rules/) |
| Received | 2026-10-11, uploaded by the project owner |

## Where the text lives

- The PDF and its `pdftotext` output are copyrighted and are **not** in git. Keep them at
  `docs/_private/WSE-Comprehensive-Rules-v2.10.pdf` (gitignored).
- `docs/cr-sections.json` (committed) holds only the list of section numbers and the hash.
  `npm run rules:sections` rebuilds it from the private PDF.
- `docs/rules-matrix.json` holds our own paraphrase of each rule plus its section number.

## Updating to a new version

1. Put the new PDF in `docs/_private/` and update the file name in `scripts/extract-cr-sections.ts`.
2. Run `npm run rules:sections`, then `npm run check:matrix`. Every citation that no longer
   exists fails.
3. Read the new changelog (last pages of the PDF). For each changed section, re-check the
   matching matrix rows and their tests.
4. Bump `RULES_SOURCE` in `src/engine/index.ts`. Saved games record the rules version and
   will refuse to resume across versions.
