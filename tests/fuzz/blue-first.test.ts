// Fuzz games where the blue fuzz deck is player 0's deck. See harness.ts.
import { describe } from 'vitest';

import { fuzzFile } from './harness';

describe('fuzz: blue deck as player 0', () => {
  fuzzFile(2);
});
