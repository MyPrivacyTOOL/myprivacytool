import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Helmet } from "react-helmet-async";

const GDPRRights = () => {
  return (
    <>
      <Helmet>
        <title>GDPR Rights Request - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="Exercise your GDPR rights with MyPrivacyTOOL. Access, correct, delete, or export your personal data."
        />
      </Helmet>
      <Header />
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-gray-900">
              GDPR Rights & Data Subject Requests
            </h1>
            <p className="mb-8 text-lg text-gray-600">
              How to exercise your rights under the General Data Protection
              Regulation (GDPR)
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Introduction to GDPR
              </h2>
              <p className="text-gray-700">
                The General Data Protection Regulation (GDPR) is a European Union
                regulation that applies to all organizations processing the
                personal data of EU/EEA residents, regardless of where the
                organization is located.
              </p>
              <p className="mt-4 text-gray-700">
                Under GDPR, you have specific rights regarding your personal data.
                MyPrivacyTOOL respects these rights and has established processes
                to help you exercise them.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Your GDPR Rights
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                1. Right of Access (Article 15)
              </h3>
              <p className="text-gray-700">
                You have the right to obtain a copy of all personal data we hold
                about you in a structured, commonly used, and machine-readable
                format.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>What you'll receive: A complete report of your data</li>
                <li>Response time: Within 30 days of your request</li>
                <li>Cost: Free of charge</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                2. Right to Rectification (Article 16)
              </h3>
              <p className="text-gray-700">
                You have the right to request correction of inaccurate or
                incomplete personal data we hold about you.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Examples: Wrong email, incorrect address, outdated information</li>
                <li>Response time: Within 30 days of your request</li>
                <li>Cost: Free of charge</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                3. Right to Erasure (Article 17) — "Right to be Forgotten"
              </h3>
              <p className="text-gray-700">
                You have the right to request deletion of your personal data under
                certain circumstances.
              </p>
              <p className="mt-4 text-gray-700 font-semibold">
                You can request deletion when:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Your data is no longer necessary for the purpose collected</li>
                <li>You withdraw your consent</li>
                <li>
                  You object to processing and we have no overriding legitimate
                  interest
                </li>
                <li>Your data was processed unlawfully</li>
                <li>Deletion is required by law</li>
              </ul>
              <p className="mt-4 text-gray-700 font-semibold">
                Exceptions (we may not delete):
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>To comply with legal obligations (e.g., tax records)</li>
                <li>To establish, exercise, or defend legal claims</li>
                <li>For public interest purposes</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4. Right to Restrict Processing (Article 18)
              </h3>
              <p className="text-gray-700">
                You can request that we limit how we use your personal data while
                a dispute about its accuracy is resolved, or while your erasure
                request is being considered.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  Effect: We will continue to store your data but not actively
                  process it
                </li>
                <li>Response time: Within 30 days</li>
                <li>Cost: Free</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                5. Right to Data Portability (Article 20)
              </h3>
              <p className="text-gray-700">
                You have the right to receive a copy of your personal data in a
                structured, commonly used, and machine-readable format and to
                transmit it to another organization.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>What you'll get: Your data in CSV, JSON, or similar format</li>
                <li>Response time: Within 30 days</li>
                <li>Cost: Free unless the request is repetitive</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6. Right to Object (Article 21)
              </h3>
              <p className="text-gray-700">
                You have the right to object to our processing of your personal
                data, particularly for direct marketing and automated decision-making.
              </p>
              <p className="mt-4 text-gray-700 font-semibold">
                You can object to:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Marketing emails and communications</li>
                <li>Profiling for marketing purposes</li>
                <li>Processing based on legitimate interests</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7. Rights Related to Automated Decision-Making (Article 22)
              </h3>
              <p className="text-gray-700">
                You have the right not to be subject to decisions based solely on
                automated processing that produces legal or similarly significant
                effects.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Right to explanation: Request why an automated decision was made</li>
                <li>Right to contest: Challenge an automated decision</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8. Right to Withdraw Consent (Article 7)
              </h3>
              <p className="text-gray-700">
                If we process your data based on your consent, you can withdraw
                that consent at any time.
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Examples: Marketing emails, analytics tracking</li>
                <li>Effect: We will stop processing after your withdrawal</li>
                <li>
                  Note: Withdrawal does not affect lawfulness of prior processing
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                How to Submit a Data Subject Request
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Step 1: Prepare Your Request
              </h3>
              <p className="text-gray-700">
                Clearly specify which right you want to exercise:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Right of access</li>
                <li>Right to rectification</li>
                <li>Right to erasure</li>
                <li>Right to restrict processing</li>
                <li>Right to portability</li>
                <li>Right to object</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Step 2: Submit Your Request
              </h3>
              <p className="text-gray-700">Send your request to:</p>
              <div className="mt-4 rounded-lg bg-gray-100 p-6">
                <p className="font-semibold text-gray-900">Email:</p>
                <p className="text-gray-700">
                  <a
                    href="mailto:privacy@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    privacy@myprivacytool.io
                  </a>
                </p>
                <p className="mt-4 font-semibold text-gray-900">Subject line:</p>
                <p className="text-gray-700">
                  "GDPR Data Subject Request - [Your Name]"
                </p>
              </div>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Step 3: Verify Your Identity
              </h3>
              <p className="text-gray-700">
                To protect your privacy, we may ask for identification. This helps
                us ensure the request comes from you or an authorized representative.
                We accept:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>A copy of your ID (we will not store it)</li>
                <li>Information matching our records</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Step 4: Receive Your Response
              </h3>
              <p className="text-gray-700">
                We will respond within 30 days of receiving your complete request.
                If additional time is needed, we will notify you and provide an
                estimated date.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                What We Need in Your Request
              </h2>
              <p className="text-gray-700">
                To process your request quickly, please include:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Your full name</li>
                <li>Email address associated with your account</li>
                <li>Phone number (optional but helpful)</li>
                <li>Clear description of your request</li>
                <li>Which right you are exercising (if applicable)</li>
                <li>Preferred format for your data (CSV, PDF, JSON, etc.)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Response Times & Costs
              </h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm text-gray-700 border border-gray-300">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="border border-gray-300 px-4 py-2 text-left">
                        Right
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-left">
                        Response Time
                      </th>
                      <th className="border border-gray-300 px-4 py-2 text-left">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-300 px-4 py-2">
                        Right of Access
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2">
                        Right to Rectification
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-300 px-4 py-2">
                        Right to Erasure
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2">
                        Right to Restrict
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-300 px-4 py-2">
                        Right to Portability
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                    <tr className="bg-gray-50">
                      <td className="border border-gray-300 px-4 py-2">
                        Right to Object
                      </td>
                      <td className="border border-gray-300 px-4 py-2">
                        30 days
                      </td>
                      <td className="border border-gray-300 px-4 py-2">Free</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Extensions & Delays
              </h2>
              <p className="text-gray-700">
                In complex cases, we may extend our response time by up to two
                additional months. We will notify you of any extension and explain
                why it is necessary.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Data Protection Officer
              </h2>
              <p className="text-gray-700">
                We have appointed a Data Protection Officer (DPO) to oversee our
                compliance with GDPR. You can contact our DPO at:
              </p>
              <div className="mt-4 rounded-lg bg-gray-100 p-6">
                <p>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:dpo@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    dpo@myprivacytool.io
                  </a>
                </p>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Filing a Complaint
              </h2>
              <p className="text-gray-700">
                If you believe we have violated your GDPR rights, you have the right
                to lodge a complaint with your local data protection authority. For
                EU/UK residents, this includes:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>United Kingdom:</strong> Information Commissioner's Office
                  (ICO) - www.ico.org.uk
                </li>
                <li>
                  <strong>European Union:</strong> Your country's Data Protection
                  Authority
                </li>
              </ul>
              <p className="mt-4 text-gray-700">
                However, we encourage you to contact us first so we can address
                your concerns directly.
              </p>
            </section>

            <section className="mb-12 rounded-lg bg-green-50 p-6">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                You Have Rights
              </h3>
              <p className="text-gray-700">
                These rights are fundamental protections under GDPR. We are
                committed to honoring your requests and making it easy for you to
                exercise your privacy rights. If you have any questions about these
                rights or how to exercise them, please contact us.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default GDPRRights;
