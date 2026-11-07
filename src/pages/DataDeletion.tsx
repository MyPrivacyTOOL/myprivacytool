import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

// Data deletion instructions. Every statement here restates the Privacy Policy (/privacy); the deletion mailbox, the Telegram STOP and
// "Delete my scan data" actions, the scan-number request and the 30-day reply all come from there. Meta (Facebook / Instagram / WhatsApp)
// asks apps for a data-deletion instructions URL; this page is that URL. If the Privacy Policy changes, change this page with it.
const MAIL = "privacy@myprivacytool.io";

const DataDeletion = () => {
  return (
    <>
      <Seo {...pageMeta["/data-deletion"]} path="/data-deletion" />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-foreground">How to delete your data</h1>
            <p className="mb-8 text-lg text-muted-foreground">Last updated: 7 November 2026</p>

            <section className="mb-8">
              <p className="text-muted-foreground">
                You can ask us to delete the personal data we hold about you at any time. It is free. This page says how. The full detail of what we
                keep, and for how long, is in our{" "}
                <a href="/privacy" className="text-brand underline hover:text-foreground">
                  Privacy Policy
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">1. Write to us (any channel)</h2>
              <p className="text-muted-foreground">
                Email{" "}
                <a href={`mailto:${MAIL}`} className="text-brand underline hover:text-foreground">
                  {MAIL}
                </a>{" "}
                and say you want your data deleted. So that we delete the right record, include whichever of these applies:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>for a saved scan from our website: your scan number, or the email address you used;</li>
                <li>for Telegram: your Telegram @handle or id;</li>
                <li>
                  if you wrote to us on Facebook, Instagram or WhatsApp: the name or number you wrote from, and roughly when. We delete the copy we
                  hold. Anything Meta itself stores is outside our control and is managed in your Meta account settings;
                </li>
                <li>for a visit to our website: the approximate time and your IP address.</li>
              </ul>
              <p className="mt-4 text-muted-foreground">We will respond within 30 days.</p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">2. Do it yourself in Telegram</h2>
              <p className="text-muted-foreground">
                In our Telegram chat, send STOP, or tap &ldquo;Delete my scan data&rdquo; in the /fix list. We then delete your saved scan results,
                your fix-list progress and re-check records, any deeper scan results and your consent record, and we stop checking your profile.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">3. What this does not cover</h2>
              <p className="text-muted-foreground">
                We delete only what we hold. Settings on Telegram, Facebook, Instagram, WhatsApp or any other service stay yours to change, and we
                never change them for you. Messaging conversation state in our own system is kept for 7 days of inactivity and then removed.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default DataDeletion;
