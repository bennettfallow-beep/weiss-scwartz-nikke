import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { backgroundAndReturn, expectCleanHandoff, expectNoOverflow, fixedEntropy, shot, startGame, watchProblems } from './helpers';

// Two players on one phone (M5, definition of done item 5): whenever the
// phone must change hands, the screen shows no card at all and the board is
// not even in the page. That includes the defender's counter step and coming
// back from another app.

async function continueAs(page: Page): Promise<string> {
  const name = (await page.getByTestId('handoff-screen').locator('[role="heading"]').textContent()) ?? '';
  await page.getByTestId('handoff-continue').click();
  await expect(page.getByTestId('board-screen')).toBeVisible();
  return name.replace('Pass the phone to ', '');
}

test('the handoff screens at the start and after each mulligan show nothing private', async ({ page }, info) => {
  const problems = watchProblems(page);
  await fixedEntropy(page, 11);
  await startGame(page, 'hotseat');
  await expectCleanHandoff(page, 'first handoff');
  await expect(page.getByTestId('handoff-screen')).toContainText('goes first (chosen at random)');
  await expectNoOverflow(page, 'handoff');
  await shot(page, info, 'handoff');

  const first = await continueAs(page);
  await expect(page.getByTestId('prompt-title')).toHaveText('Mulligan');
  const firstHand = await page.getByTestId('hand').innerText();
  await page.getByTestId('choice-0').click();

  await expectCleanHandoff(page, 'handoff after the first mulligan');
  const second = await continueAs(page);
  expect(second).not.toBe(first);
  await expect(page.getByTestId('prompt-title')).toHaveText('Mulligan');
  // The second player sees their own hand, not the first player's.
  expect(await page.getByTestId('hand').innerText()).not.toBe(firstHand);
  await page.getByTestId('choice-0').click();
  await expectCleanHandoff(page, 'handoff after the second mulligan');
  expect(problems).toEqual([]);
});

test('coming back from another app shows the handoff screen, with any open panel closed', async ({ page }) => {
  const problems = watchProblems(page);
  await fixedEntropy(page, 12);
  await startGame(page, 'hotseat');
  await continueAs(page);
  await page.getByTestId('btn-log').click();
  await expect(page.getByTestId('log-sheet')).toBeVisible();
  await backgroundAndReturn(page);
  await expectCleanHandoff(page, 'handoff after returning');
  await expect(page.getByTestId('log-sheet')).toHaveCount(0);
  await continueAs(page);
  await expect(page.getByTestId('log-sheet')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('the defender is handed the phone for the counter step, and that handoff is clean too', async ({ page }, info) => {
  test.setTimeout(120_000);
  const problems = watchProblems(page);
  await fixedEntropy(page, 13);
  await startGame(page, 'hotseat');
  let counter = false;
  let handoffs = 0;
  let playedThisTurn = '';
  for (let i = 0; i < 400 && !counter; i++) {
    if (await page.getByTestId('handoff-screen').isVisible()) {
      const context = (await page.getByTestId('handoff-screen').innerText()) ?? '';
      await expectCleanHandoff(page, `handoff ${handoffs}`);
      handoffs++;
      if (context.includes('Counter step')) {
        counter = true;
        await shot(page, info, 'handoff-counter');
        break;
      }
      await page.getByTestId('handoff-continue').click();
      continue;
    }
    if (await page.getByTestId('gameover-screen').isVisible()) break;
    await expect(page.getByTestId('prompt-title')).toBeVisible();
    const title = (await page.getByTestId('prompt-title').textContent()) ?? '';
    const turn = (await page.getByTestId('header-turn').textContent()) ?? '';
    // Put a character in the middle position each turn: middle faces middle, so attacks become front attacks.
    if (title === 'Main phase' && playedThisTurn !== turn) {
      playedThisTurn = turn;
      const groups = await page.getByTestId(/^group-\d+$/).count();
      let played = false;
      for (let g = 0; g < groups && !played; g++) {
        await page.getByTestId(`group-${g}`).click();
        const center = page.getByText('Play to Center', { exact: true });
        if ((await center.count()) > 0) {
          await center.click();
          played = true;
        } else await page.getByTestId('group-back').click();
      }
      if (played) continue;
    }
    await page.getByTestId('choice-0').click();
  }
  expect(counter, 'reached a counter step').toBe(true);
  await page.getByTestId('handoff-continue').click();
  await expect(page.getByTestId('prompt-title')).toHaveText('Counter step');
  await expect(page.getByTestId('choice-0')).toBeVisible();
  expect(problems).toEqual([]);
});
