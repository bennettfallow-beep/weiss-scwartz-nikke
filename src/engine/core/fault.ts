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
