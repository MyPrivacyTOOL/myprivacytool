import { useState } from "react";
import { Link } from "react-router-dom";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FAQS } from "@/data/faqs";
import { trackEvent } from "@/lib/analytics";

// MPC-8527: the one global HELP entry, rendered once by the Header so it is on every route (404 included) and
// visible on mobile without opening the menu. It opens a sheet over the current page instead of navigating, so a
// scan or half-filled form underneath keeps its state. Content reuses the published FAQ list (src/data/faqs.ts,
// MPC-7560/7561); it does not add answers of its own.
//
// AI assistance: no support backend is accepted yet (MPC-8528 intake/case service, MPC-8530 knowledge and action
// policies). Flip this only when both are accepted and an endpoint exists. Until then HELP says so plainly and
// never shows a chat box, a case form or a promise of a reply.
export const AI_SUPPORT_AVAILABLE = false;

// Existing FAQ questions most relevant to someone who is stuck. Looked up by exact question text; any not found are skipped.
const HELP_QUESTIONS = [
  "How does the scan work?",
  "Does the scan send my results to your servers?",
  "What do you receive if I enter my email address?",
  "What happens if I save my scan?",
  "How do I contact support or ask about my data?",
];

const HelpButton = () => {
  const [open, setOpen] = useState(false);
  const items = HELP_QUESTIONS.map((q) => FAQS.find((f) => f.q === q)).filter((f): f is (typeof FAQS)[number] => !!f);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Event name only: no URL, email, scan data or report token goes with it (and trackEvent is a no-op without analytics consent).
        if (next) trackEvent("help_opened");
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-semibold" aria-label="Help">
          <LifeBuoy className="h-4 w-4" aria-hidden="true" />
          <span>HELP</span>
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <SheetTitle className="text-left">Help</SheetTitle>
        <SheetDescription className="text-left">Quick answers from our FAQ. Your page stays as it is while this is open.</SheetDescription>

        <section aria-labelledby="help-ai-status" className="mt-5 rounded-md border border-border p-3 text-sm" data-testid="help-ai-status">
          <h3 id="help-ai-status" className="font-semibold">AI assistant</h3>
          {AI_SUPPORT_AVAILABLE ? (
            <p className="mt-1 text-muted-foreground">The AI assistant is available.</p>
          ) : (
            <p className="mt-1 text-muted-foreground">
              We don't have an AI assistant. Nothing here is a live chat, and no message is sent from this panel.
            </p>
          )}
        </section>

        <h3 className="mt-6 font-semibold">Common questions</h3>
        <div className="mt-2 space-y-2">
          {items.map(({ q, a }) => (
            <details key={q} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">{q}</summary>
              <p className="mt-2 text-sm text-muted-foreground">{a}</p>
            </details>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <SheetClose asChild>
            <Button asChild variant="outline">
              <Link to="/faq">All questions</Link>
            </Button>
          </SheetClose>
          <SheetClose asChild>
            <Button asChild variant="outline">
              <Link to="/contact">Contact page</Link>
            </Button>
          </SheetClose>
          <p className="text-xs text-muted-foreground">
            The contact page is a written form; we can't say how quickly it will be answered. This panel does not open a support case.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default HelpButton;
