import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords, toCsv } from './csv.js';

test('parses quotes, escaped quotes, commas and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\r\n'), [
    ['a', 'b,c', 'say "hi"'],
    ['1', '2', '3'],
  ]);
});

test('handles BOM, newline inside quotes, blank lines and a missing final newline', () => {
  assert.deepEqual(parseCsv('﻿x,y\n\n"multi\nline",2'), [
    ['x', 'y'],
    ['multi\nline', '2'],
  ]);
});

test('records use lower-cased trimmed headers and fill missing cells', () => {
  assert.deepEqual(parseCsvRecords(' Code ,Name\nE1, Rahim \nE2').records, [
    { code: 'E1', name: 'Rahim' },
    { code: 'E2', name: '' },
  ]);
});

test('toCsv round-trips and starts with a BOM', () => {
  const csv = toCsv(['a', 'b'], [['x,y', 'q"q'], [null, 3]]);
  assert.ok(csv.startsWith('﻿'));
  assert.deepEqual(parseCsv(csv), [
    ['a', 'b'],
    ['x,y', 'q"q'],
    ['', '3'],
  ]);
});
