/**
 * Flatten the app into one self-contained HTML file.
 *
 * The modular source needs a server, because browsers refuse ES modules over
 * file://. That is fine for development — the microphone needs a secure context
 * anyway — but it is a poor way to hand someone a copy. So this walks the
 * module graph from src/main.js, concatenates the files in dependency order,
 * strips the import/export keywords, and inlines the result along with the
 * stylesheet.
 *
 * It is not a general bundler. It assumes named exports, no default exports, no
 * circular imports, and no two modules declaring the same top-level name — all
 * of which it checks for rather than producing a silently broken file.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(root, 'src', 'main.js');
const OUT = join(root, 'dist', 'sruti-mirror.html');

const IMPORT = /^import\s+[\s\S]*?from\s+['"](.+?)['"];?\s*$/gm;
const BARE_IMPORT = /^import\s+['"](.+?)['"];?\s*$/gm;
const EXPORT = /^export\s+(?=(?:const|let|var|function|class|async)\b)/gm;
const DECLARATION = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/** Depth-first walk of the import graph, deepest dependency first. */
function collect(entry, seen = new Map(), stack = []) {
  const path = resolve(entry);
  if (stack.includes(path)) {
    throw new Error(`circular import: ${[...stack, path].map((p) => p.slice(root.length + 1)).join(' -> ')}`);
  }
  if (seen.has(path)) return seen;

  const source = readFileSync(path, 'utf8');
  const dependencies = [
    ...source.matchAll(IMPORT),
    ...source.matchAll(BARE_IMPORT),
  ].map((match) => match[1]);

  for (const dependency of dependencies) {
    if (!dependency.startsWith('.')) {
      throw new Error(`${path}: only relative imports are supported, got "${dependency}"`);
    }
    collect(join(dirname(path), dependency), seen, [...stack, path]);
  }

  seen.set(path, source);
  return seen;
}

function assertNoCollisions(modules) {
  const owners = new Map();
  for (const [path, source] of modules) {
    for (const match of source.matchAll(DECLARATION)) {
      const name = match[1];
      if (owners.has(name)) {
        throw new Error(
          `"${name}" is declared in both ${owners.get(name)} and ${path.slice(root.length + 1)}; `
          + 'top-level names must be unique for the single-file build',
        );
      }
      owners.set(name, path.slice(root.length + 1));
    }
  }
}

function strip(source) {
  return source
    .replace(IMPORT, '')
    .replace(BARE_IMPORT, '')
    .replace(EXPORT, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
    .trim();
}

function build() {
  const modules = collect(ENTRY);
  assertNoCollisions(modules);

  const script = [...modules]
    .map(([path, source]) => `// ---- ${path.slice(root.length + 1)} ${'-'.repeat(Math.max(0, 60 - path.slice(root.length + 1).length))}\n${strip(source)}`)
    .join('\n\n');

  const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8').trim();

  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html.replace('<link rel="stylesheet" href="src/styles.css">', `<style>\n${css}\n</style>`);
  html = html.replace(
    '<script type="module" src="src/main.js"></script>',
    `<script>\n(() => {\n${script}\n})();\n</script>`,
  );

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, html);

  const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
  console.log(`dist/sruti-mirror.html  ${kb} kB  (${modules.size} modules)`);
}

build();
