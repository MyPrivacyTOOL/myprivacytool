// MPC-7557: which records are synthetic test records. Test records never count in KPIs.
// One convention, used by the nightly chain test (which creates them), the metrics collector (which excludes them) and the cleanup (which refuses to touch anything else):
// a plus-address of the owner's test mailbox, e.g. testingnt69+nightly-20261028@gmail.com. Gmail delivers every plus-address to the one inbox.
// Plain ESM, no dependencies, imported by Workers, scripts and tests.
export const TEST_MAILBOX = 'testingnt69';
export const TEST_DOMAIN = 'gmail.com';
const TEST_RE = new RegExp(`^${TEST_MAILBOX}(\\+[a-z0-9._-]{1,60})?@${TEST_DOMAIN.replace('.', '\\.')}$`, 'i');

/** True for the test mailbox and any of its plus-aliases. Case-insensitive. Never true for another address. */
export const isTestAddress = (email) => TEST_RE.test(String(email ?? '').trim());

/** The alias a given run uses. `kind` is 'nightly' or 'weekly'; `day` is YYYYMMDD in Hong Kong time. One alias per day so the 24h one-scan-per-address rule never blocks a run. */
export const testAddress = (kind, day) => {
  if (!/^(nightly|weekly)$/.test(kind) || !/^\d{8}$/.test(day)) throw new Error('testAddress: kind must be nightly|weekly and day YYYYMMDD');
  return `${TEST_MAILBOX}+${kind}-${day}@${TEST_DOMAIN}`;
};

/**
 * PostgREST filter that keeps only NON-test rows of a table, given the column that holds the address. Wildcard is `*` in PostgREST; the plus is percent-encoded.
 * Example: `scans?select=*&${excludeTestFilter('email_scanned')}`.
 */
export const excludeTestFilter = (column) => `${column}=not.ilike.${encodeURIComponent(`${TEST_MAILBOX}*@${TEST_DOMAIN}`)}`;
/** Same, but selects ONLY the test rows (used to report how many test records exist, as a count). */
export const onlyTestFilter = (column) => `${column}=ilike.${encodeURIComponent(`${TEST_MAILBOX}*@${TEST_DOMAIN}`)}`;
