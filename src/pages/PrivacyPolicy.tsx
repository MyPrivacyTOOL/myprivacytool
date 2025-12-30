import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import logoHeader from '@/assets/logo-header.png';
import logoFooter from '@/assets/logo-footer.png';

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navbar */}
      <nav className="bg-white">
        <div className="container mx-auto px-4 flex items-center justify-center">
          <Link to="/" className="flex items-center -my-10">
            <img src={logoHeader} alt="MyPrivacyTOOL.IO" className="h-40 md:h-48 object-contain" />
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <Link to="/" className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <h1 className="text-4xl font-bold mb-8 text-green-400" style={{ textShadow: '0 0 10px rgba(0, 255, 65, 0.5)' }}>
          Privacy Policy
        </h1>

        <div className="prose prose-invert prose-green max-w-none space-y-8">
          <p className="text-lg text-gray-300">
            Last updated: January 2025
          </p>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">1. Introduction</h2>
            <p className="text-gray-300 leading-relaxed">
              MyPrivacyTOOL.IO ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you visit our website. We are committed to GDPR compliance and respect your data protection rights.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">2. Information We Collect</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              <strong className="text-white">Important:</strong> Our privacy scanning tool runs entirely in your browser. We do NOT store, transmit, or collect any of the device information displayed in the hexagons.
            </p>
            <p className="text-gray-300 leading-relaxed">
              The only information we may collect includes:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mt-2">
              <li>Anonymous usage analytics (via Google Analytics) to understand how visitors interact with our site</li>
              <li>Cookies necessary for consent management and analytics</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">3. How Our Tool Works</h2>
            <p className="text-gray-300 leading-relaxed">
              Our digital shadow scanner operates entirely client-side. This means:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mt-2">
              <li>All device detection happens in your browser</li>
              <li>No personal data is sent to our servers</li>
              <li>No data is stored after you leave the page</li>
              <li>The information shown is only visible to you</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">4. Cookies and Tracking</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              We use cookies for:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2">
              <li><strong className="text-white">Essential cookies:</strong> Required for consent management</li>
              <li><strong className="text-white">Analytics cookies:</strong> Google Analytics to understand site usage (only with your consent)</li>
            </ul>
            <p className="text-gray-300 leading-relaxed mt-4">
              You can manage your cookie preferences at any time using the cookie consent banner.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">5. Your GDPR Rights</h2>
            <p className="text-gray-300 leading-relaxed mb-4">
              Under the General Data Protection Regulation (GDPR), you have the following rights:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2">
              <li><strong className="text-white">Right to Access:</strong> Request a copy of any personal data we hold about you</li>
              <li><strong className="text-white">Right to Rectification:</strong> Request correction of inaccurate personal data</li>
              <li><strong className="text-white">Right to Erasure:</strong> Request deletion of your personal data</li>
              <li><strong className="text-white">Right to Restrict Processing:</strong> Request limitation of how we use your data</li>
              <li><strong className="text-white">Right to Data Portability:</strong> Receive your data in a structured, machine-readable format</li>
              <li><strong className="text-white">Right to Object:</strong> Object to processing of your personal data</li>
              <li><strong className="text-white">Right to Withdraw Consent:</strong> Withdraw consent at any time where processing is based on consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">6. Data Security</h2>
            <p className="text-gray-300 leading-relaxed">
              We implement appropriate technical and organizational measures to protect any data we process. Since our tool processes data locally in your browser, your device information never leaves your computer.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">7. Third-Party Services</h2>
            <p className="text-gray-300 leading-relaxed">
              We use the following third-party services:
            </p>
            <ul className="list-disc list-inside text-gray-300 space-y-2 mt-2">
              <li><strong className="text-white">Google Analytics:</strong> For anonymous usage statistics (with consent)</li>
              <li><strong className="text-white">ConsentManager:</strong> For cookie consent management</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">8. Children's Privacy</h2>
            <p className="text-gray-300 leading-relaxed">
              Our service is not directed to individuals under the age of 16. We do not knowingly collect personal information from children.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">9. Changes to This Policy</h2>
            <p className="text-gray-300 leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-green-400 mb-4">10. Contact Us</h2>
            <p className="text-gray-300 leading-relaxed">
              If you have any questions about this Privacy Policy or wish to exercise your GDPR rights, please contact us through our social media channels or visit our website.
            </p>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 mt-12 bg-white">
        <div className="container mx-auto px-4 text-center">
          <img src={logoFooter} alt="MyPrivacyTOOL.IO" className="h-20 object-contain mx-auto mb-3" />
          <p className="text-gray-600 text-xs">
            © 2025 MyPrivacyTOOL.IO • Protecting Your Digital Privacy
          </p>
        </div>
      </footer>
    </div>
  );
};

export default PrivacyPolicy;
