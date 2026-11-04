import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getChoice, onOpenPreferences, setChoice } from "@/lib/cookieConsent";

// MPC-8450: one short question, two equal buttons. Wording approved by the owner 2026-10-23 (plus the HubSpot forms script, which the home page
// also loads only after this choice). Shows until the visitor chooses, and again when they press "Manage cookies" in the footer.
export default function CookieBanner() {
  const [open, setOpen] = useState(() => getChoice() === null);
  useEffect(() => onOpenPreferences(() => setOpen(true)), []);
  if (!open) return null;

  const choose = (analytics: boolean) => {
    setChoice(analytics);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-body"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-left">
          <p id="cookie-banner-title" className="font-semibold text-foreground">Your privacy, your choice</p>
          <p id="cookie-banner-body" className="text-sm text-muted-foreground">
            We use essential cookies to run the site. With your OK we also use Google Analytics (and HubSpot for our forms) to count visits so we can improve it.
            No ads, and we never sell your data.{" "}
            <Link to="/cookies" className="underline underline-offset-2 hover:text-foreground">Cookie policy</Link>
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Button variant="outline" className="flex-1 border-2 font-semibold md:flex-none" onClick={() => choose(true)}>Accept analytics</Button>
          <Button variant="outline" className="flex-1 border-2 font-semibold md:flex-none" onClick={() => choose(false)}>Essential only</Button>
        </div>
      </div>
    </div>
  );
}
