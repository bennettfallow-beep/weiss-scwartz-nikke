// Fuzz games where the red fuzz deck is player 0's deck. See harness.ts.
import { describe } from 'vitest';

import { fuzzFile } from './harness';

describe('fuzz: red deck as player 0', () => {
  fuzzFile(1);
});
