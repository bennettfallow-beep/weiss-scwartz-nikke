// Fuzz games where the yellow fuzz deck is player 0's deck. See harness.ts.
import { describe } from 'vitest';

import { fuzzFile } from './harness';

describe('fuzz: yellow deck as player 0', () => {
  fuzzFile(0);
});
