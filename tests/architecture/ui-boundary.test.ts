// The UI reaches the game only through the session layer's screen models (M5).
// It may not read the game state, the seed or the random generator, and it
// gets randomness only from src/ui/platform/entropy.ts.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const UI = join(__dirname, '..', '..', 'src', 'ui');
const SRC = resolve(UI, '..');
const files = (readdirSync(UI, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).map((f) => f.split('\\').join('/'));
/** Session fields that hold the full game: the UI must never read them. */
const PRIVATE = new Set(['game', 'seed', 'rng', 'botRng']);

describe('UI boundary', () => {
  it('UI files exist', () => {
    expect(files).toContain('App.tsx');
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file}: only screen models from the session; nothing from the engine but types and the rules version`, () => {
      const text = readFileSync(join(UI, file), 'utf8');
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      for (const st of source.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
        const spec = st.moduleSpecifier.text;
        if (!spec.startsWith('.')) continue;
        const target = resolve(UI, dirname(file), spec);
        const layer = target.startsWith(SRC) ? target.slice(SRC.length + 1).split('/')[0] : null;
        if (layer !== 'engine' && layer !== 'cards' && layer !== 'ai') continue;
        const clause = st.importClause;
        if (!clause || clause.isTypeOnly) continue;
        const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
        expect(clause.name, `${file}: default import from ${layer}`).toBeUndefined();
        for (const el of named) if (!el.isTypeOnly) expect(layer === 'engine' && el.name.text === 'RULES_SOURCE', `${file} imports ${el.name.text} from ${layer}`).toBe(true);
      }
      const bad: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && PRIVATE.has(node.name.text)) bad.push(node.getText(source));
        if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && PRIVATE.has(node.argumentExpression.text)) bad.push(node.getText(source));
        if (ts.isPropertyAccessExpression(node) && node.name.text === 'random' && node.expression.getText(source) === 'Math') bad.push(node.getText(source));
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(bad, file).toEqual([]);
    });
  }

  it('only platform/entropy.ts imports expo-crypto', () => {
    const users = files.filter((f) => readFileSync(join(UI, f), 'utf8').includes("from 'expo-crypto'"));
    expect(users).toEqual(['platform/entropy.ts']);
  });
});
