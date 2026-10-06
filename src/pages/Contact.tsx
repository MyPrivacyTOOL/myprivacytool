import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ShieldCheck, Scale, Accessibility, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";

// HubSpot "Contact" form (portal 246502821). Set VITE_HUBSPOT_CONTACT_FORM_ID to the form GUID; it
// needs firstname, lastname, email, contact_topic, message, source_tag, consent_given_at and consent_source fields. Until it is set we
// fall back to opening the visitor's mail client addressed to GENERAL_EMAIL.
const FORM_ID = import.meta.env.VITE_HUBSPOT_CONTACT_FORM_ID as string | undefined;
const SOURCE_TAG = "contact-page";
const GENERAL_EMAIL = "privacy@myprivacytool.io";

const TOPICS = ["Personal", "Business", "Press"];

const DIRECT_CONTACTS = [
  { icon: ShieldCheck, label: "Privacy & data requests", email: "privacy@myprivacytool.io" },
  { icon: Building2, label: "Data protection officer", email: "dpo@myprivacytool.io" },
  { icon: Scale, label: "Legal", email: "legal@myprivacytool.io" },
  { icon: Accessibility, label: "Accessibility", email: "accessibility@myprivacytool.io" },
];

const Contact = () => {
  const [form, setForm] = useState({ name: "", email: "", topic: TOPICS[0], message: "" });
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;

    if (!FORM_ID) {
      const subject = encodeURIComponent(`[${form.topic}] Contact form`);
      const body = encodeURIComponent(`${form.message}\n\n— ${form.name} (${form.email})`);
      window.location.href = `mailto:${GENERAL_EMAIL}?subject=${subject}&body=${body}`;
      return;
    }

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
          contact_topic: form.topic,
          message: form.message.trim(),
          source_tag: SOURCE_TAG,
          ...consentFields("contact_page"),
        },
        pageName: "Contact",
      });
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Seo {...pageMeta["/contact"]} path="/contact" />

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-8 text-center">
        <h1 className="text-4xl md:text-5xl font-black tracking-tight mb-4">
          Contact <span className="text-primary">us</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Questions, support or a data request? Send us a message and we'll get back to you by email.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 pb-20 grid md:grid-cols-5 gap-10">
        <div className="md:col-span-3">
          {status !== "success" ? (
            <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 space-y-4">
              <h2 className="text-xl font-bold mb-2">Send us a message</h2>
              <div>
                <label htmlFor="contact-name" className="block text-sm font-medium mb-1.5">Name</label>
                <Input
                  id="contact-name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="h-11"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium mb-1.5">Email</label>
                <Input
                  id="contact-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="h-11"
                />
              </div>
              <div>
                <label htmlFor="contact-topic" className="block text-sm font-medium mb-1.5">Topic</label>
                <select
                  id="contact-topic"
                  value={form.topic}
                  onChange={(e) => setForm({ ...form, topic: e.target.value })}
                  className="w-full bg-background border border-input text-foreground rounded-md px-3 h-11 text-sm focus:outline-none focus:border-primary"
                >
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="contact-message" className="block text-sm font-medium mb-1.5">Message</label>
                <Textarea
                  id="contact-message"
                  rows={6}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  required
                />
              </div>
              <ConsentCheckbox id="contact-consent" checked={consent} onChange={setConsent} disabled={status === "loading"} />
              {status === "error" && (
                <p role="alert" className="text-destructive text-xs">{errorMsg}</p>
              )}
              <Button type="submit" disabled={status === "loading"} className="w-full font-bold h-11 text-base">
                {status === "loading" ? "Sending..." : "Send message"}
              </Button>
              <p className="text-muted-foreground text-xs text-center">
                We use your details only to reply to your message. See our{" "}
                <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
              </p>
            </form>
          ) : (
            <div role="status" className="bg-primary/10 border border-primary/30 rounded-2xl p-8 text-center">
              <div className="text-primary text-4xl mb-4">✓</div>
              <h2 className="text-xl font-bold mb-2">Message sent</h2>
              <p className="text-muted-foreground text-sm">
                Thanks, {form.name.trim().split(/\s+/)[0]}. We'll reply to{" "}
                <span className="text-foreground">{form.email}</span> as soon as we can.
              </p>
            </div>
          )}
        </div>

        <aside className="md:col-span-2 space-y-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Mail size={18} className="text-primary" /> Email us directly
          </h2>
          {DIRECT_CONTACTS.map(({ icon: Icon, label, email }) => (
            <div key={email} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
              <Icon size={18} className="text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">{label}</div>
                <a href={`mailto:${email}`} className="inline-block py-2 text-sm text-muted-foreground hover:text-foreground break-all">
                  {email}
                </a>
              </div>
            </div>
          ))}
          <p className="text-muted-foreground text-sm pt-2">
            Looking for answers fast? Try the <Link to="/faq" className="underline hover:text-foreground">FAQ</Link>.
          </p>
        </aside>
      </section>
    </div>
  );
};

export default Contact;
