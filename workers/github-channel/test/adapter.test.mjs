import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAdapter, GitHubAdapterError } from '../lib/adapter.js';

const ok = (b) => new Response(JSON.stringify(b), { status: 200 });

test('fetchIdentity calls the four read endpoints with a bearer token and paginates', async () => {
  const calls = [];
  const fetchFn = async (u, init) => {
    u = String(u); calls.push({ u, auth: init.headers.Authorization });
    if (u.endsWith('/user')) return ok({ login: 'octo', public_repos: 2 });
    if (u.includes('/user/repos') && u.endsWith('&page=1')) return ok(Array(100).fill({ language: 'Go' }));
    if (u.includes('/user/repos') && u.endsWith('&page=2')) return ok([{ language: 'Rust' }]);
    if (u.includes('/user/starred')) return ok([{ topics: ['x'] }]);
    if (u.includes('/users/octo/events/public')) return ok([{ created_at: '2026-10-01T00:00:00Z' }]);
    throw new Error('unexpected ' + u);
  };
  const raw = await new GitHubAdapter({ token: 'T0K', fetchFn }).fetchIdentity();
  assert.equal(raw.repos.length, 101);
  assert.equal(raw.starred.length, 1);
  assert.equal(raw.events.length, 1);
  assert.ok(calls.every((c) => c.auth === 'Bearer T0K'));
  assert.ok(calls.some((c) => c.u.includes('visibility=public')), 'public repos only');
});

test('API errors carry the status but never the token or URL', async () => {
  const fetchFn = async () => new Response('{"message":"Bad credentials"}', { status: 401 });
  await assert.rejects(new GitHubAdapter({ token: 'SECRET-T0K', fetchFn }).fetchIdentity(), (e) => {
    assert.ok(e instanceof GitHubAdapterError);
    assert.equal(e.status, 401);
    assert.ok(!e.message.includes('SECRET-T0K') && !e.message.includes('http'));
    return true;
  });
});

test('fetch is called unbound (Workers throws "Illegal invocation" if fetch gets a different `this`)', async () => {
  const strictFetch = function (u) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return Promise.resolve(ok(String(u).endsWith('/user') ? { login: 'octo' } : []));
  };
  const raw = await new GitHubAdapter({ token: 'T', fetchFn: strictFetch }).fetchIdentity();
  assert.equal(raw.profile.login, 'octo');
});

test('MPC-9795: coverage says a list was cut short only when the last allowed page was still full', async () => {
  const full = () => ok(Array(100).fill({ language: 'Go', topics: [], created_at: '2026-10-01T00:00:00Z' }));
  const fetchFn = async (u) => {
    u = String(u);
    if (u.endsWith('/user')) return ok({ login: 'octo', public_repos: 400 });
    if (u.includes('/user/repos')) return full();            // 3 full pages: capped
    if (u.includes('/user/starred')) return ok(u.endsWith('&page=1') ? Array(100).fill({}) : Array(5).fill({}));  // ends short: not capped
    if (u.includes('/events/public')) return full();         // 3 full pages: capped
    throw new Error('unexpected ' + u);
  };
  const raw = await new GitHubAdapter({ token: 'T', fetchFn }).fetchIdentity();
  assert.equal(raw.repos.length, 300);
  assert.equal(raw.events.length, 300);
  assert.deepEqual(raw.coverage, { repos_capped: true, starred_capped: false, events_capped: true });
});
