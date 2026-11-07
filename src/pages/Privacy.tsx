import React from 'react';
import { Container } from '../components/Container';
import { SITE_CONFIG } from '../config';

export const Privacy = () => {
  return (
    <Container>
      <div className="prose prose-sm max-w-4xl mx-auto py-12">
        <h1>Privacy Policy</h1>
        <p className="text-sm text-gray-600 mb-6">
          Effective Date: {SITE_CONFIG.legalDates.privacyEffective}
        </p>

        <section className="mb-8">
          <h2>1. Introduction</h2>
          <p>
            At MyPrivacyTOOL, we respect your privacy. This Privacy Policy explains how we collect,
            use, disclose, and otherwise process personal information in connection with our website
            (myprivacytool.io) and services.
          </p>
        </section>

        <section className="mb-8">
          <h2>2. Information We Collect</h2>
          <p>We collect information in the following ways:</p>
          
          <h3>2.1 Information You Provide Directly</h3>
          <ul>
            <li><strong>Email address</strong>: Collected when you sign up for our free exposure scan or subscribe to a paid plan.</li>
            <li><strong>Scan results</strong>: Data exposure information you elect to review and manage within our platform.</li>
            <li><strong>Contact information</strong>: Name, email, phone number (optional) if you contact our support team.</li>
          </ul>

          <h3>2.2 Information Collected Automatically</h3>
          <ul>
            <li><strong>Usage data</strong>: Pages visited, features used, time spent, and interactions within the platform (via Google Analytics 4).</li>
            <li><strong>Device information</strong>: Browser type, operating system, device type, and unique identifiers.</li>
            <li><strong>Cookie data</strong>: Functional, analytical, and marketing cookies as described in our Cookies Policy.</li>
          </ul>

          <h3>2.3 Information NOT Collected</h3>
          <p>
            We do <strong>not</strong> collect your IP address via third-party geolocation services. We do not store or process your passwords,
            financial account credentials, or the full contents of data breaches.
          </p>
        </section>

        <section className="mb-8">
          <h2>3. How We Use Your Information</h2>
          <ul>
            <li><strong>Service delivery</strong>: Providing your exposure scan, results, and platform access.</li>
            <li><strong>Communication</strong>: Sending scan results, account notifications, and support responses.</li>
            <li><strong>Analytics</strong>: Understanding user behavior and improving the product (Google Analytics 4).</li>
            <li><strong>Marketing</strong>: Sending opt-in newsletters and product updates (with consent).</li>
            <li><strong>Legal compliance</strong>: Enforcing our Terms of Service and protecting against fraud.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2>4. Data Retention</h2>
          <ul>
            <li><strong>Scan results</strong>: Retained for your account lifetime; deleted upon request or account closure.</li>
            <li><strong>Usage logs</strong>: Retained for 13 months for analytics and support purposes.</li>
            <li><strong>Support records</strong>: Retained for 12 months after closure for service quality and legal compliance.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2>5. Third-Party Services</h2>
          <p>We use the following third-party service providers:</p>
          <ul>
            <li><strong>Google Analytics 4</strong>: For website usage analytics and anonymized user behavior.</li>
            <li><strong>HubSpot</strong>: For email delivery and lead management (contact information only).</li>
            <li><strong>Supabase</strong>: For secure data storage and user authentication.</li>
            <li><strong>Cloudflare</strong>: For website security and performance (edge caching, DDoS protection).</li>
          </ul>
          <p>
            Each third-party service provider has its own privacy policy. We recommend reviewing their policies at their respective websites.
            We do not share your personal information with third parties for their direct marketing purposes without your consent.
          </p>
        </section>

        <section className="mb-8">
          <h2>6. Your Rights</h2>
          <p>
            Depending on your location, you may have the right to access, correct, delete, or port your personal information.
            For GDPR (EU), CCPA (California), and PDPO (Hong Kong) rights requests, contact us at {SITE_CONFIG.contactEmail}.
          </p>
          <p>
            We will respond to verified requests within 30 days or as required by applicable law.
          </p>
        </section>

        <section className="mb-8">
          <h2>7. Security</h2>
          <p>
            We use industry-standard encryption (TLS 1.2+) and secure authentication (Supabase Auth) to protect your data.
            However, no method of transmission over the internet is 100% secure. We encourage you to use a strong password and report
            any security concerns to {SITE_CONFIG.contactEmail}.
          </p>
        </section>

        <section className="mb-8">
          <h2>8. International Data Transfers</h2>
          <p>
            Your data may be processed in multiple jurisdictions, including the United States, Singapore, and Hong Kong.
            By using our service, you consent to these transfers. We comply with applicable data protection laws.
          </p>
        </section>

        <section className="mb-8">
          <h2>9. Children's Privacy</h2>
          <p>
            Our service is not intended for children under 13. We do not knowingly collect information from children.
            If we become aware of such collection, we will delete the information and terminate the account.
          </p>
        </section>

        <section className="mb-8">
          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The "Effective Date" above indicates when the policy was last changed.
            Your continued use of the service constitutes acceptance of the updated policy.
          </p>
        </section>

        <section className="mb-8">
          <h2>11. Contact Us</h2>
          <p>
            Questions about this Privacy Policy? Contact us at {SITE_CONFIG.contactEmail} or visit our support center.
          </p>
        </section>
      </div>
    </Container>
  );
};

export default Privacy;
