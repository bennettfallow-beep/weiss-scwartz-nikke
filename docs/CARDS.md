# Card files and decklists

How cards and decks get into the game. The importer is `src/cards` (`importCardSet`,
`parseDecklist`); the format is checked by `schema/card-set.v1.json`.

## Where card files live

| What | Where | In git? |
|---|---|---|
| The SYN test set (original cards) | `src/cards/sets/syn-001.json` and `syn-001-decks.json` | Yes |
| Your personal card files for official sets (personal use) | `local-cards/` on a computer, or the app on your phone | **Never** |
| Card pictures for personal files | Links in the card file; the app downloads them on the phone | **Never** |

`npm run check:cards` checks every file that is in git or that git would add (not ignored). It
fails if:
- a file contains a card number from any set other than SYN or the test-only TST. Lower case and
  JSON-escaped slashes count too.
- anything in `local-cards/` is in git;
- a card file in git links art or has another set code.

## A card-set file (version 1)

A JSON file:

```json
{
  "schemaVersion": 1,
  "set": { "code": "SYN", "name": "Synthetic test set (original cards)" },
  "cards": [
    {
      "number": "SYN/Y01-012",
      "name": "Amber Surge",
      "kind": "climax",
      "color": "yellow",
      "triggers": ["soul", "shot"],
      "abilities": [{ "kind": "continuous", "modifiers": [{ "stat": "power", "amount": 1000, "target": { "side": "you" } }] }]
    }
  ]
}
```

### Card fields

| Field | Required | Meaning |
|---|---|---|
| `number` | yes | The card number, e.g. `SYN/Y01-001`: capitals and digits in groups joined by `/` or `-`, up to 32 characters. Decklists use it. |
| `name` | yes | The rules name (CR 2.1.1). Two cards with the same name share the 4-copy limit. Stored in one normal form: Unicode NFC, invisible formatting characters removed, single spaces. Line breaks, strike-through marks and ruby markup are rejected. |
| `printedName` | no | The name as printed, with reading aids or struck-through parts. Display only; never used by the rules (CARD-23). |
| `kind` | yes | `character`, `event` or `climax`. |
| `color` | yes | `yellow`, `green`, `red` or `blue`. |
| `level`, `cost` | characters, events | Whole numbers; level 0-3. Climaxes have neither. |
| `power`, `soul` | characters | Whole numbers. Only characters have them. |
| `traits` | no | Up to 8 trait names (characters only). |
| `triggers` | no | Up to 2 trigger icons: `soul`, `return`, `pool`, `comeback`, `draw`, `shot`, `treasure`, `gate`, `standby`, `choice`. |
| `counter` | no | `true` for a counter icon. |
| `backup` | no | `{ "power", "level", "stock" }`: the Backup keyword (characters only). |
| `abilities` | no | Up to 4 abilities in the ability language (characters, climaxes). See "Abilities" in `docs/ENGINE.md`. |
| `effect` | no | An event's effect, as ability-language steps. |
| `text` | no | The printed ability lines, for display. |
| `unimplemented` | no | Printed lines the engine does not carry out, for display. |
| `rarity` | no | Up to 8 letters, digits or `+`. |
| `art` | no | `{ "url": "https://..." }`: a link to the card's picture, downloaded on the phone. Personal files only. |

Any other field is an error, so typos are caught.

In `text` and `unimplemented`, the stand, rest and reverse icons are written `[STAND]`, `[REST]`
and `[REVERSE]` (upper case, or in 【】), and they display as words (CONC-15):
- **The state** ("rested", "standing", "reversed") after "is", "becomes", "remains", "as", and
  before "character(s)".
- **The verb** ("rest") everywhere else.

"CX phase" displays as "climax phase" (CLIMAX-04).

## Importing: lenient and strict

- **Lenient (default):**
  - An ability the engine cannot run is left out, with warnings. The card is still played,
    without that ability.
  - An event whose effect cannot run is played and does nothing.
  - A card with any other error is left out, and the rest of the file still imports.
- **Strict:**
  - Those ability and effect problems are errors too, and no cards are imported when there is any
    error.
  - The two warnings, `IMPORT_NAME_NORMALIZED` and `IMPORT_REFERENCE`, stay warnings.
  - The SYN set must import strictly with no issues at all.

A card number belongs to the first card that uses it, even if that card has other errors; later
cards with the same number are left out.

Every problem comes back as `{ severity, code, path, message }`. The path points into the file, e.g.
`cards.12.abilities.0.effect.1.count`. At most 200 are listed.

| Code | Meaning |
|---|---|
| `IMPORT_JSON` | Not valid JSON. |
| `IMPORT_TOO_LARGE` | Over 4,000,000 characters. |
| `IMPORT_VERSION` | `schemaVersion` missing or not 1. |
| `IMPORT_SHAPE` | Wrong type or missing field. |
| `IMPORT_FIELD` | Unknown field. |
| `IMPORT_RANGE` | Number or list size out of range, or a card whose data nests more than 32 levels deep. |
| `IMPORT_VALUE` | Not one of the allowed values (kind, color, icon). |
| `IMPORT_FORMAT` | Wrong format (card number, set code, rarity, art link). |
| `IMPORT_DUPLICATE` | A card number used twice. |
| `IMPORT_NAME` | A name or trait with print-only marks, or a card name in an ability that is not in normal form. |
| `IMPORT_NAME_NORMALIZED` (warning) | A name was stored in normal form. |
| `IMPORT_REFERENCE` (warning) | An ability names a card that is not in this set. |
| `IMPORT_ABILITY_DROPPED` (warning) | An ability or event effect was left out (lenient). |
| `IMPORT_LIMIT` | More issues than are listed. |
| `CATALOG_*` | Card rules, e.g. a climax with a level (from the engine's own check). |
| `ABILITY_*` | Ability-language problems (from the engine's own check). |

## Decklists

Plain text, one entry per line:

```
# Yellow starter
4 SYN/Y01-001  Amber Cadet
4x SYN/Y01-002
2 syn/y01-011  (card numbers match in any case; anything after the number and a space is ignored)
```

The reader reports bad lines, counts and unknown cards by line number. Then the deck rules apply:
50 cards, at most 4 per name, at most 8 climaxes (CR 5.1.2).
