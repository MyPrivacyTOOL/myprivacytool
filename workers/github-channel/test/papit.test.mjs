import test from 'node:test';
import assert from 'node:assert/strict';
import { githubToPapit, activityLevel, canonicalJson, verifyReceipt, inferRole } from '../lib/papit.js';

const NOW = new Date('2026-10-05T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const raw = () => ({
  profile: {
    login: 'octo-secret-login', name: 'Octavia Q. Realname', email: 'octavia.private@example.com',
    location: 'Reykjavik, Iceland', company: '@SecretCorp', blog: 'https://octavia.example.org',
    avatar_url: 'https://avatars.githubusercontent.com/u/12345', html_url: 'https://github.com/octo-secret-login',
    bio: 'Backend engineer building GraphQL APIs. Reach me at octavia.private@example.com',
    public_repos: 17, followers: 900, id: 12345,
  },
  repos: [
    { language: 'TypeScript', topics: ['graphql', 'API'], fork: false },
    { language: 'TypeScript', topics: ['graphql'], fork: false },
    { language: 'Go', topics: ['backend'], fork: false },
    { language: 'Rust', topics: ['rust'], fork: true },      // fork: excluded from skills
    { language: 'Python', topics: ['secret'], private: true }, // private: excluded
  ],
  starred: [
    { topics: ['privacy', 'security'] }, { topics: ['privacy'] }, { topics: ['Machine Learning!'] },
  ],
  events: Array.from({ length: 12 }, () => ({ created_at: daysAgo(10) })),
});

test('PII is stripped: nothing identifying survives into the PaPIT JSON', async () => {
  const out = JSON.stringify(await githubToPapit(raw(), { now: NOW }));
  for (const pii of [
    'octo-secret-login', 'Octavia', 'Realname', 'octavia.private@example.com', 'example.com', 'Reykjavik',
    'SecretCorp', 'octavia.example.org', 'avatars.githubusercontent', 'github.com/', '12345', 'GraphQL APIs',
  ]) assert.ok(!out.includes(pii), `leaked: ${pii}`);
});

test('output has exactly the PaPIT v1 shape', async () => {
  const p = await githubToPapit(raw(), { now: NOW });
  assert.deepEqual(Object.keys(p).sort(),
    ['behavioral', 'core_identity', 'cryptographic_receipt', 'generated_at', 'privacy_boundaries', 'source_channel', 'version']);
  assert.equal(p.version, '1.0');
  assert.equal(p.source_channel, 'github');
  assert.equal(p.generated_at, '2026-10-05T12:00:00.000Z');
  assert.deepEqual(p.privacy_boundaries, { data_retention_days: 30, revocable: true });
  assert.match(p.cryptographic_receipt, /^[0-9a-f]{64}$/);
});

test('skills come from non-fork public repos ranked by repo count; project count from profile', async () => {
  const p = await githubToPapit(raw(), { now: NOW });
  assert.deepEqual(p.core_identity.career.skills, ['TypeScript', 'Go']);
  assert.equal(p.core_identity.career.public_projects_count, 17);
});

test('interests come from starred topics, normalised to slugs, most frequent first', async () => {
  const p = await githubToPapit(raw(), { now: NOW });
  assert.deepEqual(p.behavioral.interests, ['privacy', 'machine-learning', 'security']);
});

test('activity thresholds: <5 low, 5-50 medium, >50 high', () => {
  assert.equal(activityLevel(0), 'low');
  assert.equal(activityLevel(4), 'low');
  assert.equal(activityLevel(5), 'medium');
  assert.equal(activityLevel(50), 'medium');
  assert.equal(activityLevel(51), 'high');
});

test('only events in the last 90 days count', async () => {
  const r = raw();
  r.events = [...Array(3).fill({ created_at: daysAgo(5) }), ...Array(100).fill({ created_at: daysAgo(120) })];
  assert.equal((await githubToPapit(r, { now: NOW })).behavioral.activity_level, 'low');
  r.events = Array(60).fill({ created_at: daysAgo(89) });
  assert.equal((await githubToPapit(r, { now: NOW })).behavioral.activity_level, 'high');
});

test('role inference: fixed keyword rules over bio + top languages/topics, no LLM', async () => {
  assert.equal((await githubToPapit(raw(), { now: NOW })).core_identity.career.primary_role, 'Backend Developer');
  assert.equal(inferRole({ bio: 'Pentester and infosec researcher', topLanguages: [], topTopics: [], hasProjects: true }), 'Security Engineer');
  assert.equal(inferRole({ bio: 'I like tea', topLanguages: ['Go'], topTopics: [], hasProjects: true }), 'Software Developer');
  assert.equal(inferRole({ bio: '', topLanguages: [], topTopics: [], hasProjects: false }), 'Unspecified');
  // keyword matching is word-bounded: "mail" must not match "ml"/"ai"
  assert.equal(inferRole({ bio: 'maintainer of mail tools', topLanguages: [], topTopics: [], hasProjects: true }), 'Software Developer');
});

test('canonicalJson sorts keys at every depth', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } }), '{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}');
});

test('receipt is stable for equal payloads and detects tampering', async () => {
  const a = await githubToPapit(raw(), { now: NOW });
  const b = await githubToPapit(raw(), { now: NOW });
  assert.equal(a.cryptographic_receipt, b.cryptographic_receipt);
  assert.ok(await verifyReceipt(a));
  const tampered = structuredClone(a);
  tampered.core_identity.career.skills.push('COBOL');
  assert.ok(!(await verifyReceipt(tampered)));
});

test('empty account yields a valid low-activity profile', async () => {
  const p = await githubToPapit({ profile: {}, repos: [], starred: [], events: [] }, { now: NOW });
  assert.deepEqual(p.core_identity.career, { skills: [], primary_role: 'Unspecified', public_projects_count: 0 });
  assert.equal(p.behavioral.activity_level, 'low');
});
