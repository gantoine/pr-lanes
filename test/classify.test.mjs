import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const code = await readFile(path.join(root, '..', 'extension', 'content', 'classify.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(code, context);
const lanes = context.PRLanes;

const rules = lanes.buildRules({});

function kind(author, custom) {
  return lanes.classifyAuthor(author, custom ? lanes.buildRules(custom) : rules);
}

test('github app logins are bots', () => {
  assert.equal(kind({ login: 'github-actions', suffixedBot: true }), 'bot');
  assert.equal(kind({ login: 'some-unknown-app', suffixedBot: true }), 'bot');
});

test('known bot logins are bots without a suffix', () => {
  assert.equal(kind({ login: 'coderabbitai' }), 'bot');
  assert.equal(kind({ login: 'Codecov' }), 'bot');
});

test('github app avatars are bots', () => {
  assert.equal(kind({ login: 'mystery-reviewer', appAvatar: true }), 'bot');
});

test('the bot badge in the comment header is a bot', () => {
  assert.equal(kind({ login: 'mystery-reviewer', botBadge: true }), 'bot');
});

test('plain accounts are humans', () => {
  assert.equal(kind({ login: 'georges-antoine' }), 'human');
  assert.equal(kind({ login: 'robotics-fan' }), 'human');
});

test('heuristics catch token-driven bots and can be turned off', () => {
  assert.equal(kind({ login: 'release-bot' }), 'bot');
  assert.equal(kind({ login: 'posthog-ci-bot' }), 'bot');
  assert.equal(kind({ login: 'release-bot' }, { heuristics: false }), 'human');
});

test('extra bots come from settings', () => {
  assert.equal(kind({ login: 'hedgehog' }), 'human');
  assert.equal(kind({ login: 'hedgehog' }, { extraBots: 'hedgehog\nother' }), 'bot');
});

test('the human override wins over every bot signal', () => {
  const custom = { forceHumans: 'copilot' };
  assert.equal(kind({ login: 'copilot', suffixedBot: true, appAvatar: true, botBadge: true }, custom), 'human');
});

test('logins normalize across decoration', () => {
  assert.equal(lanes.normalizeLogin('  @Dependabot[bot] '), 'dependabot');
  assert.deepEqual(Array.from(lanes.parseLoginList('a, b\nc  d')), ['a', 'b', 'c', 'd']);
  assert.deepEqual(Array.from(lanes.parseLoginList('')), []);
});

test('an unknown author stays visible in the humans lane', () => {
  assert.equal(kind({ login: '' }), 'human');
});
