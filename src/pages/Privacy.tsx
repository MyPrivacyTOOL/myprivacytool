import { useEffect } from "react";
import Seo from "@/components/Seo";
import { HK_POLICY_ANCHOR, HK_POLICY_EN, HK_POLICY_ZH, type HkPolicyCopy } from "@/data/hkSpamCopy";
import pageMeta from "@/data/pageMeta.json";
import { referralsEnabled } from "@/lib/referral";
import { recognitionFlagOn } from "@/lib/webScan";
import { learningEventsEnabled } from "@/lib/learning/events";

// MPC-7538: one language of the HK Stop Spam section. Wording lives in src/data/hkSpamCopy.ts (MPC-7542 reviews the Chinese).
const HkPolicyBlocks = ({ copy, id }: { copy: HkPolicyCopy; id: string }) => (
  <div id={id} lang={copy.lang} className="scroll-mt-24">
    <h2 className="mt-8 text-2xl font-bold text-foreground">{copy.title}</h2>
    <p className="text-muted-foreground">{copy.intro}</p>
    {copy.blocks.map((b) => (
      <div key={b.heading}>
        <h3 className="mt-4 text-xl font-semibold text-foreground">{b.heading}</h3>
        {b.paragraphs?.map((t) => (
          <p key={t} className="text-muted-foreground">
            {t}
          </p>
        ))}
        {b.bullets && (
          <ul className="list-inside list-disc space-y-2 text-muted-foreground">
            {b.bullets.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    ))}
    <p className="text-muted-foreground">
      <a href="https://www.dnc.gov.hk" target="_blank" rel="noopener noreferrer" className="text-brand underline hover:text-foreground">
        {copy.ofcaLinkText}
      </a>{" "}
      <a href="https://www.pcpd.org.hk" target="_blank" rel="noopener noreferrer" className="text-brand underline hover:text-foreground">
        {copy.pcpdLinkText}
      </a>
    </p>
  </div>
);

const Privacy = () => {
  // The consent line on /HongKongSpam links to #hk-stop-spam (or #hk-stop-spam-zh); the section renders after load, so scroll to it here.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView?.();
  }, []);

  return (
    <>
      <Seo {...pageMeta["/privacy"]} path="/privacy" />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-foreground">
              Privacy Policy
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Last updated: 12 October 2026
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                1. Introduction
              </h2>
              <p className="text-muted-foreground">
                MyPrivacyTOOL ("we," "us," "our," or "Company") is committed to
                protecting your privacy and ensuring you have a positive
                experience on our website and services. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your
                information when you visit our website and use our services.
              </p>
              <p className="text-muted-foreground">
                Please read this Privacy Policy carefully. If you do not agree
                with our policies and practices, please do not use our services.
                If you have any questions, contact us at{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-brand underline hover:text-foreground"
                >
                  privacy@myprivacytool.io
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                2. Information We Collect
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.0 What Stays in Your Browser
              </h3>
              <p className="text-muted-foreground">
                The free scan on our homepage detects device, browser and network
                characteristics directly in your browser, and shows them to you
                there. The finished result stays in your browser. It is not sent
                to us unless you ask for your report and choose to save it (see
                section 2.4). If you leave without giving us an email address,
                nothing from the scan is saved. The other information described
                below is stored only when you take an action that submits it (for
                example, entering your email address, messaging our bot, or
                requesting a scan of a social handle).
              </p>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.1 Information You Provide Directly
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Account Registration:</strong> Email address, name,
                  password, phone number (optional), organization name
                </li>
                <li>
                  <strong>Scan Requests:</strong> Email addresses and data
                  exposure information you request us to search for
                </li>
                <li>
                  <strong>Payment Information:</strong> Billing address, payment
                  method (processed securely by Stripe)
                </li>
                <li>
                  <strong>Communications:</strong> Feedback, support requests,
                  inquiries sent to our customer support team
                </li>
                <li>
                  <strong>Newsletter & Waitlist Sign-ups:</strong> Email address
                  and the page or campaign you signed up from, stored in our CRM
                  (HubSpot)
                </li>
                <li>
                  <strong>Scan Summary Submitted with Your Email:</strong> If you
                  enter your email to receive or save your scan summary, we store
                  the email address together with your risk score and the number of
                  data points you confirmed
                </li>
                <li>
                  <strong>Messaging Channel Data:</strong> If you contact us through
                  a messaging channel (currently Telegram and the web start page),
                  we store your channel ID, display name, your replies, and your
                  conversation stage so we can continue the conversation. When you
                  message our Telegram bot we receive what you send (including
                  message text), your Telegram user id, and the public details of
                  your profile that Telegram makes available to bots, such as your
                  name, @handle, profile photo details, bio and, where public, a
                  linked personal channel. We do not receive your phone number or
                  contacts unless you share them. We use this to run your privacy
                  scan and to measure what a messaging channel makes visible about
                  a person. We keep it for up to 90 days, then it is deleted
                  automatically. Our team can see it on a restricted basis; it is
                  not shared publicly. You can ask us to delete everything linked
                  to your Telegram id at any time by writing to{" "}
                  <a
                    href="mailto:privacy@myprivacytool.io"
                    className="text-brand underline hover:text-foreground"
                  >
                    privacy@myprivacytool.io
                  </a>
                  .
                </li>
                <li>
                  <strong>Optional Contact Details:</strong> Where you choose to
                  provide them, your first and last name and mobile number (for
                  example to receive scan results by SMS, WhatsApp or Telegram),
                  stored in our CRM together with a record of the consent you gave,
                  when, and which version of our wording you saw
                </li>
                <li>
                  <strong>Age Confirmation:</strong> We ask you to confirm you are
                  16 or older with a checkbox. We do not collect or store your date
                  of birth
                </li>
                <li>
                  <strong>Handles You Ask Us to Scan:</strong> Social media handles
                  and platform names you submit, and the number of data points and
                  confidence score found for them
                </li>
                <li>
                  <strong>Survey & Questionnaire Data:</strong> Information you
                  provide voluntarily to help improve our services
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.2 Information Collected Automatically
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Device Information:</strong> Device type, operating
                  system, browser type, IP address. To show you your IP address
                  and approximate location, the scan asks two third-party
                  services (ipify and ipapi.co) from your browser when the scan
                  loads, so they receive your IP address
                </li>
                <li>
                  <strong>Usage Analytics:</strong> Pages visited, time spent on
                  pages, clicks, referrer source (via Google Analytics 4)
                </li>
                <li>
                  <strong>Cookies & Similar Technologies:</strong> Session IDs,
                  preference settings, security tokens
                </li>
                <li>
                  <strong>Engagement Records:</strong> For users of our scan
                  workflow, whether you clicked through, confirmed an email or
                  mobile number, and completed a full scan
                </li>
                <li>
                  <strong>Location Information:</strong> General geolocation
                  derived from IP address (not precise location)
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.3 Server Logs of Every Page Request
              </h3>
              <p className="text-muted-foreground">
                When your browser or any other program asks our website for a
                page, our servers keep a log entry of that request, as most
                websites do. We keep it to protect the site, to tell people apart
                from automated programs, and to understand which programs read
                our site. We do not use this log to block or challenge anyone. The
                entry holds: the time, the page address (without anything after a
                question mark), the request type and our response code, the
                browser or program name it reported (the user agent), your IP
                address, the country and network your IP address belongs to, the
                page you came from (site and page only), and a short list of
                technical headers that browsers send (such as accepted languages
                and browser hints). It never holds cookies or login details. Images,
                fonts and other page files are not logged.
              </p>
              <p className="mt-4 text-muted-foreground">
                We sort each request into one of four groups using a written list
                of rules, which we version and improve over time: person, search
                or other bot, AI crawler or AI agent, or unknown. The rules look at
                the program name, the kind of network the request comes from, and
                whether the request has the headers every ordinary browser sends.
                Any request we cannot place is treated as a person. The sorting
                is not perfect: a program can pretend to be a browser, and a
                person who hides their browser details can look like a bot.
              </p>
              <p className="mt-4 text-muted-foreground">
                For bots and AI crawlers we record and keep the full entry,
                because a machine is not a person. For people, and for requests we
                could not place, we keep the entry but remove the IP address after
                30 days; the rest of the entry then stays without it. If you think
                a visit of yours was wrongly sorted as a bot, contact us and we
                will delete it.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.4 Your Saved Scan Result
              </h3>
              <p className="text-muted-foreground">
                The free scan runs in your browser and shows you the results
                there. We do not save it unless you ask for your report. When you
                enter your email address and tick the box to save your scan
                result, we save the full result, meaning the technical details
                your browser reported such as IP address, device, browser,
                language, screen and fingerprint-style values, together with your
                email address, for 12 months, so your report can show it. If you
                leave without giving an email address, nothing from the scan is
                saved. We only count, without personal data, how many visitors
                finish a scan and how many ask for a report, through our analytics
                if you accepted analytics cookies.
              </p>
              <p className="mt-4 text-muted-foreground">
                A saved scan is personal data. After you save it we show you a
                scan number, and it is in your report email. To have a saved scan
                deleted, write to{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-brand underline hover:text-foreground"
                >
                  privacy@myprivacytool.io
                </a>{" "}
                with your scan number or the email address you used.
              </p>

              {learningEventsEnabled() && (
                <>
                  <h3 className="mt-6 text-xl font-semibold text-foreground">
                    2.4A Your Answers About a Hexagon
                  </h3>
                  <p className="text-muted-foreground">
                    If you accepted analytics in the cookie banner, and you press
                    an answer button on a hexagon in your scan (for example
                    &ldquo;Yes, that&rsquo;s me&rdquo; or &ldquo;Not me&rdquo;), we
                    record your answer, which hexagon it was about, which look the
                    hexagon had, and how sure we said we were. We also record that
                    the hexagon was shown to you. Closing a prompt, or tapping a
                    hexagon without answering, records nothing. If you did not
                    accept analytics, nothing is sent.
                  </p>
                  <p className="mt-4 text-muted-foreground">
                    We do not record what we found (for example your city or your
                    internet provider), your IP address, your email address or
                    anything that names you. So that one visitor is not counted
                    twice, your browser makes a random code and keeps it in its own
                    storage. The code is not linked to your email address, your
                    scan number or any account.
                  </p>
                  <p className="mt-4 text-muted-foreground">
                    We use the answers only as counts, to see how often our guesses
                    are right. A person may change how sure we say we are about a
                    hexagon, and only after at least 30 people have answered about
                    it. We do not make decisions about you from your answers. We
                    keep each answer for about 90 days. After that it is turned
                    into a daily count that no longer contains the random code.
                  </p>
                  <p className="mt-4 text-muted-foreground">
                    To stop, withdraw your consent in the cookie settings, or clear
                    this site&rsquo;s data in your browser. To ask us to delete the
                    answers linked to your random code, write to{" "}
                    <a
                      href="mailto:privacy@myprivacytool.io"
                      className="text-brand underline hover:text-foreground"
                    >
                      privacy@myprivacytool.io
                    </a>{" "}
                    and we will tell you how to find it.
                  </p>
                </>
              )}

              {recognitionFlagOn() && (
                <>
                  <h3 className="mt-6 text-xl font-semibold text-foreground">
                    2.5 Recognising Your Device
                  </h3>
                  <p className="text-muted-foreground">
                    If you choose to, we can tell you when we recognise the device
                    you are using from the technical details its browser shows us,
                    without using a cookie. We do this in the open: when it happens
                    we show you that we recognised you, which details we used and
                    how, and what you can do about it, including asking us to
                    delete it. We do not recognise your device in the background.
                    If you do nothing, we do not link a visit to you. Recognising a
                    device is only used with your consent, and you can withdraw it
                    at any time by contacting us or deleting your scan number
                    record.
                  </p>
                </>
              )}

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                {recognitionFlagOn() ? "2.6" : "2.5"} Information from Third Parties
              </h3>
              <p className="text-muted-foreground">
                We may receive information about you from third-party sources,
                including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  Data brokers and public records databases (for scan results)
                </li>
                <li>
                  Analytics partners (aggregated, anonymized data about website
                  usage)
                </li>
                <li>Marketing partners (for audience insights)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                2A. Information We Do Not Collect
              </h2>
              <p className="text-muted-foreground">
                We do not collect your date of birth or your street address for our
                free scan or waitlist. If a paid feature later requires a billing
                address, we will tell you at the point of collection and keep it
                only as long as tax and accounting law requires.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                3. How We Use Your Information
              </h2>
              <p className="text-muted-foreground mb-4">
                We use your information for the following purposes:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Service Delivery:</strong> Performing privacy scans,
                  generating exposure reports, managing your account
                </li>
                <li>
                  <strong>Customer Support:</strong> Responding to inquiries,
                  troubleshooting issues, sending account updates
                </li>
                <li>
                  <strong>Billing & Payments:</strong> Processing subscription
                  payments and generating invoices
                </li>
                <li>
                  <strong>Marketing:</strong> Sending promotional emails, product
                  announcements (with your consent)
                </li>
                <li>
                  <strong>Analytics & Improvement:</strong> Understanding how
                  our services are used to improve product features
                </li>
                <li>
                  <strong>Follow-up Communications:</strong> Contacting you about
                  your scan, waitlist or conversation, and measuring which
                  campaigns bring people to our site
                </li>
                <li>
                  <strong>Legal Compliance:</strong> Complying with laws,
                  regulations, and legal requests
                </li>
                <li>
                  <strong>Fraud Prevention:</strong> Detecting and preventing
                  unauthorized access and fraudulent activity
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                4. Legal Basis for Processing (GDPR/PDPA)
              </h2>
              <p className="text-muted-foreground mb-4">
                Under GDPR and PDPA, we process personal data on the following
                legal bases:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Consent:</strong> Where you have explicitly agreed
                  (e.g., marketing emails)
                </li>
                <li>
                  <strong>Contract:</strong> To fulfill our obligations under
                  your service agreement
                </li>
                <li>
                  <strong>Legal Obligation:</strong> To comply with applicable
                  laws and regulations
                </li>
                <li>
                  <strong>Legitimate Interests:</strong> To improve services,
                  prevent fraud, and maintain security
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                5. Data Sharing & Disclosure
              </h2>
              <p className="text-muted-foreground">
                We do NOT sell your personal data. We may share information with:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Service Providers:</strong> Payment processors (Stripe),
                  hosting and edge infrastructure (Cloudflare), databases (Supabase,
                  Google Cloud), CRM and email (HubSpot), messaging platforms
                  (Telegram), transactional email (Resend), internal task and
                  notification tools (Notion, Slack), and analytics (Google Analytics 4, and Cloudflare
                  Web Analytics, which counts page loads without cookies)
                </li>
                <li>
                  <strong>AI Model Providers:</strong> When you send us a message
                  through a messaging channel, we may send the text of that message
                  to an AI language model run by a third-party provider, for
                  example to work out what you are asking about. We remove email
                  addresses and phone numbers from the text first, and we do not
                  add your name, contact details or scan results to it. We choose
                  AI providers and models, open-source or closed-source and from
                  any country, to fit the business and technical need, and we change
                  them over time. The providers in use are always named in the
                  sub-processor list of our DPA. The free scan on our website and
                  Alice's spoken guidance do not send anything to an AI provider
                </li>
                <li>
                  <strong>Email Checks for Your Report:</strong> To prepare your
                  report we send the domain part of your email address to
                  Cloudflare (a public DNS lookup) and to rdap.org and the
                  domain registry it points to (the public domain-registration
                  record), and a SHA-256 hash of your email address to Gravatar
                  and to Libravatar to see whether a public profile or avatar
                  exists. Where we check whether your address appears in a data
                  breach, we name that provider here when the check is switched on.
                  The same applies to a search of public code commits on GitHub:
                  if we switch it on, your email address itself (not a hash) goes
                  to GitHub, in a search for public commits that name it as the
                  author, and we say so here at that point
                </li>
                <li>
                  <strong>Legal Authorities:</strong> When required by law or to
                  protect rights and safety
                </li>
                <li>
                  <strong>Business Partners:</strong> With your explicit consent
                  for specific partnerships
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                All service providers are bound by confidentiality agreements and
                data processing addendums (DPA).
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                6. Data Retention
              </h2>
              <p className="text-muted-foreground">
                We retain your personal data for as long as necessary to provide
                services and comply with legal obligations:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Account Data:</strong> Retained for the duration of
                  your subscription plus 30 days
                </li>
                <li>
                  <strong>Scan Results:</strong> Per-session scan results for
                  submitted handles are deleted automatically after 24 hours.
                  Results saved to an account are retained for 2 years for
                  historical comparison and reporting
                </li>
                <li>
                  <strong>Saved Web Scans:</strong> The full result of a scan you
                  chose to save with your email address (see section 2.4) is
                  kept for 12 months, then deleted automatically. To ask for
                  earlier deletion, contact us with your scan number or the email
                  address you used
                </li>
                <li>
                  <strong>Server Request Logs:</strong> The log of page requests
                  (see section 2.3) keeps full entries for bots and AI crawlers.
                  For people and requests we could not place, the IP address is
                  removed after 30 days. To ask for earlier deletion of a visit,
                  contact us with the approximate time and your IP address
                </li>
                <li>
                  <strong>Messaging Conversation State:</strong> Retained for 7
                  days of inactivity in our messaging system; the CRM record
                  remains until you ask us to delete it or unsubscribe
                </li>
                <li>
                  <strong>Newsletter, Waitlist & Lead Records:</strong> Retained
                  for 24 months after your last engagement with us, or until you
                  unsubscribe or ask us to delete them, whichever is earlier
                </li>
                <li>
                  <strong>Engagement Records:</strong> Retained for as long as
                  needed to measure how our scan workflow performs, then deleted
                  or anonymised
                </li>
                <li>
                  <strong>Billing Records:</strong> Retained for 7 years
                  (legal requirement)
                </li>
                <li>
                  <strong>Analytics Data:</strong> Aggregated data retained for
                  12 months
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                You may request deletion of your data at any time, subject to
                legal retention requirements.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                7. Your Data Rights
              </h2>
              <p className="text-muted-foreground mb-4">
                Depending on your location, you have the following rights:
              </p>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                GDPR Rights (EU/UK/EEA):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Right of Access:</strong> Obtain a copy of your
                  personal data
                </li>
                <li>
                  <strong>Right to Rectification:</strong> Correct inaccurate
                  data
                </li>
                <li>
                  <strong>Right to Erasure:</strong> Request deletion of your
                  data ("Right to be Forgotten")
                </li>
                <li>
                  <strong>Right to Restrict Processing:</strong> Limit how we
                  use your data
                </li>
                <li>
                  <strong>Right to Data Portability:</strong> Receive your data
                  in a machine-readable format
                </li>
                <li>
                  <strong>Right to Object:</strong> Opt out of marketing and
                  certain processing activities
                </li>
                <li>
                  <strong>Right to Withdraw Consent:</strong> Revoke permission
                  for specific processing
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                CCPA Rights (California):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>Right to Know: Request access to your personal information</li>
                <li>
                  Right to Delete: Request deletion of your personal information
                </li>
                <li>
                  Right to Opt Out: Opt out of the sale of personal information
                </li>
                <li>
                  Right to Non-Discrimination: We will not discriminate against
                  you for exercising your rights
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                PDPO Rights (Hong Kong):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>Right to Access: Obtain access to your personal data</li>
                <li>
                  Right to Correction: Request correction of inaccurate data
                </li>
                <li>
                  Right to Erasure: Request deletion of your personal data
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                PDPA Rights (Singapore):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>Right to Access: Obtain access to your personal data</li>
                <li>
                  Right to Correction: Request correction of inaccurate data
                </li>
                <li>
                  Right to Opt Out: Opt out of marketing communications
                </li>
              </ul>

              <p className="mt-6 text-muted-foreground">
                To exercise any of these rights, contact us at{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-brand underline hover:text-foreground"
                >
                  privacy@myprivacytool.io
                </a>{" "}
                with your request. We will respond within 30 days.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                8. Data Security
              </h2>
              <p className="text-muted-foreground">
                We implement industry-standard security measures to protect your
                personal data:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Encryption:</strong> All data transmitted over HTTPS
                  (TLS 1.3)
                </li>
                <li>
                  <strong>At-Rest Encryption:</strong> Sensitive data encrypted
                  in our databases
                </li>
                <li>
                  <strong>Access Controls:</strong> Role-based access to
                  sensitive data
                </li>
                <li>
                  <strong>Regular Audits:</strong> Security assessments and
                  vulnerability testing
                </li>
                <li>
                  <strong>Incident Response:</strong> Procedures to detect and
                  respond to breaches
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                While we take security seriously, no method of transmission over
                the Internet is 100% secure. We cannot guarantee absolute
                security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                9. International Data Transfers
              </h2>
              <p className="text-muted-foreground">
                We are based in Hong Kong and store data on servers in multiple
                regions. If you are located in the EU/EEA, your data will be
                transferred outside the EEA. We ensure adequate protection through:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Standard Contractual Clauses (SCCs):</strong> EU-approved
                  contractual safeguards for data transfers
                </li>
                <li>
                  <strong>Data Processing Agreements (DPA):</strong> Binding
                  agreements with all service providers
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                10. Cookies & Tracking Technologies
              </h2>
              <p className="text-muted-foreground">
                We use cookies and similar technologies to enhance your experience.
                See our Cookie Policy for detailed information.
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground">
                <li>
                  <strong>Essential Cookies:</strong> Required for site
                  functionality
                </li>
                <li>
                  <strong>Analytics Cookies:</strong> Track usage patterns (Google
                  Analytics 4). Analytics events are only sent after you allow
                  analytics in our consent manager
                </li>
                <li>
                  <strong>Marketing Cookies:</strong> Support targeted advertising
                  (with consent)
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                You can control cookie preferences in our Cookie Management Center
                or your browser settings.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                11. Third-Party Links
              </h2>
              <p className="text-muted-foreground">
                Our website may contain links to third-party websites. We are not
                responsible for their privacy practices. We encourage you to review
                their privacy policies before providing personal data.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                12. Children's Privacy
              </h2>
              <p className="text-muted-foreground">
                Our services are not intended for individuals under 16 years old.
                We do not knowingly collect personal data from children. If we
                become aware of such collection, we will delete the data
                immediately.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                13. Privacy Policy Changes
              </h2>
              <p className="text-muted-foreground">
                We may update this Privacy Policy periodically. We will notify you
                of significant changes via email or a prominent notice on our
                website. Your continued use of our services indicates acceptance
                of the updated policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                14. Contact Information
              </h2>
              <p className="text-muted-foreground">
                If you have questions or concerns about this Privacy Policy,
                please contact us:
              </p>
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
                  <strong>Mailing Address:</strong>
                  <br />
                  MyPrivacyTOOL Ltd.
                  <br />
                  Hong Kong
                </p>
                <p>
                  <strong>Data Protection Officer (DPO):</strong> Contact us at
                  the above email
                </p>
              </div>
            </section>

            <section className="mb-8">
              <HkPolicyBlocks copy={HK_POLICY_EN} id={HK_POLICY_ANCHOR.en} />
              <HkPolicyBlocks copy={HK_POLICY_ZH} id={HK_POLICY_ANCHOR.zh} />
            </section>

            {/* MPC-7645: shown only while the referral programme is on, so the policy goes live in the same flip as the feature. Draft wording for Chris and a lawyer. */}
            {referralsEnabled() && (
              <section className="mb-8" id="referrals">
                <h2 className="mt-8 text-2xl font-bold text-foreground">16. Inviting Friends (Referral Programme)</h2>
                <p className="text-muted-foreground">
                  If you invite friends, we give you a personal referral code and a private link, both in your report email. We keep your code, how many friends signed up through it and how many got their first report, and the number of free Pro months you have earned. We do not keep your friends&apos; names, and we never tell you or them anything about each other&apos;s results.
                </p>
                <h3 className="mt-4 text-xl font-semibold text-foreground">If you ask us to email a friend</h3>
                <p className="text-muted-foreground">
                  You give us the address. We send that person one email saying someone who uses MyPrivacyTOOL asked us to, without saying who. We keep only a SHA-256 hash of the address, never the address itself, so we can tell if you invite the same person twice and match them if they later sign up through your link. We check it against our opt-out and suppression lists first, send no reminders, and the email has an unsubscribe link that stops us ever emailing that address. You may invite up to 10 people in total. Only invite people who would expect to hear from you.
                </p>
                <h3 className="mt-4 text-xl font-semibold text-foreground">If someone invites you</h3>
                <p className="text-muted-foreground">
                  Using a friend&apos;s link is your choice. If you run a scan through it, your friend learns only that you completed one, and earns a free month of Pro. You can ask us to delete your data at any time, which also removes the link between you and your friend.
                </p>
                <p className="text-muted-foreground">We keep referral records for as long as the accounts they belong to, and delete them with the account. Write to privacy@myprivacytool.io to see or delete yours.</p>
              </section>
            )}

            <section className="mb-12 rounded-lg bg-muted p-6">
              <h3 className="mb-4 text-lg font-semibold text-foreground">
                Your Privacy Rights Under Law
              </h3>
              <p className="text-muted-foreground">
                If you believe we have violated your privacy rights, you have the
                right to lodge a complaint with your local data protection
                authority. For EU/UK residents, this includes the Information
                Commissioner's Office (ICO).
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default Privacy;
