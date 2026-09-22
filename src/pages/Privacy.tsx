import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

const Privacy = () => {
  const { t } = useTranslation();

  return (
    <>
      <Helmet>
        <title>Privacy Policy - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="Our Privacy Policy explains how we collect, use, and protect your personal data in compliance with GDPR, CCPA, PDPO, and PDPA."
        />
      </Helmet>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-gray-900">
              Privacy Policy
            </h1>
            <p className="mb-8 text-lg text-gray-600">
              Last updated: September 2026
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                1. Introduction
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL ("we," "us," "our," or "Company") is committed to
                protecting your privacy and ensuring you have a positive
                experience on our website and services. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your
                information when you visit our website and use our services.
              </p>
              <p className="text-gray-700">
                Please read this Privacy Policy carefully. If you do not agree
                with our policies and practices, please do not use our services.
                If you have any questions, contact us at{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-blue-600 hover:text-blue-700"
                >
                  privacy@myprivacytool.io
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                2. Information We Collect
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                2.1 Information You Provide Directly
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
                  <strong>Survey & Questionnaire Data:</strong> Information you
                  provide voluntarily to help improve our services
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                2.2 Information Collected Automatically
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  <strong>Device Information:</strong> Device type, operating
                  system, browser type, IP address
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
                  <strong>Location Information:</strong> General geolocation
                  derived from IP address (not precise location)
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                2.3 Information from Third Parties
              </h3>
              <p className="text-gray-700">
                We may receive information about you from third-party sources,
                including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
              <h2 className="text-2xl font-bold text-gray-900">
                3. How We Use Your Information
              </h2>
              <p className="text-gray-700 mb-4">
                We use your information for the following purposes:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
              <h2 className="text-2xl font-bold text-gray-900">
                4. Legal Basis for Processing (GDPR/PDPA)
              </h2>
              <p className="text-gray-700 mb-4">
                Under GDPR and PDPA, we process personal data on the following
                legal bases:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
              <h2 className="text-2xl font-bold text-gray-900">
                5. Data Sharing & Disclosure
              </h2>
              <p className="text-gray-700">
                We do NOT sell your personal data. We may share information with:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  <strong>Service Providers:</strong> Payment processors (Stripe),
                  hosting providers (AWS), analytics tools
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
              <p className="mt-4 text-gray-700">
                All service providers are bound by confidentiality agreements and
                data processing addendums (DPA).
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                6. Data Retention
              </h2>
              <p className="text-gray-700">
                We retain your personal data for as long as necessary to provide
                services and comply with legal obligations:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  <strong>Account Data:</strong> Retained for the duration of
                  your subscription plus 30 days
                </li>
                <li>
                  <strong>Scan Results:</strong> Retained for 2 years for
                  historical comparison and reporting
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
              <p className="mt-4 text-gray-700">
                You may request deletion of your data at any time, subject to
                legal retention requirements.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                7. Your Data Rights
              </h2>
              <p className="text-gray-700 mb-4">
                Depending on your location, you have the following rights:
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                GDPR Rights (EU/UK/EEA):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                CCPA Rights (California):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                PDPO Rights (Hong Kong):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Right to Access: Obtain access to your personal data</li>
                <li>
                  Right to Correction: Request correction of inaccurate data
                </li>
                <li>
                  Right to Erasure: Request deletion of your personal data
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                PDPA Rights (Singapore):
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Right to Access: Obtain access to your personal data</li>
                <li>
                  Right to Correction: Request correction of inaccurate data
                </li>
                <li>
                  Right to Opt Out: Opt out of marketing communications
                </li>
              </ul>

              <p className="mt-6 text-gray-700">
                To exercise any of these rights, contact us at{" "}
                <a
                  href="mailto:privacy@myprivacytool.io"
                  className="text-blue-600 hover:text-blue-700"
                >
                  privacy@myprivacytool.io
                </a>{" "}
                with your request. We will respond within 30 days.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                8. Data Security
              </h2>
              <p className="text-gray-700">
                We implement industry-standard security measures to protect your
                personal data:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
              <p className="mt-4 text-gray-700">
                While we take security seriously, no method of transmission over
                the Internet is 100% secure. We cannot guarantee absolute
                security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                9. International Data Transfers
              </h2>
              <p className="text-gray-700">
                We are based in Hong Kong and store data on servers in multiple
                regions. If you are located in the EU/EEA, your data will be
                transferred outside the EEA. We ensure adequate protection through:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
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
              <h2 className="text-2xl font-bold text-gray-900">
                10. Cookies & Tracking Technologies
              </h2>
              <p className="text-gray-700">
                We use cookies and similar technologies to enhance your experience.
                See our Cookie Policy for detailed information.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  <strong>Essential Cookies:</strong> Required for site
                  functionality
                </li>
                <li>
                  <strong>Analytics Cookies:</strong> Track usage patterns (Google
                  Analytics 4)
                </li>
                <li>
                  <strong>Marketing Cookies:</strong> Support targeted advertising
                  (with consent)
                </li>
              </ul>
              <p className="mt-4 text-gray-700">
                You can control cookie preferences in our Cookie Management Center
                or your browser settings.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                11. Third-Party Links
              </h2>
              <p className="text-gray-700">
                Our website may contain links to third-party websites. We are not
                responsible for their privacy practices. We encourage you to review
                their privacy policies before providing personal data.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                12. Children's Privacy
              </h2>
              <p className="text-gray-700">
                Our services are not intended for individuals under 18 years old.
                We do not knowingly collect personal data from children. If we
                become aware of such collection, we will delete the data
                immediately.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                13. Privacy Policy Changes
              </h2>
              <p className="text-gray-700">
                We may update this Privacy Policy periodically. We will notify you
                of significant changes via email or a prominent notice on our
                website. Your continued use of our services indicates acceptance
                of the updated policy.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                14. Contact Information
              </h2>
              <p className="text-gray-700">
                If you have questions or concerns about this Privacy Policy,
                please contact us:
              </p>
              <div className="mt-4 space-y-2 text-gray-700">
                <p>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:privacy@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
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

            <section className="mb-12 rounded-lg bg-blue-50 p-6">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                Your Privacy Rights Under Law
              </h3>
              <p className="text-gray-700">
                If you believe we have violated your privacy rights, you have the
                right to lodge a complaint with your local data protection
                authority. For EU/UK residents, this includes the Information
                Commissioner's Office (ICO).
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default Privacy;
