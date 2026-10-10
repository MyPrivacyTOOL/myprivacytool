import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Globe2, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import { trackEnterpriseLead } from "@/lib/analytics";

// MPC-102: enterprise demo request. Reuses the "Business Inquiry" HubSpot form (portal 246502821);
// leads are told apart by the hidden "source_tag" field. Override with VITE_HUBSPOT_BUSINESS_FORM_ID.
const FORM_ID =
  import.meta.env.VITE_HUBSPOT_BUSINESS_FORM_ID || "954226ca-7c3e-4206-8557-6d97d60b63bd";
const SOURCE_TAG = "enterprise-demo";

const Enterprise = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ name: "", email: "", company: "", size: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [consent, setConsent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.company || !consent || status === "loading") return;
    setStatus("loading");
    setErrorMsg("");
    const [firstname, ...rest] = form.name.trim().split(/\s+/);
    try {
      await submitHubSpotForm({
        formId: FORM_ID,
        fields: {
          firstname: firstname || "",
          lastname: rest.join(" "),
          email: form.email.trim(),
          company: form.company.trim(),
          source_tag: SOURCE_TAG,
          ...consentFields("enterprise_page"),
        },
        pageName: "Enterprise demo request",
      });
      trackEnterpriseLead({ source: "enterprise_page", ...(form.size ? { team_size: form.size } : {}) });
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: "smooth" });

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/enterprise"]} path="/enterprise" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16">
        <div className="grid md:grid-cols-2 gap-12 items-start">
          <div>
            <div className="inline-block bg-primary/10 border border-primary/30 text-foreground text-xs font-semibold uppercase tracking-widest px-4 py-2 rounded-full mb-8">
              Enterprise
            </div>
            <h1 className="text-4xl md:text-5xl font-bold leading-tight mb-6 tracking-tight">
              Employee data exposure, <span className="text-brand">managed at scale</span>
            </h1>
            <p className="text-muted-foreground text-lg mb-4 leading-relaxed">
              Home addresses, personal numbers and family details listed by data brokers give attackers
              material for targeted phishing and impersonation. We find that exposure across your organisation
              and remove it.
            </p>
            <p className="text-muted-foreground text-base mb-8">
              Built for security and risk teams who need coverage, reporting and a named contact, not a
              self-serve checkout. Smaller team? See{" "}
              <Link to="/business" className="underline hover:text-foreground">For Business</Link>.
            </p>
            <Button onClick={scrollToForm} className="font-bold h-11 px-6">Book a demo</Button>
          </div>

          <div>
            {status !== "success" ? (
              <form
                ref={formRef}
                onSubmit={handleSubmit}
                className="bg-card border border-border rounded-2xl p-8 space-y-4"
              >
                <h2 className="text-xl font-bold mb-2">Book a demo</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Tell us about your organisation and we'll arrange a walkthrough.
                </p>
                <Input
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="h-11"
                />
                <Input
                  type="email"
                  placeholder="Work email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="h-11"
                />
                <Input
                  placeholder="Company name"
                  value={form.company}
                  onChange={(e) => setForm({ ...form, company: e.target.value })}
                  required
                  className="h-11"
                />
                <select
                  aria-label="Organisation size"
                  value={form.size}
                  onChange={(e) => setForm({ ...form, size: e.target.value })}
                  className="w-full bg-background border border-input text-foreground rounded-md px-3 h-11 text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">Organisation size</option>
                  <option value="100-500">100–500 employees</option>
                  <option value="500-2000">500–2,000 employees</option>
                  <option value="2000+">2,000+ employees</option>
                </select>
                <ConsentCheckbox id="enterprise-consent" checked={consent} onChange={setConsent} disabled={status === "loading"} labelClassName="text-muted-foreground" />
                {status === "error" && (
                  <p role="alert" className="text-destructive text-xs">{errorMsg}</p>
                )}
                <Button type="submit" disabled={status === "loading"} className="w-full font-bold h-11 text-base">
                  {status === "loading" ? "Sending..." : "Request a demo"}
                </Button>
                <p className="text-muted-foreground text-xs text-center">
                  We use your details only to arrange the demo. See our{" "}
                  <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
                </p>
              </form>
            ) : (
              <div className="bg-primary/10 border border-primary/30 rounded-2xl p-8 text-center">
                <div className="text-brand text-4xl mb-4">✓</div>
                <h3 className="text-xl font-bold mb-2">Request received</h3>
                <p className="text-muted-foreground text-sm">
                  We'll contact <span className="text-foreground">{form.email}</span> to arrange your demo.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="text-2xl font-bold text-center mb-10">What enterprise includes</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {[
            {
              icon: Globe2,
              title: "APAC coverage",
              desc: "Our removal workflows focus on Hong Kong, Singapore and Australia, alongside major US data brokers, so regional staff are not an afterthought.",
            },
            {
              icon: ShieldCheck,
              title: "Privacy Score and reporting",
              desc: "A per-organisation exposure report and Privacy Score show who is exposed, what is visible and how it changes after removals. Service levels are agreed in your contract.",
            },
            {
              icon: Users,
              title: "Named contact and onboarding",
              desc: "A dedicated contact, executive and high-risk-role prioritisation, and help rolling out to your workforce.",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-6 rounded-xl bg-card border border-border">
              <div className="mb-4"><Icon className="w-6 h-6 text-brand" aria-hidden="true" /></div>
              <div className="font-bold mb-2">{title}</div>
              <div className="text-muted-foreground text-sm leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border py-16 px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">Pricing</h2>
          <p className="text-muted-foreground text-sm mb-8 leading-relaxed">
            Enterprise plans are quoted to your headcount and requirements. There is no self-serve checkout.
            Tell us about your organisation in the demo request and we'll send a proposal.
          </p>
          <Button onClick={scrollToForm} className="font-bold">Book a demo</Button>
        </div>
      </section>
    </div>
  );
};

export default Enterprise;
