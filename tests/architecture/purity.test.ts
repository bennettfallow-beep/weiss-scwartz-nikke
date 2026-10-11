// Enforces the layer graph:
//   engine  <- cards, ai, session, ui
//   cards   <- session, ui
//   ai      <- session, ui
//   session <- ui
// The engine imports nothing outside itself. cards may also import zod.
// Other layers may only enter a pure layer through its index.ts barrel.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');
const LAYERS = ['engine', 'cards', 'ai', 'session', 'ui'] as const;
type Layer = (typeof LAYERS)[number];

const ALLOWED_LAYER_DEPS: Record<Layer, readonly Layer[]> = {
  engine: [],
  cards: ['engine'],
  ai: ['engine'],
  session: ['engine', 'cards', 'ai'],
  ui: ['engine', 'cards', 'ai', 'session'],
};
const ALLOWED_PACKAGES: Record<Layer, (pkg: string) => boolean> = {
  engine: () => false,
  cards: (pkg) => pkg === 'zod',
  ai: () => false,
  session: () => false,
  ui: () => true,
};

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function layerOf(file: string): Layer | null {
  const top = relative(SRC, file).split(/[\\/]/)[0];
  return (LAYERS as readonly string[]).includes(top ?? '') ? (top as Layer) : null;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
  return info.importedFiles.map((f) => f.fileName);
}

const files = LAYERS.flatMap((layer) => listFiles(join(SRC, layer)));

describe('architecture: layer purity', () => {
  it('finds source files to check', () => {
    expect(files.some((f) => layerOf(f) === 'engine')).toBe(true);
  });

  for (const file of files) {
    const layer = layerOf(file);
    if (!layer) continue;
    const label = relative(ROOT, file);

    it(`${label} imports only what the ${layer} layer allows`, () => {
      const problems: string[] = [];
      for (const spec of importsOf(file)) {
        if (!spec.startsWith('.')) {
          const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);
          if (!ALLOWED_PACKAGES[layer](pkg)) problems.push(`package "${spec}" is not allowed in ${layer}`);
          continue;
        }
        const target = resolveRelative(file, spec);
        if (!target) {
          problems.push(`cannot resolve "${spec}"`);
          continue;
        }
        const targetLayer = layerOf(target);
        if (targetLayer === layer) continue;
        if (!targetLayer) {
          problems.push(`"${spec}" leaves src/`);
          continue;
        }
        if (!ALLOWED_LAYER_DEPS[layer].includes(targetLayer)) {
          problems.push(`${layer} may not import ${targetLayer} ("${spec}")`);
          continue;
        }
        const barrel = join(SRC, targetLayer, 'index.ts');
        if (target !== barrel) problems.push(`"${spec}" bypasses the ${targetLayer} barrel (src/${targetLayer}/index.ts)`);
      }
      expect(problems).toEqual([]);
    });
  }
});
