// Dark sci-fi palette. WCAG contrast ratios, computed (AA body text needs 4.5:1):
//   on bg:    text 15.7, dim 8.0, accent 11.1, danger 6.8
//   on panel: text 14.0, dim 7.2, accent 9.9,  danger 6.1
export const colors = {
  bg: '#0f1115',
  panel: '#1a1d24',
  panelHigh: '#242833',
  line: '#3a3f4c',
  text: '#e8eaf0',
  dim: '#a4a9b6',
  accent: '#5fd4ff',
  accentInk: '#06141a',
  danger: '#ff6b6b',
  ok: '#7ee08a',
} as const;

/** Card colors. A card's color is always written out as well; these only add a stripe. */
export const cardColors = {
  yellow: '#f2c94c',
  green: '#6fcf7f',
  red: '#ff7a7a',
  blue: '#6fb3ff',
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;

/** Smallest touch target (WCAG 2.5.5 / platform guidance). */
export const minTouch = 44;

export const font = { small: 12, body: 15, title: 18, big: 24 } as const;
