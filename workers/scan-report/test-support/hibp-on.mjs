// MPC-9885: the "hibp" registry entry is enabled:false on purpose (no key in production). A test that exercises breach results turns it on for itself,
// through the wrapper's test seam, and gets a restore function back. Production code never calls this.
import recipientsData from '../../../shared/recipients/recipients.json' with { type: 'json' };
import { parseRegistry } from '../../../shared/recipients/registry.ts';
import { setBundledRegistryForTests } from '../../../shared/recipients/outbound.ts';

export function enableHibpForTests() {
  const reg = structuredClone(recipientsData);
  const hibp = reg.recipients.find((r) => r.key === 'hibp');
  hibp.enabled = true;
  delete hibp.reason;
  return setBundledRegistryForTests(parseRegistry(reg));
}
