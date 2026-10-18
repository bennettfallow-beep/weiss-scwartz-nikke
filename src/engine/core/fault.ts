/**
 * An EngineFault means the engine itself is broken (a bug), never that a
 * player's input was illegal. Illegal input is reported as a result value.
 */
export class EngineFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineFault';
  }
}

/**
 * Describes an untrusted value for an error message, and never throws. Strings
 * and plain numbers are shown as they are; anything else by its type, because
 * turning an arbitrary object into text can itself throw.
 */
export function shown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return 'a list';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
