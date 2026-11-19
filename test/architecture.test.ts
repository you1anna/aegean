import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

const SOURCE = 'src';
/** Layers from the inside out. A module imports only from its own layer or an inner layer. */
const LAYERS = [['domain', 'src/domain/'], ['adapters', 'src/adapters/'], ['application', 'src/application/'], ['entry point', 'src/cli.ts']] as const;
const layerOf = (file: string): number => LAYERS.findIndex(([, prefix]) => file === prefix || file.startsWith(prefix));

/** The relative imports of each source module, as source paths. Type-only and dynamic imports count. */
async function importGraph(): Promise<Map<string, string[]>> {
  const files = (await readdir(SOURCE, { recursive: true })).filter(name => name.endsWith('.ts')).map(name => join(SOURCE, name));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const targets = [...source.matchAll(/(?:from\s+|import\s*\(?\s*)['"](\.{1,2}\/[^'"]+)\.js['"]/g)].map(match => normalize(join(dirname(file), `${match[1]}.ts`)));
    graph.set(file, [...new Set(targets)]);
  }
  return graph;
}

test('domain modules do not depend on process, persistence or orchestration adapters', async () => {
  for (const name of await readdir('src/domain')) {
    const source = await readFile(join('src/domain', name), 'utf8');
    assert.doesNotMatch(source, /from\s+['"][^'"]*(application|adapters|node:fs|node:child_process|node:http)/);
  }
});

test('every source module belongs to a layer and imports only from its own or an inner layer', async () => {
  const graph = await importGraph();
  assert.ok(graph.size > 0);
  for (const [file, targets] of graph) {
    assert.notEqual(layerOf(file), -1, `${file} is outside the known layers`);
    for (const target of targets) {
      assert.ok(graph.has(target), `${file} imports missing module ${target}`);
      assert.ok(layerOf(target) <= layerOf(file), `${file} (${LAYERS[layerOf(file)]![0]}) imports outward from ${target} (${LAYERS[layerOf(target)]![0]})`);
    }
  }
});

test('source modules have no import cycles', async () => {
  const graph = await importGraph();
  const finished = new Set<string>(); const path: string[] = [];
  const visit = (file: string): void => {
    path.push(file);
    for (const target of graph.get(file) ?? []) {
      assert.ok(!path.includes(target), `import cycle: ${[...path.slice(path.indexOf(target)), target].join(' -> ')}`);
      if (!finished.has(target)) visit(target);
    }
    path.pop(); finished.add(file);
  };
  for (const file of graph.keys()) if (!finished.has(file)) visit(file);
});
