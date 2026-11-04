import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, sanitizeText, sanitize, bridgeGithub, verifySanitizationReceipt, githubRecords,
  CORE_IDENTITY, EPHEMERAL, RESTRICTED, RULES_VERSION,
} from '../lib/bridge.js';
import { verifyReceipt } from '../lib/papit.js';

const NOW = new Date('2026-10-05T12:00:00Z');

// Labeled fixture set: [record type, expected class]. Includes channel types beyond GitHub (Reddit etc.).
const LABELED = [
  ...['bio', 'repo', 'language', 'employment', 'education', 'certification', 'skill', 'org_membership', 'project_count']
    .map((t) => [t, CORE_IDENTITY]),
  ...['star', 'event', 'like', 'reaction', 'post', 'comment', 'follow', 'view', 'share', 'topic_interest']
    .map((t) => [t, EPHEMERAL]),
  ...['email', 'name', 'login', 'username', 'location', 'company', 'blog', 'avatar', 'profile_url', 'user_id', 'phone', 'address']
    .map((t) => [t, RESTRICTED]),
  ['LIKE', EPHEMERAL], ['Employment', CORE_IDENTITY], ['unknown_thing', EPHEMERAL], ['', EPHEMERAL],
];

test('classification engine: >95% accuracy on the labeled set', () => {
  const ok = LABELED.filter(([type, want]) => classify({ type }) === want).length;
  assert.ok(ok / LABELED.length > 0.95, `accuracy ${ok}/${LABELED.length}`);
  assert.equal(classify(null), EPHEMERAL);
});

test('sanitizer strips the defined PII patterns', () => {
  const cases = {
    email: ['mail me: jane.doe+x@example.co.uk now', 'jane.doe'],
    url: ['see https://jane.example.org/cv?id=1 or www.jane.dev', 'jane.example.org'],
    handle: ['ping @jane-doe about it', 'jane-doe'],
    ssn: ['ssn 123-45-6789', '123-45-6789'],
    card: ['card 4111 1111 1111 1111 ok', '4111'],
    ipv4: ['from 192.168.10.44 yesterday', '192.168.10.44'],
    phone: ['call +44 20 7946 0958 or (415) 555-0132', '7946'],
  };
  for (const [name, [input, leaked]] of Object.entries(cases)) {
    const { text, hits } = sanitizeText(input);
    assert.ok(!text.includes(leaked), `${name} leaked: ${text}`);
    assert.ok(hits[name] >= 1, `${name} not counted: ${JSON.stringify(hits)}`);
  }
  assert.equal(sanitizeText('Backend engineer, GraphQL and Go').text, 'Backend engineer, GraphQL and Go');
});

test('sanitize() drops restricted records and cleans free text', () => {
  const { records, redactions, dropped } = sanitize([
    { type: 'email', text: 'a@b.com' }, { type: 'bio', text: 'hi a@b.com' }, { type: 'star', topics: ['x'] },
  ]);
  assert.equal(dropped, 1);
  assert.deepEqual(records.map((r) => r.type), ['bio', 'star']);
  assert.equal(records[0].text, 'hi [redacted:email]');
  assert.deepEqual(redactions, { email: 1 });
});

const raw = () => ({
  profile: {
    login: 'octo-secret-login', name: 'Octavia Q. Realname', email: 'octavia.private@example.com',
    location: 'Reykjavik, Iceland', company: '@SecretCorp', blog: 'https://octavia.example.org',
    avatar_url: 'https://avatars.githubusercontent.com/u/12345', html_url: 'https://github.com/octo-secret-login',
    bio: 'Backend engineer building GraphQL APIs. Call +354 555 1234 or octavia.private@example.com',
    public_repos: 17, id: 12345,
  },
  repos: [
    { language: 'TypeScript', topics: ['graphql', 'api'], fork: false },
    { language: 'Go', topics: ['backend'], fork: false },
  ],
  starred: [{ topics: ['privacy'] }, { topics: ['security'] }],
  events: Array.from({ length: 12 }, () => ({ created_at: new Date(NOW - 10 * 86_400_000).toISOString() })),
});

test('integration: raw channel data -> classification -> sanitization -> PaPIT export with receipts', async () => {
  const out = await bridgeGithub(raw(), { now: NOW });

  // classification
  assert.equal(out.classification[RESTRICTED], 9);
  assert.equal(out.classification[CORE_IDENTITY], 4); // bio, project_count, 2 repos
  assert.equal(out.classification[EPHEMERAL], 14);    // 2 stars + 12 events

  // PaPIT payload
  assert.equal(out.papit.version, '1.0');
  assert.deepEqual(out.papit.core_identity.career.skills, ['Go', 'TypeScript']); // tie on count: alphabetical
  assert.equal(out.papit.core_identity.career.primary_role, 'Backend Developer');
  assert.equal(out.papit.behavioral.activity_level, 'medium');
  assert.ok(await verifyReceipt(out.papit));

  // nothing identifying anywhere in the export
  const blob = JSON.stringify(out);
  for (const pii of ['octo-secret-login', 'Octavia', 'octavia.private', 'example.com', 'Reykjavik', 'SecretCorp', '12345', '555 1234']) {
    assert.ok(!blob.includes(pii), `leaked: ${pii}`);
  }

  // sanitization receipt
  assert.equal(out.sanitization.rules_version, RULES_VERSION);
  assert.equal(out.sanitization.records_dropped, 9);
  assert.deepEqual(out.sanitization.redactions, { email: 1, phone: 1 });
  assert.match(out.sanitization_receipt, /^[0-9a-f]{64}$/);
  assert.ok(await verifySanitizationReceipt(out));
});

test('sanitization receipt detects tampering and is deterministic', async () => {
  const a = await bridgeGithub(raw(), { now: NOW });
  const b = await bridgeGithub(raw(), { now: NOW });
  assert.equal(a.sanitization_receipt, b.sanitization_receipt);
  const t = structuredClone(a);
  t.sanitization.redactions.email = 0;
  assert.ok(!(await verifySanitizationReceipt(t)));
  const swapped = { ...structuredClone(a), papit: { ...a.papit, cryptographic_receipt: 'f'.repeat(64) } };
  assert.ok(!(await verifySanitizationReceipt(swapped)));
});

test('PII hidden in topics and languages is redacted before packaging', async () => {
  const r = raw();
  r.starred = [{ topics: ['contact-me@evil.example'] }];
  r.repos = [{ language: 'Go', topics: ['owner-jane@corp.io'], fork: false }];
  const out = await bridgeGithub(r, { now: NOW });
  assert.ok(!JSON.stringify(out).includes('evil.example'));
  assert.ok(!JSON.stringify(out).includes('corp.io'));
});

test('empty input still produces a valid, receipted export', async () => {
  const out = await bridgeGithub({}, { now: NOW });
  assert.equal(out.papit.core_identity.career.primary_role, 'Unspecified');
  assert.ok(await verifySanitizationReceipt(out));
  assert.deepEqual(githubRecords(undefined), []);
});
