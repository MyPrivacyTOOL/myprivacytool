import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { EMAIL_RE, subscribeToBlogNewsletter } from "@/lib/blogSubscribe";
import { trackBlogLeadCapture } from "@/lib/analytics";

// MPC-10616: email field + subscribe button for the Privacy Check block on /blog.
export default function BlogNewsletterForm({ path = "/blog" }: { path?: string }) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const busy = useRef(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) { setStatus("error"); setError("Please enter a valid email address."); return; }
    if (!consent) { setStatus("error"); setError("Please tick the box so we may email you the newsletter."); return; }
    busy.current = true;
    setStatus("loading"); setError("");
    try {
      await subscribeToBlogNewsletter(trimmed, path);
      trackBlogLeadCapture(path);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      busy.current = false;
    }
  };

  if (status === "success") {
    return <p role="status" data-testid="blog-newsletter-success" className="font-medium text-foreground">Thanks, you are subscribed to Privacy Check. You can unsubscribe at any time.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate data-testid="blog-newsletter-form" className="mx-auto max-w-md space-y-3 text-left">
      <label htmlFor="blog-newsletter-email" className="sr-only">Email address</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="blog-newsletter-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading"}
          aria-invalid={status === "error" && !!error}
          aria-describedby={error ? "blog-newsletter-error" : undefined}
          className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button type="submit" size="lg" disabled={status === "loading"}>{status === "loading" ? "Subscribing…" : "Subscribe"}</Button>
      </div>
      <label htmlFor="blog-newsletter-consent" className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
        <input id="blog-newsletter-consent" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 shrink-0" />
        <span>Email me Privacy Check, the newsletter. I can unsubscribe at any time.</span>
      </label>
      {status === "error" && error && <p id="blog-newsletter-error" role="alert" className="border-l-4 border-destructive pl-3 text-xs text-foreground">{error}</p>}
    </form>
  );
}
