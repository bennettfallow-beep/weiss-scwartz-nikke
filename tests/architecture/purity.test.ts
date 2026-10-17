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

const PURE_LAYERS: readonly Layer[] = ['engine', 'cards', 'ai', 'session'];

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full, filter);
    return filter(name) ? [full] : [];
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

function scan(file: string): ts.PreProcessedFileInfo {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
}

const files = LAYERS.flatMap((layer) => listFiles(join(SRC, layer), (name) => /\.(ts|tsx)$/.test(name)));

describe('architecture: layer purity', () => {
  it('finds source files to check', () => {
    expect(files.some((f) => layerOf(f) === 'engine')).toBe(true);
  });

  // .js/.tsx/.d.ts files would escape tsconfig.engine.json and parts of lint. The one exception is card
  // data: JSON files under src/cards/sets/ (data only, no code).
  it('pure layers contain only plain .ts source files, plus card data in src/cards/sets/', () => {
    const offenders = PURE_LAYERS.flatMap((layer) => listFiles(join(SRC, layer), (name) => !/\.ts$/.test(name) || /\.d\.ts$/.test(name)))
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => !/^src\/cards\/sets\/[^/]+\.json$/.test(f));
    expect(offenders).toEqual([]);
  });

  for (const file of files) {
    const layer = layerOf(file);
    if (!layer) continue;
    const label = relative(ROOT, file);

    it(`${label} imports only what the ${layer} layer allows`, () => {
      const problems: string[] = [];
      const info = scan(file);
      if (layer !== 'ui') {
        // One `/// <reference lib="dom" />` would give every pure file DOM types.
        for (const ref of [...info.libReferenceDirectives, ...info.typeReferenceDirectives, ...info.referencedFiles]) {
          problems.push(`triple-slash reference "${ref.fileName}" is not allowed in ${layer}`);
        }
      }
      for (const spec of info.importedFiles.map((f) => f.fileName)) {
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
