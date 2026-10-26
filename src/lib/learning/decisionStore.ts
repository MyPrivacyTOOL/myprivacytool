// CK-8493: the append-only decision store, as an interface plus an in-memory implementation for tests and the synthetic trace.
// The SQL tables (supabase/proposed/20261027090000_learning_decisions.sql) are the real store; this class enforces the same rules in the same
// order so the trace can be read back from stored state rather than from the objects the test just built. No live store is connected.
import { assertCanAppend, DecisionError, DEFAULT_POLICY, type ApprovalPolicy, type DecisionEvent, type DecisionHeader } from './decisions';
import type { DecisionRecord } from './review';

export interface DecisionStore {
  create(header: DecisionHeader): void;
  append(id: string, event: DecisionEvent): void;
  read(id: string): DecisionRecord | undefined;
  all(): DecisionRecord[];
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export class MemoryDecisionStore implements DecisionStore {
  private headers = new Map<string, string>();
  private events = new Map<string, string[]>();
  constructor(private policy: ApprovalPolicy = DEFAULT_POLICY) {}
  create(header: DecisionHeader): void {
    if (this.headers.has(header.id)) throw new DecisionError('a decision header is written once and never edited');
    this.headers.set(header.id, JSON.stringify(header));
    this.events.set(header.id, []);
  }
  append(id: string, event: DecisionEvent): void {
    const rec = this.read(id);
    if (!rec) throw new DecisionError('unknown decision');
    assertCanAppend(rec.header, rec.events, event, this.policy);
    this.events.get(id)!.push(JSON.stringify(event));
  }
  read(id: string): DecisionRecord | undefined {
    const h = this.headers.get(id);
    return h ? { header: clone(JSON.parse(h) as DecisionHeader), events: this.events.get(id)!.map((e) => JSON.parse(e) as DecisionEvent) } : undefined;
  }
  all(): DecisionRecord[] { return [...this.headers.keys()].map((id) => this.read(id)!); }
}
