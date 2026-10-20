// How long the computer waits between its moves, so a person can follow them.
// `?fast=1` in the web address sets it to 0; the automated tests use that.
import { Platform } from 'react-native';

function fastFromUrl(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fast') === '1';
}

export const BOT_DELAY_MS = fastFromUrl() ? 0 : 450;
