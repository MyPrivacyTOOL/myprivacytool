import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

// MPC-7916 Phase 2: help and FAQ for visitors. DRAFT copy, English only, other languages pending. Needs Chris's review of the
// wording before it is switched on. The answers describe what the tiles do today; change them with the tiles.
export const HELP_IS_DRAFT = true;

export const HELP_FAQ: { q: string; a: string }[] = [
  { q: 'Why is a hexagon grey?', a: 'Grey means we have not been able to check it, or a web page cannot check it at all. Grey never means you are safe, and it never means you are in danger. It means we are not making a claim.' },
  { q: 'What does "Can\'t check from here" mean?', a: 'Some things, like a DNS leak (when your website lookups bypass your VPN), cannot be seen from a web page. Instead of showing a false "all clear", we say so.' },
  { q: 'What is "Our guess"?', a: 'Some details, like your location or internet provider, come from your internet address or an estimate. They are often right, but not always. We show them as guesses.' },
  { q: 'What is the difference between "You told us" and "Clear"?', a: '"Clear" means we checked for ourselves. "You told us" means you said you fixed something. We show the two differently, and it only becomes clear when we check again.' },
  { q: 'What if I tap "Later"?', a: 'Nothing changes. We do not take silence as "no", and we do not take it as "yes".' },
  { q: 'Why are some hexagons red and others grey with an "i"?', a: 'Red means a tracker can use it and it matters, so there is something to fix. Grey with an "i" means a tracker can see it but it matters less.' },
  { q: 'Do I get points for tapping hexagons?', a: 'No. Tapping does not unlock anything. Hexagons change colour only when we really check something, or when you tell us something is fixed.' },
  { q: 'Does my phone number\'s country show where I live?', a: 'No. It shows where the number was issued. People move, travel and keep numbers.' },
];

export default function HexagonHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-sm underline text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          data-testid="help-open"
        >
          How to read these hexagons
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto" data-testid="help-dialog">
        <DialogHeader>
          <DialogTitle>How to read your hexagons</DialogTitle>
          <DialogDescription>
            Each hexagon tells you one thing a website or tracker can see about you, and how we know.
            {HELP_IS_DRAFT ? ' Draft help text.' : ''}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1 text-sm">
          <li><strong>Clear</strong> (green): we checked and found nothing.</li>
          <li><strong>Needs fixing</strong> (red): we found something that matters.</li>
          <li><strong>Our guess</strong> (purple): we think this is you. It is a guess. A darker purple means we are more sure; a paler one means we are less sure. We never show this as a number.</li>
          <li><strong>You told us</strong> (lighter green): your word, not our proof.</li>
          <li><strong>Seen, minor</strong> (grey, "i"): a tracker can see it, but it matters less.</li>
          <li><strong>Not checked</strong> (grey): we make no claim either way.</li>
        </ul>
        <div className="space-y-2">
          {HELP_FAQ.map((f) => (
            <details key={f.q} className="rounded-lg border border-surface-border p-3">
              <summary className="cursor-pointer font-semibold text-sm">{f.q}</summary>
              <p className="text-sm text-muted-foreground mt-1">{f.a}</p>
            </details>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
