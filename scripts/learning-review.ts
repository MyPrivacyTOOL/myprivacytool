// CK-8493: manual, read-only learning review.   npm run learning:review -- --fixture
// --fixture prints the review of an invented (SYNTHETIC) ledger and one synthetic decision trace.
// A live run is refused on purpose: live aggregation waits for the validated event pipeline (CK-8492) and the consent/retention gates, and no
// live reader exists yet. This command reads nothing, writes nothing, and is NOT scheduled.
import { renderReview } from '../src/lib/learning/review';
import { buildSyntheticTrace } from '../src/lib/learning/syntheticTrace';

const args = process.argv.slice(2);
if (!args.includes('--fixture')) {
  console.error('Refused: no live reader is connected. Live aggregation is gated on CK-8492 (validated event pipeline) and the consent/retention gates.\nUse --fixture for the synthetic review.');
  process.exit(2);
}
const { report, store, steps } = buildSyntheticTrace();
console.log(renderReview(report, store.all(), 'SYNTHETIC FIXTURE'));
console.log('\n## Synthetic trace\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n'));
