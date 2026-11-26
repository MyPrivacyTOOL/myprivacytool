import { Button } from "@/components/ui/button";

// MPC-11111: "Is this your main email?" (the magic guess). DRAFT wording, needs Chris's approval before VITE_EMAIL_GUESS_ENABLED is turned on.
// Shown only when a bot's bridge link carried a sealed address the person published in their own public bio. Saying yes only FILLS the email box:
// the consent line, the button press and the click-to-confirm email all still apply, so nothing is sent or scanned by tapping it.
interface Props {
  email: string;
  /** Where the address was found, in words ("X"). */
  source?: string;
  onYes: () => void;
  onNo: () => void;
}

const EmailGuessCard = ({ email, source = "X", onYes, onNo }: Props) => (
  <section aria-labelledby="email-guess-title" className="max-w-md mx-auto mb-4 rounded-lg border border-border bg-card p-4 text-left" data-testid="email-guess-card">
    <h2 id="email-guess-title" className="text-base font-semibold text-foreground">Is this your main email?</h2>
    <p className="mt-1 text-sm text-muted-foreground">
      Your public {source} bio lists <strong className="break-all text-foreground">{email}</strong>. This is only a guess, and we have not stored it.
    </p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" onClick={onYes}>Yes, use this one</Button>
      <Button type="button" variant="outline" onClick={onNo}>No, I will type another</Button>
    </div>
  </section>
);

export default EmailGuessCard;
