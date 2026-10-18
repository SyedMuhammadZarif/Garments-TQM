import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayOf, bool, int, isoDate, isoDateTime, nullable, num, object, oneOf, optional, parse, refine, str, timeOfDay, uuid,
} from './core.js';

test('str trims and enforces length and pattern', () => {
  assert.deepEqual(str({ min: 1 })('  a  '), { ok: true, value: 'a' });
  assert.equal(str({ min: 1 })('   ').ok, false);
  assert.equal(str({ max: 2 })('abc').ok, false);
  assert.equal(str({ pattern: /^[A-Z]+$/ })('abc').ok, false);
  assert.equal(str()(5).ok, false);
  assert.deepEqual(str({ trim: false })(' a'), { ok: true, value: ' a' });
});

test('num and int accept numeric strings (query params) and enforce ranges', () => {
  assert.deepEqual(num()('2.5'), { ok: true, value: 2.5 });
  assert.equal(num()('').ok, false);
  assert.equal(num()(Number.NaN).ok, false);
  assert.equal(num({ min: 1 })(0).ok, false);
  assert.equal(num({ max: 1 })(2).ok, false);
  assert.equal(int()(1.5).ok, false);
  assert.deepEqual(int({ min: 0 })('3'), { ok: true, value: 3 });
});

test('bool, uuid, dates and times', () => {
  assert.deepEqual(bool()('true'), { ok: true, value: true });
  assert.deepEqual(bool()('false'), { ok: true, value: false });
  assert.equal(bool()('yes').ok, false);
  const id = crypto.randomUUID();
  assert.deepEqual(uuid()(id.toUpperCase()), { ok: true, value: id });
  assert.equal(uuid()('not-a-uuid').ok, false);
  assert.equal(isoDate()('2026-02-30').ok, false);
  assert.equal(isoDate()('2026-02-28').ok, true);
  assert.equal(isoDate()(20260228).ok, false);
  assert.deepEqual(isoDateTime()('2026-01-01T06:00:00+06:00'), { ok: true, value: '2026-01-01T00:00:00.000Z' });
  assert.equal(isoDateTime()('2026-01-01').ok, false);
  assert.equal(isoDateTime()('2026-13-01T00:00:00Z').ok, false);
  assert.equal(timeOfDay()('23:59').ok, true);
  assert.equal(timeOfDay()('24:00').ok, false);
});

test('oneOf, nullable, optional', () => {
  assert.equal(oneOf(['a', 'b'] as const)('a').ok, true);
  assert.equal(oneOf(['a', 'b'] as const)('c').ok, false);
  assert.deepEqual(nullable(str())(null), { ok: true, value: null });
  assert.deepEqual(optional(str())(undefined), { ok: true, value: undefined });
});

test('object strips unknown keys, omits absent optionals and reports nested paths', () => {
  const v = object({ name: str({ min: 1 }), note: optional(str()), tags: arrayOf(str({ min: 1 }), { max: 2 }) });
  assert.deepEqual(v({ name: ' x ', extra: 1, tags: [] }), { ok: true, value: { name: 'x', tags: [] } });
  const bad = v({ tags: ['ok', ''] });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.deepEqual(
      bad.issues.map((i) => [i.path, i.code]),
      [['name', 'required'], ['tags.1', 'too_short']],
    );
  }
  assert.equal(v(null).ok, false);
  assert.equal(v([]).ok, false);
});

test('arrayOf enforces bounds and type', () => {
  assert.equal(arrayOf(int())('x').ok, false);
  assert.equal(arrayOf(int(), { min: 1 })([]).ok, false);
  assert.equal(arrayOf(int(), { max: 1 })([1, 2]).ok, false);
});

test('refine adds cross-field rules; parse throws on invalid input', () => {
  const range = refine(object({ from: int(), to: int() }), (v) =>
    v.to < v.from ? { path: 'to', code: 'range', message: 'Must be after from' } : null,
  );
  assert.equal(range({ from: 2, to: 1 }).ok, false);
  assert.equal(range({ from: 1, to: 2 }).ok, true);
  assert.equal(range({ from: 'x', to: 2 }).ok, false);
  assert.throws(() => parse(int(), 'x'), /Validation failed/);
  assert.equal(parse(int(), 3), 3);
});
