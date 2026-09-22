import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Helmet } from "react-helmet-async";

const Terms = () => {
  return (
    <>
      <Helmet>
        <title>Terms of Service - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="Terms of Service for MyPrivacyTOOL. Review our service terms, limitations, and user responsibilities."
        />
      </Helmet>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-gray-900">
              Terms of Service
            </h1>
            <p className="mb-8 text-lg text-gray-600">
              Last updated: September 2026
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                1. Agreement to Terms
              </h2>
              <p className="text-gray-700">
                These Terms of Service ("Terms") govern your access to and use of
                MyPrivacyTOOL's website, services, and products (collectively, the
                "Services"). By accessing or using MyPrivacyTOOL, you agree to be
                bound by these Terms. If you do not agree to any part of these
                Terms, you may not use the Services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                2. Eligibility
              </h2>
              <p className="text-gray-700">
                You must be at least 18 years old and have the legal capacity to
                enter into a binding agreement to use the Services. If you are
                using the Services on behalf of an organization, you represent and
                warrant that you have authority to bind that organization to these
                Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                3. User Accounts
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                3.1 Account Registration
              </h3>
              <p className="text-gray-700">
                To use certain features of the Services, you must create an account
                and provide accurate, complete, and current information. You are
                responsible for maintaining the confidentiality of your password
                and account credentials.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                3.2 Account Responsibility
              </h3>
              <p className="text-gray-700">
                You are fully responsible for all activity that occurs under your
                account. You agree to notify us immediately of any unauthorized use
                of your account or any other breach of security. We are not
                responsible for any loss or damage resulting from your failure to
                maintain account security.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                3.3 Account Termination
              </h3>
              <p className="text-gray-700">
                We reserve the right to suspend or terminate your account if you
                violate these Terms or engage in any fraudulent, abusive, or
                illegal activity. You may delete your account at any time by
                contacting support@myprivacytool.io.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                4. Services Description
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL provides privacy scanning and exposure assessment
                services. Our Services include:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Free privacy scans to identify your data exposure</li>
                <li>Exposure scoring and privacy risk assessment</li>
                <li>
                  Paid removal and data suppression services (where available)
                </li>
                <li>Privacy education and guidance resources</li>
                <li>Account monitoring and alerts (premium tier)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                5. User Obligations
              </h2>
              <p className="text-gray-700">
                By using the Services, you agree that you will not:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  Violate any applicable laws, regulations, or third-party rights
                </li>
                <li>
                  Use the Services to scan or obtain data on individuals without
                  their consent
                </li>
                <li>
                  Harass, abuse, or intimidate other users or our employees
                </li>
                <li>
                  Attempt to gain unauthorized access to our systems or networks
                </li>
                <li>
                  Reverse engineer, decompile, or disassemble our Services
                </li>
                <li>
                  Scrape, crawl, or automated data collection from our platform
                </li>
                <li>Transmit malware, viruses, or harmful code</li>
                <li>
                  Interfere with or disrupt the integrity or performance of our
                  Services
                </li>
                <li>Resell or redistribute our Services</li>
                <li>
                  Use the Services for competitive intelligence or market research
                  without permission
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                6. Subscription & Billing
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.1 Free Tier
              </h3>
              <p className="text-gray-700">
                Our free privacy scan allows you to check your exposure without
                cost. Free scans are subject to limitations on frequency and scope.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.2 Paid Subscriptions
              </h3>
              <p className="text-gray-700">
                Paid subscriptions are billed monthly or annually as specified at
                purchase. Your subscription renews automatically unless you cancel
                before the renewal date. Cancellation must be submitted through your
                account settings or by contacting support.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.3 Billing & Payment
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>
                  We charge the payment method on file for your subscription
                </li>
                <li>
                  All prices are in USD unless otherwise stated and exclude taxes
                </li>
                <li>
                  Applicable sales tax, VAT, or GST will be added to your invoice
                </li>
                <li>
                  We accept major credit cards and other payment methods via Stripe
                </li>
                <li>
                  If payment fails, we will attempt to charge your account up to
                  three times
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.4 Refund Policy
              </h3>
              <p className="text-gray-700">
                Subscriptions are non-refundable except where required by law. We
                may issue refunds for billing errors or service failures at our
                discretion. Monthly subscriptions may be cancelled within 14 days
                of purchase for a full refund.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.5 Price Changes
              </h3>
              <p className="text-gray-700">
                We may change our pricing with 30 days' notice. Existing
                subscribers will be notified of changes via email. Your continued
                use of the Services after the change constitutes acceptance of the
                new pricing.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                7. Intellectual Property Rights
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7.1 Our IP
              </h3>
              <p className="text-gray-700">
                All content, features, and functionality of the Services (including
                software, text, graphics, logos, images, and databases) are owned
                by MyPrivacyTOOL or our licensors and are protected by copyright,
                trademark, and other intellectual property laws.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7.2 Limited License
              </h3>
              <p className="text-gray-700">
                We grant you a limited, non-exclusive, non-transferable license to
                access and use the Services for your personal, non-commercial use.
                This license does not include the right to:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Modify or create derivative works</li>
                <li>Copy or reproduce the content</li>
                <li>Sublicense or transfer rights to others</li>
                <li>Remove any proprietary notices or labels</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7.3 User Content
              </h3>
              <p className="text-gray-700">
                You retain ownership of any content you submit to the Services. By
                submitting content, you grant MyPrivacyTOOL a worldwide,
                non-exclusive, royalty-free license to use, display, and improve
                that content.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                8. Limitations of Liability
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.1 Disclaimer of Warranties
              </h3>
              <p className="text-gray-700">
                THE SERVICES ARE PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
                WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. WE DISCLAIM ALL
                WARRANTIES, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY,
                FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.2 Accuracy of Information
              </h3>
              <p className="text-gray-700">
                While we strive for accuracy, privacy scan results and exposure
                data may not be complete, accurate, or up-to-date. We do not
                guarantee that:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>All of your data exposure will be detected</li>
                <li>All removal requests will succeed</li>
                <li>Data brokers will comply with removal requests</li>
                <li>Results are current or fully comprehensive</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.3 Limitation of Damages
              </h3>
              <p className="text-gray-700">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, MYPRIVACYTOOL SHALL NOT BE
                LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR
                PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE
                SERVICES, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH
                DAMAGES.
              </p>
              <p className="mt-4 text-gray-700">
                IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED THE AMOUNT YOU PAID
                FOR THE SERVICES IN THE 12 MONTHS PRECEDING THE CLAIM.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.4 Third-Party Data
              </h3>
              <p className="text-gray-700">
                Our Services rely on data from third-party sources including data
                brokers and public records. We do not control the accuracy or
                completeness of this data and are not liable for errors or
                omissions in third-party information.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                9. Indemnification
              </h2>
              <p className="text-gray-700">
                You agree to indemnify, defend, and hold harmless MyPrivacyTOOL and
                our officers, directors, employees, and agents from any claims,
                damages, losses, or expenses (including legal fees) arising from
                your use of the Services, your violation of these Terms, or your
                violation of any third-party rights.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                10. Data Privacy & Security
              </h2>
              <p className="text-gray-700">
                Our collection and use of your personal data is governed by our
                Privacy Policy. By using the Services, you consent to our data
                practices as described in our Privacy Policy.
              </p>
              <p className="mt-4 text-gray-700">
                You are responsible for protecting any personal data you input into
                the Services. We use industry-standard security measures, but cannot
                guarantee absolute security.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                11. Availability & Service Changes
              </h2>
              <p className="text-gray-700">
                We strive to maintain 99% uptime for the Services, but do not
                guarantee uninterrupted availability. We may:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Perform maintenance or updates with or without notice</li>
                <li>
                  Temporarily suspend the Services due to technical issues or
                  security concerns
                </li>
                <li>Modify or discontinue features with reasonable notice</li>
                <li>Implement usage limits or throttling</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                12. Termination
              </h2>
              <p className="text-gray-700">
                We may terminate or suspend your account and access to the Services
                immediately, without notice or liability, if you:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700">
                <li>Violate any provision of these Terms</li>
                <li>Engage in fraudulent or illegal activity</li>
                <li>Harass or abuse other users</li>
                <li>Fail to pay for a paid subscription</li>
              </ul>
              <p className="mt-4 text-gray-700">
                Upon termination, your right to use the Services ends immediately.
                We may retain your data as required by law or for legitimate
                business purposes.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                13. Governing Law & Jurisdiction
              </h2>
              <p className="text-gray-700">
                These Terms are governed by and construed in accordance with the
                laws of Hong Kong, without regard to conflict of law principles.
                You agree to submit to the exclusive jurisdiction of the courts of
                Hong Kong for any legal proceedings arising from these Terms or the
                Services.
              </p>
              <p className="mt-4 text-gray-700">
                If you are located in the EU/EEA or a jurisdiction that does not
                allow such jurisdiction clauses, you may pursue claims in your home
                jurisdiction.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                14. Dispute Resolution
              </h2>
              <p className="text-gray-700">
                Before pursuing legal action, we encourage you to contact us at{" "}
                <a
                  href="mailto:support@myprivacytool.io"
                  className="text-blue-600 hover:text-blue-700"
                >
                  support@myprivacytool.io
                </a>{" "}
                to resolve your dispute informally.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                15. Entire Agreement
              </h2>
              <p className="text-gray-700">
                These Terms, along with our Privacy Policy and any other policies
                or guidelines posted on the Services, constitute the entire agreement
                between you and MyPrivacyTOOL regarding the Services and supersede
                all prior agreements and understandings.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                16. Severability
              </h2>
              <p className="text-gray-700">
                If any provision of these Terms is found to be invalid or
                unenforceable, that provision will be severed, and the remaining
                provisions will continue in full effect.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                17. Contact Us
              </h2>
              <p className="text-gray-700">
                If you have questions about these Terms, please contact us:
              </p>
              <div className="mt-4 space-y-2 text-gray-700">
                <p>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:support@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    support@myprivacytool.io
                  </a>
                </p>
                <p>
                  <strong>Mailing Address:</strong>
                  <br />
                  MyPrivacyTOOL Ltd.
                  <br />
                  Hong Kong
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default Terms;
