// MPC-9806 (COVERAGE-001, UX-033, SCORE-009): what the listing check covers, shown before any identifier is collected (/start and /scan).
// The sites named here are the ones workers/scan-report/lib/brokers.js BROKER_SITES recognises; a test fails if they drift apart.
const ListingCoverageNote = ({ className = "" }: { className?: string }) => (
  <aside className={`text-left text-sm text-muted-foreground border-l-4 border-border pl-3 ${className}`} data-testid="listing-coverage" aria-label="What the listing check covers">
    <p className="font-semibold text-foreground mb-1">What the listing check covers</p>
    <p>
      You paste the address of a page that lists you, and we read that page and tell you whether it shows your details. We do not search broker sites for you.
      A page on any site can be read. We recognise nine by name: seven in the United States (Spokeo, Whitepages, BeenVerified, TruthFinder, FastPeopleSearch,
      MyLife, Intelius), White Pages Australia, and Truecaller, which we cannot read because it needs a sign-in, so we give you its opt-out guide instead.
    </p>
    <p className="mt-1">
      &ldquo;Not listed&rdquo; means that page did not show you. It is not clearance: you can be listed on pages you did not paste, in any country.
    </p>
  </aside>
);

export default ListingCoverageNote;
