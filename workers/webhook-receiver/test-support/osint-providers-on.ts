// MPC-9885: the three deep-dive OSINT provider entries are switched OFF in the real registry (paid tier, vendor hosts not named yet). The deep-dive
// tests exercise the provider layer with fake hosts, so they swap in a registry where those entries are enabled for exactly those hosts.
import data from '../../../shared/recipients/recipients.json' with { type: 'json' };
import { setBundledRegistryForTests } from '../../../shared/recipients/outbound.ts';

export function osintProvidersOn(hosts: Record<string, string[]> = { 'osint-whatsapp-profile': ['wa.example'], 'osint-spam-registry': ['spam.example'], 'osint-breach-db': ['breach.example'] }): () => void {
  const copy = JSON.parse(JSON.stringify(data));
  for (const r of copy.recipients) if (hosts[r.key]) { r.enabled = true; r.hosts = hosts[r.key]; delete r.planned; delete r.reason; }
  return setBundledRegistryForTests(copy);
}
