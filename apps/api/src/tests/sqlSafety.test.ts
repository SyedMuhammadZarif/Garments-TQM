import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// SPEC §11: no string-built SQL in repos/. The only allowed interpolations are code-built fragments:
// column lists (UPPER_CASE constants) and scope clauses from scopeClause().
const REPOS = path.resolve(import.meta.dirname, '../repos');
const ALLOWED = /^\$\{([A-Z_]+|scope)\}$/;

test('repos/ never interpolates values into SQL', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(REPOS).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(path.join(REPOS, file), 'utf8');
    for (const tpl of src.matchAll(/`[^`]*`/g)) {
      for (const expr of tpl[0].matchAll(/\$\{[^}]*\}/g)) {
        if (!ALLOWED.test(expr[0])) offenders.push(`${file}: ${expr[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
