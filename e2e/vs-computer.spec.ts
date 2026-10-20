import { expect, test } from '@playwright/test';

import { expectNoOverflow, fixedEntropy, shot, startGame, watchProblems } from './helpers';

// A whole game against the computer, by tapping the first button each time,
// until the game-over screen. The computer moves at once (?fast=1).
test('a full game against the computer reaches the game-over screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone-390', 'one phone size is enough for a full game');
  test.setTimeout(180_000);
  const problems = watchProblems(page);
  await fixedEntropy(page, 21);
  await startGame(page, 'computer', '?fast=1');
  const started = Date.now();
  let taps = 0;
  const choice = page.getByTestId('choice-0');
  const over = page.getByTestId('gameover-screen');
  for (; taps < 900; taps++) {
    await expect(choice.or(over).first()).toBeVisible();
    if (await over.isVisible()) break;
    if (taps === 40) await shot(page, info, 'vs-computer-midgame');
    await choice.click();
  }
  await expect(over).toBeVisible();
  console.log(`vs-computer: ${taps} taps in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  await expect(page.getByTestId('gameover-title')).toHaveText(/You win!|The computer wins|Draw/);
  await expectNoOverflow(page, 'game over');
  await shot(page, info, 'vs-computer-end');
  // Rematch starts a new game straight away.
  await page.getByTestId('gameover-rematch').click();
  await expect(page.getByTestId('prompt-title')).toHaveText('Mulligan');
  expect(problems).toEqual([]);
});
