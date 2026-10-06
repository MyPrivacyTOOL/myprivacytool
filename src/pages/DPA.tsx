import { Link } from "react-router-dom";
import Seo from "@/components/Seo";

// MPC-6545: plain-language summary of how MyPrivacyTOOL processes personal data as a processor.
// Sub-processors below are the services the repo actually calls (workers/, src/lib/, index.html).
// Keep this list and Privacy.tsx section 5 in sync, and add a provider here BEFORE wiring it in.
const SUB_PROCESSORS = [
  { name: "Cloudflare", purpose: "Site hosting (Pages), edge Workers that receive forms and run the scan report" },
  { name: "Supabase", purpose: "Database for lead, scan-summary and engagement records" },
  { name: "HubSpot", purpose: "CRM for newsletter, waitlist and business enquiries; marketing email" },
  { name: "Resend", purpose: "Transactional email (for example the scan summary you request)" },
  { name: "Notion", purpose: "Internal task and lead log used by our team" },
  { name: "Slack", purpose: "Internal notifications when a new lead or enquiry arrives" },
  { name: "Telegram", purpose: "Messaging channel, only if you choose to talk to us there" },
  { name: "Google (Analytics 4, Cloud APIs)", purpose: "Usage analytics (after consent) and Google-hosted services we use" },
  { name: "Consentmanager", purpose: "Cookie consent banner and consent records" },
];

const DPA = () => {
  return (
    <>
      <Seo
        title="Data Processing Agreement Summary | MyPrivacyTOOL"
        description="Plain-language summary of how MyPrivacyTOOL processes personal data on behalf of business customers: roles, sub-processors, security, transfers and deletion."
        path="/dpa"
      />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-foreground">
              Data Processing Agreement: Summary
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              For business customers and organisations subject to GDPR, UK GDPR, PDPO or PDPA
            </p>

            <div className="mb-8 rounded-lg bg-muted p-6">
              <p className="text-muted-foreground">
                This page summarises how MyPrivacyTOOL Ltd handles personal data
                when a business uses our services. It is a summary, not a signed
                contract. If your organisation needs a countersigned Data
                Processing Agreement (DPA) with Standard Contractual Clauses,
                email{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-brand underline hover:text-foreground"
                >
                  privacy@myprivacytool.io
                </a>{" "}
                and we will send one. It sits alongside our{" "}
                <Link to="/terms" className="text-brand underline hover:text-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="text-brand underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                Last updated: October 2026. Template summary; not legal advice.
              </p>
            </div>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">1. Roles</h2>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Individuals using the free scan or joining the waitlist:</strong>{" "}
                  MyPrivacyTOOL Ltd is the controller. See the Privacy Policy.
                </li>
                <li>
                  <strong>Business customers (for example employee privacy checks):</strong>{" "}
                  you are the controller and MyPrivacyTOOL Ltd is your processor for
                  the personal data you ask us to process.
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">2. What we process on your behalf</h2>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>Contact details you or your people give us (name, work email, optional mobile number)</li>
                <li>The email addresses and social handles you ask us to check, and the resulting exposure summary</li>
                <li>Technical data from the scan: device type, browser, approximate location from IP address</li>
                <li>Records of consent and of the campaign or page a sign-up came from</li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                We process this only to provide the service you asked for, on your
                documented instructions, and not to sell it or build advertising profiles.
                Much of the device scan runs in the visitor&rsquo;s own browser; what is sent to
                our servers is described in the Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">3. Our commitments as processor</h2>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>Process personal data only on your documented instructions, unless the law requires otherwise</li>
                <li>Keep access limited to people who need it and who are bound by confidentiality</li>
                <li>Use appropriate technical and organisational measures. Data is encrypted in transit (HTTPS); access to our systems is restricted by credentials held by our team</li>
                <li>Help you answer data-subject requests (access, correction, deletion, objection) within a reasonable time</li>
                <li>Tell you without undue delay, and within 72 hours where we can, after confirming a personal data breach affecting your data</li>
                <li>Impose data protection terms on sub-processors and stay responsible for them</li>
                <li>Make available the information reasonably needed to show compliance, and allow reasonable audits on notice</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">4. Sub-processors</h2>
              <p className="text-muted-foreground">
                These providers may handle personal data for us. We update this list
                before adding a new one that touches customer personal data, and
                business customers on a signed DPA can object to a change.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm text-muted-foreground">
                  <thead>
                    <tr className="border-b border-border text-foreground">
                      <th className="py-2 pr-4 font-semibold">Provider</th>
                      <th className="py-2 font-semibold">What it does for us</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SUB_PROCESSORS.map((sp) => (
                      <tr key={sp.name} className="border-b border-border/60 align-top">
                        <td className="py-2 pr-4 font-medium text-foreground">{sp.name}</td>
                        <td className="py-2">{sp.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-muted-foreground">
                We will add a payment provider (planned: Stripe) here before paid
                plans go live.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">5. International transfers</h2>
              <p className="text-muted-foreground">
                We are based in Hong Kong and our providers operate globally, so
                personal data may be processed outside your country, including in
                the United States and the EU/EEA. Where GDPR or UK GDPR applies, we
                rely on Standard Contractual Clauses or the UK Addendum, or another
                lawful transfer mechanism, and on equivalent terms with our sub-processors.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">6. Retention and deletion</h2>
              <p className="text-muted-foreground">
                Retention periods are set out in section 6 of the{" "}
                <Link to="/privacy" className="text-brand underline hover:text-foreground">
                  Privacy Policy
                </Link>
                . When a business customer relationship ends, or on your written
                request, we delete or return the personal data we hold for you, except
                where the law requires us to keep it.
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-2xl font-bold text-foreground">7. Contact</h2>
              <div className="mt-4 space-y-2 text-muted-foreground">
                <p>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:privacy@myprivacytool.io"
                    className="text-brand underline hover:text-foreground"
                  >
                    privacy@myprivacytool.io
                  </a>
                </p>
                <p>
                  <strong>Company:</strong> MyPrivacyTOOL Ltd, 12E, Block 5, 8 Pak Lai
                  Road, Park Island, Ma Wan, Tsuen Wan District, New Territories, Hong Kong
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default DPA;
