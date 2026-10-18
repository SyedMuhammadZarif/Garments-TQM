import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem } from './password.js';
import { changePasswordInput, createUserInput, createFactoryInput } from './inputs.js';

test('password policy: length, letter and digit', () => {
  assert.match(passwordProblem('a1') ?? '', /At least 8/);
  assert.match(passwordProblem('abcdefgh') ?? '', /letter and one digit/);
  assert.match(passwordProblem('12345678') ?? '', /letter and one digit/);
  assert.equal(passwordProblem('abcdefg1'), null);
  assert.equal(passwordProblem('a1'.repeat(40)), null); // 80 chars allowed (no max below 64)
  assert.match(passwordProblem('a1'.repeat(70)) ?? '', /At most/);
});

test('change password rejects reusing the current password', () => {
  assert.equal(changePasswordInput({ currentPassword: 'abcdefg1', newPassword: 'abcdefg1' }).ok, false);
  assert.equal(changePasswordInput({ currentPassword: 'abcdefg1', newPassword: 'abcdefg2' }).ok, true);
});

test('create user requires a role and validates scopes', () => {
  const base = { id: crypto.randomUUID(), username: 'emp001', fullName: 'Test', scopes: [] };
  assert.equal(createUserInput({ ...base, roleIds: [] }).ok, false);
  assert.equal(createUserInput({ ...base, roleIds: [crypto.randomUUID()] }).ok, true);
  const badScope = createUserInput({
    ...base,
    roleIds: [crypto.randomUUID()],
    scopes: [{ factoryId: crypto.randomUUID(), unitId: null, stage: 'nope', buyerId: null }],
  });
  assert.equal(badScope.ok, false);
});

test('factory code and time zone are validated', () => {
  const base = { id: crypto.randomUUID(), name: 'X' };
  assert.equal(createFactoryInput({ ...base, code: 'da' }).ok, false);
  assert.equal(createFactoryInput({ ...base, code: 'DA', timezone: 'Mars/Base' }).ok, false);
  assert.equal(createFactoryInput({ ...base, code: 'DA', timezone: 'Asia/Dhaka' }).ok, true);
});
