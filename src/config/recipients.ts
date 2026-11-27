// MPC-9883 (Open Tracker rule 6): THIS FILE IS THE ONLY PLACE a recipient is declared on the app side. It re-exports the one data file,
// shared/recipients/recipients.json (also read by Pages Functions, Workers and Node), the same way featureStatus.ts is the only place a feature's
// status is set. To add or switch on a recipient: edit recipients.json (a flag flips it on), never a call site. The wrapper every outbound call
// must go through is shared/recipients/outbound.ts; the schema and validator are shared/recipients/registry.ts.
// Nothing calls the wrapper yet: call-site conversion is MPC-9885 / MPC-9886 and the CI scan that enforces it is MPC-9884.
import recipientsData from "../../shared/recipients/recipients.json";
import { parseRegistry, type Recipient, type RecipientRegistry } from "../../shared/recipients/registry";

export const RECIPIENTS: RecipientRegistry = parseRegistry(recipientsData);

export const RECIPIENT_LIST: readonly Recipient[] = RECIPIENTS.recipients;

export const recipientByKey = (key: string): Recipient | undefined => RECIPIENT_LIST.find((r) => r.key === key);

export { callRecipient, fetchRecipient, loadRecipientScript, createPeerConnection, RecipientError, isRecipientError } from "../../shared/recipients/outbound";
export type { RecipientContext, RecipientRequest, RecipientLogEntry } from "../../shared/recipients/outbound";
export { DATA_ITEMS, validateRegistry, hostMatches } from "../../shared/recipients/registry";
export type { DataItem, Recipient, RecipientRegistry } from "../../shared/recipients/registry";
