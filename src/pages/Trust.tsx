import { Link } from "react-router-dom";
import Seo from "@/components/Seo";

// MPC-6545 trust hub. Only states facts that the other legal pages and the code already support:
// no encryption-at-rest, audit, region or retention claims beyond what /privacy says.
const TRUST_PAGES = [
  {
    to: "/privacy",
    title: "Privacy Policy",
    body: "What we collect, why, who we share it with, how long we keep it and how to use your rights under GDPR, CCPA, PDPO and PDPA.",
  },
  {
    to: "/terms",
    title: "Terms of Service",
    body: "The rules for using MyPrivacyTOOL, what we promise and what we do not.",
  },
  {
    to: "/cookies",
    title: "Cookie Policy",
    body: "Which cookies and trackers we use, and how to change your choice at any time.",
  },
  {
    to: "/dpa",
    title: "Data Processing Agreement summary",
    body: "For businesses: our role as processor, sub-processors, transfers and how to request a signed DPA.",
  },
];

const PROMISES = [
  "We never sell your data.",
  "You can review or change your cookie choices at any time from \"Manage cookies\" in the footer.",
  "We list what we collect and which providers handle it, in plain language, in the Privacy Policy and DPA summary.",
  "You can ask us to access, correct or delete your data at privacy@myprivacytool.io.",
];

const Trust = () => {
  return (
    <>
      <Seo
        title="Trust & Legal | MyPrivacyTOOL"
        description="How MyPrivacyTOOL handles your data: privacy policy, terms, cookie policy and data processing summary in one place."
        path="/trust"
      />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="mb-2 text-4xl font-bold text-foreground">Trust &amp; Legal</h1>
          <p className="mb-10 text-lg text-muted-foreground">
            A privacy product has to practise what it preaches. Everything about how we
            handle your data is written down here.
          </p>

          <section className="mb-12 rounded-lg bg-muted p-6">
            <h2 className="mb-4 text-xl font-semibold text-foreground">Our commitments</h2>
            <ul className="list-inside list-disc space-y-2 text-muted-foreground">
              {PROMISES.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            {TRUST_PAGES.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                className="rounded-lg border border-border p-6 transition-colors hover:bg-muted"
              >
                <h2 className="mb-2 text-xl font-semibold text-foreground">{page.title}</h2>
                <p className="text-sm text-muted-foreground">{page.body}</p>
              </Link>
            ))}
          </div>

          <p className="mt-12 text-sm text-muted-foreground">
            MyPrivacyTOOL Ltd, 12E, Block 5, 8 Pak Lai Road, Park Island, Ma Wan, Tsuen Wan
            District, New Territories, Hong Kong. Questions:{" "}
            <a
              href="mailto:privacy@myprivacytool.io"
              className="text-brand underline hover:text-foreground"
            >
              privacy@myprivacytool.io
            </a>
            .
          </p>
        </div>
      </main>
    </>
  );
};

export default Trust;
