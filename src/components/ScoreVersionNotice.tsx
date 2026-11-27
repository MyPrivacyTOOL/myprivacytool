// MPC-11569: the sentence that must travel with a score method that checks more. A rising number reads as bad news, so whenever the score on screen
// comes from exposure-v2 (more checks counted: the built email checks) the page says so. It renders nothing for any other score version, so it
// appears exactly when exposure-v2 is what the person is looking at, and never before. No count is stated here: totals live on the Master Index only.
export const SCORE_V2_HEADLINE = "We now check more. You did not become more exposed.";
export const SCORE_V2_DETAIL =
  "Your score now counts more checks, so it can be higher or lower than before. That reflects what we look at, not a change in what you reveal. Scores from different methods cannot be compared with each other.";

export default function ScoreVersionNotice({ scoreVersion }: { scoreVersion?: string | null }) {
  if (scoreVersion !== "exposure-v2") return null;
  return (
    <div role="note" data-testid="score-version-notice" className="p-3 bg-secondary rounded-lg border border-brand/30 text-sm text-foreground">
      <p className="font-semibold">{SCORE_V2_HEADLINE}</p>
      <p className="text-muted-foreground mt-1">{SCORE_V2_DETAIL}</p>
    </div>
  );
}
