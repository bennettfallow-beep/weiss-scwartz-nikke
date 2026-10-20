import { expect, test } from '@playwright/test';

import { expectNoOverflow, fixedEntropy, shot, startGame, watchProblems } from './helpers';

// Every screen renders without console errors and fits a phone-width
// viewport. Screenshots are for the owner's review, not pixel comparisons.

test('home screen renders cleanly at phone width', async ({ page }, info) => {
  const problems = watchProblems(page);
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Frontline Duel' })).toBeVisible();
  await expect(page.getByTestId('rules-version')).toHaveText(/Comprehensive Rules v2\.10/);
  await expectNoOverflow(page, 'home');
  await shot(page, info, 'home');
  await page.getByTestId('home-help').click();
  await expect(page.getByTestId('help-screen')).toBeVisible();
  await expectNoOverflow(page, 'help');
  await shot(page, info, 'help');
  await page.getByTestId('help-back').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a game against the computer: every board screen and panel', async ({ page }, info) => {
  const problems = watchProblems(page);
  await fixedEntropy(page, 7);
  await page.goto('/?fast=1');
  await page.getByTestId('home-computer').click();
  await expect(page.getByTestId('newgame-screen')).toBeVisible();
  await page.getByTestId('deck-0-blue').click();
  await expect(page.getByTestId('deck-0-blue')).toContainText('Selected');
  await expectNoOverflow(page, 'new game');
  await shot(page, info, 'newgame');
  await page.getByTestId('newgame-start').click();

  // Mulligan: mark a card, then keep the rest.
  await expect(page.getByTestId('board-screen')).toBeVisible();
  await expect(page.getByTestId('prompt-title')).toHaveText('Mulligan');
  await page.getByTestId('mulligan-card-0').click();
  await expect(page.getByTestId('choice-0')).toContainText('Discard 1 card');
  await expectNoOverflow(page, 'mulligan');
  await shot(page, info, 'board-mulligan');
  await page.getByTestId('mulligan-card-0').click();
  await expect(page.getByTestId('choice-0')).toContainText('Keep this hand');
  await page.getByTestId('choice-0').click();

  // Play on until the human has a main phase with a card to use.
  for (let i = 0; i < 40; i++) {
    await expect(page.getByTestId('prompt-title')).toBeVisible();
    const title = await page.getByTestId('prompt-title').textContent();
    if (title === 'Main phase' && (await page.getByTestId('group-0').count()) > 0) break;
    await page.getByTestId('choice-0').click();
  }
  await expect(page.getByTestId('prompt-title')).toHaveText('Main phase');
  await page.getByTestId('group-0').click();
  await expect(page.getByTestId('group-back')).toBeVisible();
  await expectNoOverflow(page, 'board');
  await shot(page, info, 'board-main');
  await page.getByTestId('group-back').click();

  await page.getByTestId('btn-log').click();
  await expect(page.getByTestId('log-sheet')).toBeVisible();
  await shot(page, info, 'log');
  await page.getByTestId('sheet-close').click();

  await page.getByTestId('you-clock').click();
  await expect(page.getByTestId('zone-sheet')).toBeVisible();
  await page.getByTestId('sheet-close').click();

  // Tapping a card that can do nothing now opens its full text.
  await page.getByTestId('hand-card-0').scrollIntoViewIfNeeded();
  await page.getByTestId('hand-card-0').click();
  if ((await page.getByTestId('card-detail').count()) > 0) {
    await shot(page, info, 'card-detail');
    await page.getByTestId('sheet-close').click();
  } else await page.getByTestId('group-back').click();
  await page.getByTestId('btn-menu').click();
  await expect(page.getByTestId('menu-sheet')).toBeVisible();
  await shot(page, info, 'menu');
  await page.getByTestId('menu-concede').click();
  await expect(page.getByTestId('concede-dialog')).toBeVisible();
  await page.getByTestId('concede-confirm').click();

  await expect(page.getByTestId('gameover-screen')).toBeVisible();
  await expect(page.getByTestId('gameover-title')).toHaveText('The computer wins');
  await expect(page.getByTestId('gameover-result')).toContainText('you conceded');
  await expectNoOverflow(page, 'game over');
  await shot(page, info, 'gameover');
  await page.getByTestId('gameover-home').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  expect(problems).toEqual([]);
});

test('card detail opens from a long press', async ({ page }, info) => {
  const problems = watchProblems(page);
  await fixedEntropy(page, 3);
  await startGame(page, 'computer', '?fast=1');
  await expect(page.getByTestId('hand-card-0')).toBeVisible();
  const card = page.getByTestId('hand-card-0');
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  if (!box) throw new Error('no card');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByTestId('card-detail')).toBeVisible();
  await expectNoOverflow(page, 'card detail');
  await shot(page, info, 'card-detail');
  await page.getByTestId('sheet-close').click();
  await expect(page.getByTestId('card-detail')).toHaveCount(0);
  expect(problems).toEqual([]);
});
