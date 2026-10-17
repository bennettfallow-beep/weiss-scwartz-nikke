// Card-set file format, version 1 (docs/CARDS.md).
//
// The schema checks the file's shape: types, ranges, allowed values and
// unknown keys. What a card of each kind may have is checked by the engine's
// validateCatalog, and abilities by its checkCardAbilities, so those rules
// live in one place.

import { z } from 'zod';

import { CARD_KINDS, COLORS, TRIGGER_ICONS } from '../engine';
import type { CardKind, Color, TriggerIcon } from '../engine';

export const SCHEMA_VERSION = 1;

/** A card number such as "SYN/T01-001": upper-case letters and digits in groups joined by "/" or "-". It is the engine card id. */
export const CARD_NUMBER = /^[A-Z0-9]+(?:[/-][A-Z0-9]+)*$/;
/** An https link with a host and no spaces, quotes or angle brackets. */
export const HTTPS_URL = /^https:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d{1,5})?(?:\/[^\s"'<>\\]*)?$/;

const tuple = <T extends string>(xs: readonly T[]) => xs as unknown as [T, ...T[]];
const whole = (min: number, max: number) => z.int().min(min).max(max);
const line = z.string().min(1).max(600);

const BackupSchema = z.strictObject({
  power: whole(0, 100000),
  level: whole(0, 3),
  stock: whole(0, 20),
});

export const CardRecordSchema = z.strictObject({
  number: z.string().max(32).regex(CARD_NUMBER),
  name: z.string().min(1).max(100),
  printedName: z.string().min(1).max(200).optional(),
  kind: z.enum(tuple<CardKind>(CARD_KINDS)),
  color: z.enum(tuple<Color>(COLORS)),
  level: whole(0, 3).optional(),
  cost: whole(0, 20).optional(),
  power: whole(0, 100000).optional(),
  soul: whole(0, 10).optional(),
  traits: z.array(z.string().min(1).max(40)).max(8).optional(),
  triggers: z.array(z.enum(tuple<TriggerIcon>(TRIGGER_ICONS))).max(2).optional(),
  counter: z.boolean().optional(),
  backup: BackupSchema.optional(),
  /** Ability-language data; checked by the engine's checkCardAbilities. */
  abilities: z.array(z.unknown()).optional(),
  effect: z.array(z.unknown()).optional(),
  /** Printed ability lines, for display only. */
  text: z.array(line).max(12).optional(),
  /** Printed lines the engine does not carry out, for display only. */
  unimplemented: z.array(line).max(12).optional(),
  rarity: z
    .string()
    .regex(/^[A-Za-z0-9+]{1,8}$/)
    .optional(),
  /** A link to the card's picture, downloaded on the device. Never a file in the repository. */
  art: z.strictObject({ url: z.string().max(500).regex(HTTPS_URL) }).optional(),
});

const SetInfoSchema = z.strictObject({
  code: z.string().regex(/^[A-Z0-9]{2,8}$/),
  name: z.string().min(1).max(100),
  edition: z.enum(['en', 'jp']).optional(),
});
const MAX_CARDS = 2000;

export const CardSetFileSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  set: SetInfoSchema,
  cards: z.array(CardRecordSchema).min(1).max(MAX_CARDS),
});

/** The file around its cards; the importer checks each card on its own so one bad card does not hide the rest. */
export const CardSetShellSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  set: SetInfoSchema,
  cards: z.array(z.unknown()).min(1).max(MAX_CARDS),
});

export type CardRecord = z.infer<typeof CardRecordSchema>;
export type CardSetFile = z.infer<typeof CardSetFileSchema>;

/** The format as a JSON Schema (schema/card-set.v1.json is generated from this). */
export function cardSetJsonSchema(): unknown {
  return z.toJSONSchema(CardSetFileSchema, { target: 'draft-2020-12', io: 'input' });
}
