import { Helmet } from "react-helmet";

const DPA = () => {
  return (
    <>
      <Helmet>
        <title>Data Processing Agreement - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="MyPrivacyTOOL Data Processing Agreement (DPA) for organizations and B2B customers."
        />
      </Helmet>
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-gray-900">
              Data Processing Agreement (DPA)
            </h1>
            <p className="mb-8 text-lg text-gray-600">
              For B2B customers and organizations subject to GDPR
            </p>

            <div className="mb-8 rounded-lg bg-blue-50 p-6">
              <p className="text-gray-700">
                This Data Processing Agreement (DPA) is applicable to B2B customers
                and organizations that use MyPrivacyTOOL's services and are subject
                to the General Data Protection Regulation (GDPR) or similar data
                protection laws.
              </p>
              <p className="mt-4 text-gray-700">
                This agreement is supplementary to our Terms of Service and
                Privacy Policy.
              </p>
            </div>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                1. Definitions
              </h2>
              <p className="text-gray-700">For the purposes of this DPA:</p>
              <ul className="list-inside list-disc space-y-3 text-gray-700 mt-4">
                <li>
                  <strong>Controller:</strong> The organization that determines the
                  purposes and means of processing personal data (you, as the
                  customer)
                </li>
                <li>
                  <strong>Processor:</strong> MyPrivacyTOOL, which processes personal
                  data on behalf of the Controller
                </li>
                <li>
                  <strong>Data Subject:</strong> The individual to whom the personal
                  data relates
                </li>
                <li>
                  <strong>Personal Data:</strong> Any information relating to an
                  identified or identifiable natural person
                </li>
                <li>
                  <strong>Processing:</strong> Any operation performed on personal
                  data (collection, storage, use, transmission, deletion, etc.)
                </li>
                <li>
                  <strong>Sub-processor:</strong> Any entity engaged by MyPrivacyTOOL
                  to process personal data on our behalf
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                2. Scope & Applicability
              </h2>
              <p className="text-gray-700">
                This DPA applies to the extent that MyPrivacyTOOL processes personal
                data on your behalf as a data processor under:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  The European Union General Data Protection Regulation (GDPR)
                </li>
                <li>The UK Data Protection Act 2018</li>
                <li>The California Consumer Privacy Act (CCPA)</li>
                <li>Hong Kong Personal Data (Privacy) Ordinance (PDPO)</li>
                <li>Singapore Personal Data Protection Act (PDPA)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                3. Your Responsibilities as Controller
              </h2>
              <p className="text-gray-700">
                As the data controller, you are responsible for:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  Determining the purposes and means of processing personal data
                </li>
                <li>
                  Obtaining lawful basis for processing (consent, contract,
                  legitimate interest, etc.)
                </li>
                <li>
                  Ensuring that data subjects are notified about how their data is
                  processed
                </li>
                <li>Honoring data subjects' rights (access, deletion, portability)</li>
                <li>Maintaining records of processing activities</li>
                <li>
                  Conducting Data Protection Impact Assessments (DPIA) where
                  necessary
                </li>
                <li>
                  Ensuring that sub-processors comply with data protection laws
                </li>
                <li>
                  Ensuring that third-party contractors and sub-processors sign
                  equivalent data processing agreements
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                4. MyPrivacyTOOL's Responsibilities as Processor
              </h2>
              <p className="text-gray-700">
                As a data processor, MyPrivacyTOOL commits to:
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.1 Processing Only as Directed
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL will process personal data only in accordance with
                your written instructions, unless processing is required by
                applicable law or regulation.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.2 Personnel Confidentiality
              </h3>
              <p className="text-gray-700">
                All MyPrivacyTOOL employees and contractors who have access to
                personal data are bound by written confidentiality obligations.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.3 Data Security
              </h3>
              <p className="text-gray-700">
                We implement appropriate technical and organizational security
                measures to protect personal data, including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Encryption of data in transit and at rest</li>
                <li>
                  Role-based access control and authentication mechanisms
                </li>
                <li>Regular security audits and penetration testing</li>
                <li>Employee data protection training</li>
                <li>Incident response and breach notification procedures</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.4 Sub-processors
              </h3>
              <p className="text-gray-700">
                We may engage sub-processors for specific functions (e.g., cloud
                hosting, analytics, payment processing). We maintain a list of
                current sub-processors and notify you of any changes.
              </p>
              <p className="mt-4 text-gray-700">
                You have the right to object to any new sub-processor. We will
                provide at least 30 days' notice before engaging a new
                sub-processor.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.5 Data Subject Rights
              </h3>
              <p className="text-gray-700">
                Upon your request, we will assist you in fulfilling data subjects'
                rights, including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Right of access (GDPR Article 15)</li>
                <li>Right to rectification (GDPR Article 16)</li>
                <li>Right to erasure (GDPR Article 17)</li>
                <li>Right to restrict processing (GDPR Article 18)</li>
                <li>Right to data portability (GDPR Article 20)</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.6 Assistance with Compliance
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL will assist you with:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Conducting Data Protection Impact Assessments (DPIA)</li>
                <li>Responding to data subject requests</li>
                <li>Notifying authorities in case of data breaches</li>
                <li>
                  Providing documentation and evidence of our compliance with
                  applicable law
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                4.7 Auditing & Monitoring
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL will maintain records of processing activities and
                provide you with reasonable access to information necessary to
                verify our compliance with this DPA.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                5. Data Transfers
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                5.1 International Data Transfers
              </h3>
              <p className="text-gray-700">
                Personal data may be transferred to and processed in countries
                outside the EEA, UK, or your jurisdiction. We ensure such transfers
                are lawful by implementing:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Standard Contractual Clauses (SCCs)</li>
                <li>Binding Corporate Rules (BCRs)</li>
                <li>Adequacy decisions issued by regulators</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                5.2 Transfers to Sub-processors
              </h3>
              <p className="text-gray-700">
                When we engage sub-processors in third countries, we ensure they
                are subject to appropriate safeguards and that equivalent data
                processing agreements are in place.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                6. Data Breach Notification
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.1 Breach Response
              </h3>
              <p className="text-gray-700">
                In the event of a personal data breach, MyPrivacyTOOL will:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  Notify you without undue delay (within 48 hours of discovering
                  the breach)
                </li>
                <li>Provide details of the breach (what data, when, who)</li>
                <li>
                  Assist you in notifying affected data subjects and relevant
                  authorities
                </li>
                <li>Cooperate with investigations and remediation efforts</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                6.2 Cooperation
              </h3>
              <p className="text-gray-700">
                You are responsible for notifying affected individuals and
                regulatory authorities. We will provide all necessary assistance.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                7. Data Retention & Deletion
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7.1 Retention Period
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL will retain personal data only for as long as
                necessary to provide the services. Unless you specify a different
                retention period:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  We retain data for the duration of your subscription plus 30 days
                </li>
                <li>
                  After the retention period, data is deleted or anonymized
                </li>
                <li>
                  Exceptions: data retained to comply with legal obligations
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                7.2 Deletion Upon Request
              </h3>
              <p className="text-gray-700">
                Upon your request or termination of our agreement, we will delete
                or return all personal data, except where retention is required by
                law.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                8. Audit & Verification
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.1 Audit Rights
              </h3>
              <p className="text-gray-700">
                You have the right to audit our processing of your personal data.
                We will:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  Provide evidence of our compliance with this DPA upon request
                </li>
                <li>Allow you to conduct an audit, with reasonable notice</li>
                <li>
                  Provide access to relevant systems and documentation (subject to
                  confidentiality and security constraints)
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                8.2 Certification
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL maintains industry certifications and standards,
                including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>ISO 27001 (Information Security Management)</li>
                <li>SOC 2 Type II (Security and Availability)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                9. Liability & Limitation
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                9.1 Liability Caps
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL's liability for data processing violations is limited
                to the amount you paid for the services in the 12 months preceding
                the claim.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                9.2 Indemnification
              </h3>
              <p className="text-gray-700">
                You indemnify MyPrivacyTOOL against claims arising from your
                processing instructions, use of the services in violation of law,
                or failure to comply with your own data protection obligations.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                10. Amendments & Updates
              </h2>
              <p className="text-gray-700">
                We may amend this DPA to reflect changes in law or our practices.
                We will notify you of material changes 30 days in advance. Your
                continued use of the services constitutes acceptance of the updated
                DPA.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                11. Termination
              </h2>
              <p className="text-gray-700">
                This DPA terminates when your service agreement with MyPrivacyTOOL
                ends. Upon termination:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>We will delete or return your personal data</li>
                <li>We will cease all processing of your data</li>
                <li>
                  Exceptions: where we are legally required to retain the data
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                12. Sub-processors List
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL currently uses the following sub-processors:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Amazon Web Services (AWS):</strong> Cloud hosting and data
                  storage
                </li>
                <li>
                  <strong>Stripe:</strong> Payment processing and billing
                </li>
                <li>
                  <strong>Google Analytics:</strong> Website analytics and
                  performance monitoring
                </li>
                <li>
                  <strong>SendGrid:</strong> Email delivery and notifications
                </li>
                <li>
                  <strong>Auth0:</strong> Identity and access management
                </li>
              </ul>
              <p className="mt-4 text-gray-700">
                A complete and current list of sub-processors is available at{" "}
                <a
                  href="/sub-processors"
                  className="text-blue-600 hover:text-blue-700"
                >
                  /sub-processors
                </a>
                .
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                13. Contact & Inquiries
              </h2>
              <p className="text-gray-700">
                For questions about this DPA or to discuss your data processing
                requirements:
              </p>
              <div className="mt-4 space-y-2 text-gray-700">
                <p>
                  <strong>Email:</strong>{" "}
                  <a
                    href="mailto:legal@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    legal@myprivacytool.io
                  </a>
                </p>
                <p>
                  <strong>Data Protection Officer:</strong>{" "}
                  <a
                    href="mailto:dpo@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    dpo@myprivacytool.io
                  </a>
                </p>
              </div>
            </section>

            <section className="mb-12 rounded-lg bg-green-50 p-6">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                Commitment to Data Protection
              </h3>
              <p className="text-gray-700">
                MyPrivacyTOOL is committed to protecting the personal data we
                process on your behalf. This DPA reflects our adherence to the
                highest standards of data protection and privacy compliance.
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default DPA;
