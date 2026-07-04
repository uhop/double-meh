import test from 'tape-six';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

// invariant: no top-level await in src — module evaluation must never block the import graph
// (code-forward preludes rely on synchronous adoption at load time)

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor
]);

const findTopLevelAwait = source => {
  const file = ts.createSourceFile('m.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  let found = null;
  const visit = node => {
    if (found || FUNCTION_KINDS.has(node.kind)) return;
    if (
      node.kind === ts.SyntaxKind.AwaitExpression ||
      (node.kind === ts.SyntaxKind.ForOfStatement && node.awaitModifier)
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
};

const listSources = async dir => {
  const result = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await listSources(full)));
    else if (entry.name.endsWith('.js')) result.push(full);
  }
  return result;
};

test('the guard itself tells top-level await from function-scoped await', t => {
  t.ok(findTopLevelAwait('const x = await f();'), 'flags a top-level await');
  t.ok(findTopLevelAwait('for await (const x of y) use(x);'), 'flags a top-level for-await');
  t.notOk(findTopLevelAwait('const f = async () => await g();'), 'ignores awaits inside functions');
  t.notOk(
    findTopLevelAwait('async function f() { for await (const x of y) use(x); }'),
    'ignores for-await inside functions'
  );
});

test('no top-level await anywhere in src', async t => {
  const src = fileURLToPath(new URL('../../src', import.meta.url));
  const files = await listSources(src);
  t.ok(files.length > 15, 'the scan sees the source tree');
  for (const file of files) {
    const found = findTopLevelAwait(await fs.readFile(file, 'utf8'));
    t.notOk(found, path.relative(src, file) + ' is free of top-level await');
  }
});
