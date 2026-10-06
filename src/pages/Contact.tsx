import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mail, ShieldCheck, Scale, Accessibility, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { submitHubSpotForm, consentFields } from "@/lib/hubspot";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import SubmitButton from "@/components/SubmitButton";
import { useLeadSubmit } from "@/hooks/useLeadSubmit";
import { suggestEmail, validateEmail } from "@/lib/formFeedback";
import { trackFormSubmitError, trackFormValidationError } from "@/lib/analytics";

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
  const [emailError, setEmailError] = useState("");
  const [consentError, setConsentError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLDivElement>(null);
  const { status, error: errorMsg, submit } = useLeadSubmit("/thank-you?source=contact");
  const emailSuggestion = suggestEmail(form.email);

  useEffect(() => {
    if (status === "error") trackFormSubmitError("contact");
  }, [status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading" || status === "success") return;

    const emailProblem = validateEmail(form.email);
    const consentProblem = !consent ? "Tick the box to confirm you're happy to hear from us." : "";
    setEmailError(emailProblem ?? "");
    setConsentError(consentProblem);
    if (emailProblem || consentProblem) {
      trackFormValidationError("contact", emailProblem ? "email" : "consent");
      (emailProblem ? emailRef.current : consentRef.current?.querySelector("input"))?.focus();
      return;
    }

    if (!FORM_ID) {
      const subject = encodeURIComponent(`[${form.topic}] Contact form`);
      const body = encodeURIComponent(`${form.message}\n\n— ${form.name} (${form.email})`);
      window.location.href = `mailto:${GENERAL_EMAIL}?subject=${subject}&body=${body}`;
      return;
    }

    const [firstname, ...rest] = form.name.trim().split(/\s+/);
    await submit(() =>
      submitHubSpotForm({
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
      }),
    );
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
          <form onSubmit={handleSubmit} noValidate className="bg-card border border-border rounded-2xl p-8 space-y-4">
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
                ref={emailRef}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  if (emailError) setEmailError("");
                }}
                onBlur={() => form.email && setEmailError(validateEmail(form.email) ?? "")}
                required
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "contact-email-error" : undefined}
                className={`h-11 ${emailError ? "border-destructive" : ""}`}
              />
              {emailError && <p id="contact-email-error" role="alert" className="text-destructive text-xs mt-1.5">{emailError}</p>}
              {!emailError && emailSuggestion && (
                <p className="text-muted-foreground text-xs mt-1.5">
                  Did you mean{" "}
                  <button type="button" onClick={() => setForm({ ...form, email: emailSuggestion })} className="underline text-foreground">{emailSuggestion}</button>?
                </p>
              )}
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
            <div ref={consentRef}>
              <ConsentCheckbox
                id="contact-consent"
                checked={consent}
                onChange={(v) => {
                  setConsent(v);
                  if (v) setConsentError("");
                }}
                disabled={status === "loading" || status === "success"}
              />
            </div>
            {consentError && <p role="alert" className="text-destructive text-xs">{consentError}</p>}
            {status === "error" && (
              <p role="alert" className="text-destructive text-xs">{errorMsg}</p>
            )}
            <SubmitButton status={status} loading="Sending..." success="Message sent" idle="Send message" className="w-full" />
            <p className="text-muted-foreground text-xs text-center">
              We use your details only to reply to your message. See our{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </form>
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
                <a href={`mailto:${email}`} className="text-sm text-muted-foreground hover:text-foreground break-all">
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
