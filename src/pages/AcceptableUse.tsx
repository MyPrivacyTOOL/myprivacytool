import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

const AcceptableUse = () => {
  return (
    <>
      <Seo {...pageMeta["/acceptable-use"]} path="/acceptable-use" />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <p className="mb-4 text-sm italic text-muted-foreground">
              Draft — subject to legal review
            </p>
            <h1 className="mb-2 text-4xl font-bold text-foreground">
              Acceptable Use Policy
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Last updated: October 2026
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                1. Purpose
              </h2>
              <p className="text-muted-foreground">
                This Acceptable Use Policy ("Policy") sets out what you may and may not do when using MyPrivacyTOOL's website and services (the "Services"). MyPrivacyTOOL is an online privacy scanning and monitoring service that helps people check their personal data exposure across data breaches and the dark web. It applies to all users, including those on the Free ($0), Basic ($7.99/mo), Pro ($14.99/mo) and Executive ($49.99/mo) plans. It forms part of, and should be read with, our Terms of Service.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                2. Permitted Use
              </h2>
              <p className="text-muted-foreground">
                You may use the Services to check and monitor your own personal data, such as your own email addresses, and to take steps to reduce your exposure. You may also check information about another person only where that person has given you clear permission, or where you are legally authorised to act for them (for example, a parent or guardian acting for a child, or an organisation monitoring its own staff accounts on its own domain).
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                3. Prohibited Use
              </h2>
              <p className="text-muted-foreground">
                You must not use the Services to:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
                <li>scan, search for or collect information about another person's email address or personal data without their consent or other lawful authority;</li>
                <li>stalk, harass, threaten, intimidate, dox or otherwise harm any person, or to assist account takeover, credential stuffing, phishing, fraud, extortion or identity theft;</li>
                <li>resell, redistribute or republish scan results, breach data or any data obtained through the Services, other than your own results;</li>
                <li>build a competing product or dataset, or use the Services to train machine learning models, without our written permission;</li>
                <li>submit false, misleading or unlawful content, or impersonate any person or organisation;</li>
                <li>violate any applicable law or regulation, including data protection, privacy, anti-spam and computer misuse laws, or the rights of any third party.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                4. Security and Technical Restrictions
              </h2>
              <p className="text-muted-foreground">
                You must not:
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
                <li>probe, scan or test the vulnerability of our systems or networks, or breach or circumvent authentication or security measures, without our prior written authorisation;</li>
                <li>use bots, scrapers or automated means to access the Services, other than through an interface we expressly provide;</li>
                <li>exceed or evade rate limits, plan limits or usage quotas, including by creating multiple accounts or sharing credentials;</li>
                <li>introduce malware or interfere with or disrupt the Services, their infrastructure or other users' use of them;</li>
                <li>reverse engineer, decompile or attempt to extract source code from the Services, except where the law permits.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                5. Third-Party Data Sources and Services
              </h2>
              <p className="text-muted-foreground">
                Our Services rely on third-party providers, including the Have I Been Pwned API for breach data. Your use of results derived from those sources must comply with this Policy and with any applicable third-party terms. You must not use such results to harm the individuals affected by a breach.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                6. Accounts and Payments
              </h2>
              <p className="text-muted-foreground">
                You are responsible for keeping your account credentials secure and for all activity under your account. Paid plans are processed by Stripe. You must not use stolen, unauthorised or fraudulent payment methods, and must not initiate fraudulent chargebacks.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                7. Reporting Violations
              </h2>
              <p className="text-muted-foreground">
                If you become aware of any use of the Services that breaches this
                Policy, please report it to us at 
                <a
                  href="mailto:support@myprivacytool.io"
                  className="text-brand underline hover:text-foreground"
                >
                  support@myprivacytool.io
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                8. Enforcement
              </h2>
              <p className="text-muted-foreground">
                We may investigate suspected violations. Where we reasonably believe this Policy has been breached, we may, without prior notice and at our discretion, remove content, limit or suspend access, terminate your account, withhold refunds where permitted by law, and report the matter to law enforcement or regulators. Taking or not taking action in one case does not waive our right to act in another.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                9. Changes to This Policy
              </h2>
              <p className="text-muted-foreground">
                We may update this Policy from time to time. The "Last updated" date at the top of this page shows when it was last revised. Continued use of the Services after a change means you accept the updated Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                10. Governing Law
              </h2>
              <p className="text-muted-foreground">
                This Policy is governed by the laws of the Hong Kong Special Administrative Region, and the courts of Hong Kong SAR have jurisdiction over any dispute arising from it.
              </p>
            </section>

          </div>
        </div>
      </main>
    </>
  );
};

export default AcceptableUse;
