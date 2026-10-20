// Shared steps for the browser tests (M5).
import type { Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

import synFile from '../src/cards/sets/syn-001.json';

/** Every starter card name: none may appear on a handoff screen. */
export const CARD_NAMES: readonly string[] = [...new Set((synFile.cards as { name: string }[]).map((c) => c.name))];

/** Collects console errors and page errors; the test asserts the list is empty at the end. */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/**
 * Fixed randomness, so a game deals the same cards every run. The app asks the
 * browser for random bytes (crypto.getRandomValues); this replaces that one
 * function before the app loads. The app itself has no test switch for seeds.
 */
export async function fixedEntropy(page: Page, seed = 1): Promise<void> {
  await page.addInitScript((start: number) => {
    let s = start >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) & 0xff;
    };
    const fill = <T extends ArrayBufferView | null>(array: T): T => {
      if (array) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let i = 0; i < bytes.length; i++) bytes[i] = next();
      }
      return array;
    };
    Object.defineProperty(window.crypto, 'getRandomValues', { value: fill, configurable: true });
  }, seed);
}

export async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `no horizontal scroll on ${where}`).toBeLessThanOrEqual(0);
}

export async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/artifacts/screenshots/${name}-${info.project.name}.png` });
}

/** What the page shows a person right now: all visible text plus every testID. */
export async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText + '\n' + document.documentElement.outerHTML);
}

/** The handoff screen must carry no card names, no card ids, no board, and nothing stored. */
export async function expectCleanHandoff(page: Page, where: string): Promise<void> {
  await expect(page.getByTestId('handoff-screen')).toBeVisible();
  await expect(page.getByTestId('board-screen'), `board unmounted at ${where}`).toHaveCount(0);
  const text = await pageText(page);
  for (const name of CARD_NAMES) expect(text.includes(name), `${where}: "${name}" on the handoff screen`).toBe(false);
  expect(text, `${where}: card ids on the handoff screen`).not.toMatch(/p[01]-\d\d/);
  const stored = await page.evaluate(() => [window.localStorage.length, window.sessionStorage.length]);
  expect(stored, `${where}: nothing stored`).toEqual([0, 0]);
}

/** Simulates the app going to the background and coming back (the page becomes hidden, then visible). */
export async function backgroundAndReturn(page: Page): Promise<void> {
  for (const state of ['hidden', 'visible']) {
    await page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
      Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  }
}

export async function startGame(page: Page, mode: 'hotseat' | 'computer', query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.getByTestId(mode === 'hotseat' ? 'home-hotseat' : 'home-computer').click();
  await expect(page.getByTestId('newgame-screen')).toBeVisible();
  await page.getByTestId('newgame-start').click();
}
