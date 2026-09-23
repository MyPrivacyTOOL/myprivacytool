import { Helmet } from "react-helmet";

const Accessibility = () => {
  return (
    <>
      <Helmet>
        <title>Accessibility Statement - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="MyPrivacyTOOL accessibility statement. Learn about our commitment to digital accessibility and WCAG 2.1 compliance."
        />
      </Helmet>
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-gray-900">
              Accessibility Statement
            </h1>
            <p className="mb-8 text-lg text-gray-600">
              MyPrivacyTOOL's commitment to digital accessibility and inclusive design
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Commitment to Accessibility
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL is committed to providing a digital experience that is
                accessible to everyone, regardless of ability or disability. We
                believe that digital accessibility is a fundamental right and an
                essential part of building an inclusive online experience.
              </p>
              <p className="mt-4 text-gray-700">
                Our goal is to ensure that all users, including those with visual,
                hearing, motor, or cognitive disabilities, can navigate and interact
                with our website and services effectively.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Standards & Compliance
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL aims to comply with the Web Content Accessibility
                Guidelines (WCAG) 2.1 Level AA standard. This is the most widely
                recognized international standard for web accessibility.
              </p>
              <p className="mt-4 text-gray-700 font-semibold">
                What WCAG 2.1 Level AA means:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Perceivable:</strong> Information and user interface
                  components are presented in a way that users can perceive them
                </li>
                <li>
                  <strong>Operable:</strong> Users can navigate and interact with
                  the website using keyboard, mouse, and assistive technologies
                </li>
                <li>
                  <strong>Understandable:</strong> Content and interface are clear,
                  easy to understand, and predictable
                </li>
                <li>
                  <strong>Robust:</strong> The website is compatible with current
                  and future assistive technologies
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Accessibility Features
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Visual Accessibility
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>High Contrast Modes:</strong> Support for high-contrast
                  color schemes for users with low vision
                </li>
                <li>
                  <strong>Readable Text:</strong> Clear typography with sufficient
                  font sizes and line spacing
                </li>
                <li>
                  <strong>Alt Text for Images:</strong> Descriptive alt text for
                  all meaningful images
                </li>
                <li>
                  <strong>Color Independence:</strong> Information is not conveyed
                  by color alone
                </li>
                <li>
                  <strong>Text Scaling:</strong> Users can increase text size up to
                  200% without loss of functionality
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Keyboard Navigation
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Full Keyboard Access:</strong> All functionality is
                  available from the keyboard
                </li>
                <li>
                  <strong>Visible Focus Indicators:</strong> Clear visual indication
                  of which element has keyboard focus
                </li>
                <li>
                  <strong>Tab Order:</strong> Logical tab order through interactive
                  elements
                </li>
                <li>
                  <strong>Skip Navigation Links:</strong> Links to skip repeated
                  content blocks
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Screen Reader Compatibility
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Semantic HTML:</strong> Proper use of heading, list, and
                  landmark elements
                </li>
                <li>
                  <strong>ARIA Labels:</strong> Descriptive labels for interactive
                  elements
                </li>
                <li>
                  <strong>Form Labels:</strong> Every form field has an associated
                  label
                </li>
                <li>
                  <strong>Status Messages:</strong> Dynamic content updates are
                  announced to screen readers
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Hearing Accessibility
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Captions & Transcripts:</strong> Video content includes
                  captions and transcripts
                </li>
                <li>
                  <strong>Visual Indicators:</strong> Audio notifications have
                  visual equivalents
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Motor & Physical Accessibility
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Large Click Targets:</strong> Buttons and links are at
                  least 44x44 CSS pixels
                </li>
                <li>
                  <strong>Sufficient Spacing:</strong> Adequate spacing between
                  interactive elements to prevent accidental clicks
                </li>
                <li>
                  <strong>Gesture Support:</strong> Alternatives to complex
                  multi-touch gestures
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Cognitive Accessibility
              </h3>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Clear Language:</strong> Simple, direct language avoiding
                  jargon
                </li>
                <li>
                  <strong>Consistent Navigation:</strong> Consistent layout and
                  navigation patterns
                </li>
                <li>
                  <strong>Undo Functionality:</strong> Ability to undo recent
                  actions
                </li>
                <li>
                  <strong>Clear Instructions:</strong> Help text and instructions
                  are clear and easy to understand
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Accessibility Across Services
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Website & Application
              </h3>
              <p className="text-gray-700">
                Our website and user application are designed with accessibility as
                a core principle. We continuously test with assistive technologies
                and accessibility tools.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Documents & Downloads
              </h3>
              <p className="text-gray-700">
                All downloadable documents (PDFs, guides, etc.) are created with
                accessibility in mind, including:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Tagged PDF structure for screen reader navigation</li>
                <li>Alternative text descriptions for images and diagrams</li>
                <li>Proper heading hierarchy</li>
                <li>Accessible color contrasts</li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-gray-800">
                Video Content
              </h3>
              <p className="text-gray-700">
                All video content includes:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Closed captions (CC) for all dialogue and sound effects</li>
                <li>Detailed audio descriptions for visual content</li>
                <li>Transcripts of all video content</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Known Limitations
              </h2>
              <p className="text-gray-700">
                While we strive for full accessibility, some areas may have
                limitations:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>
                  <strong>Third-Party Content:</strong> Embedded third-party
                  content (e.g., social media widgets) may not meet our
                  accessibility standards
                </li>
                <li>
                  <strong>Legacy Documents:</strong> Some older documents may not
                  yet meet WCAG 2.1 AA standards; we are working to update these
                </li>
                <li>
                  <strong>Real-Time Features:</strong> Live chat or real-time
                  collaborative features may have accessibility limitations
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Testing & Evaluation
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL regularly tests our website and services for
                accessibility using:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Automated accessibility testing tools</li>
                <li>Manual testing with actual assistive technologies</li>
                <li>User testing with people with disabilities</li>
                <li>Third-party accessibility audits</li>
              </ul>
              <p className="mt-4 text-gray-700">
                We conduct accessibility reviews regularly to identify and fix any
                issues.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Browser & Assistive Technology Support
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL is tested with and supports the following:
              </p>
              <p className="mt-4 text-gray-700 font-semibold">
                Browsers:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Chrome (latest)</li>
                <li>Firefox (latest)</li>
                <li>Safari (latest)</li>
                <li>Edge (latest)</li>
              </ul>
              <p className="mt-4 text-gray-700 font-semibold">
                Assistive Technologies:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>NVDA (Windows screen reader)</li>
                <li>JAWS (Windows screen reader)</li>
                <li>VoiceOver (Mac/iOS screen reader)</li>
                <li>TalkBack (Android screen reader)</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Feedback & Accessibility Issues
              </h2>
              <p className="text-gray-700">
                If you encounter any accessibility barriers or issues while using
                MyPrivacyTOOL, please let us know. We take accessibility seriously
                and want to fix any problems.
              </p>
              <p className="mt-4 text-gray-700">
                To report an accessibility issue:
              </p>
              <div className="mt-4 rounded-lg bg-gray-100 p-6">
                <p className="font-semibold text-gray-900">
                  Accessibility Support Email:
                </p>
                <p className="text-gray-700 mt-2">
                  <a
                    href="mailto:accessibility@myprivacytool.io"
                    className="text-blue-600 hover:text-blue-700"
                  >
                    accessibility@myprivacytool.io
                  </a>
                </p>
                <p className="text-gray-700 mt-4">
                  Please include:
                </p>
                <ul className="list-inside list-disc space-y-2 text-gray-700 mt-2">
                  <li>A description of the accessibility issue</li>
                  <li>The page or feature where the issue occurs</li>
                  <li>Your browser and operating system</li>
                  <li>Assistive technology you are using (if applicable)</li>
                  <li>Steps to reproduce the issue</li>
                </ul>
              </div>
              <p className="mt-6 text-gray-700">
                We aim to respond to accessibility reports within 48 hours and will
                work with you to find a solution.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Accessibility Resources & Tools
              </h2>
              <p className="text-gray-700">
                Here are some tools and resources to help you use the web more
                accessibly:
              </p>
              <ul className="list-inside list-disc space-y-3 text-gray-700 mt-4">
                <li>
                  <strong>WebAIM Contrast Checker:</strong> Check color contrast
                  ratios (webaim.org/resources/contrastchecker/)
                </li>
                <li>
                  <strong>WAVE:</strong> Browser extension for web accessibility
                  evaluation (wave.webaim.org)
                </li>
                <li>
                  <strong>NVDA:</strong> Free open-source screen reader for Windows
                  (nvaccess.org)
                </li>
                <li>
                  <strong>WCAG 2.1 Guidelines:</strong> Complete accessibility
                  standards (w3.org/WAI/WCAG21/quickref/)
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Our Accessibility Team
              </h2>
              <p className="text-gray-700">
                MyPrivacyTOOL has a dedicated team committed to accessibility:
              </p>
              <ul className="list-inside list-disc space-y-2 text-gray-700 mt-4">
                <li>Product team trained in accessibility best practices</li>
                <li>
                  Regular accessibility audits by third-party specialists
                </li>
                <li>Accessibility documentation and guidelines</li>
                <li>Continuous improvement processes</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-gray-900">
                Accessibility Statement Updates
              </h2>
              <p className="text-gray-700">
                This accessibility statement is reviewed and updated regularly. The
                last update was in September 2026.
              </p>
              <p className="mt-4 text-gray-700">
                As we make improvements to our website and services, we will update
                this statement to reflect our progress.
              </p>
            </section>

            <section className="mb-12 rounded-lg bg-purple-50 p-6">
              <h3 className="mb-4 text-lg font-semibold text-gray-900">
                We're Committed to Inclusion
              </h3>
              <p className="text-gray-700">
                Digital accessibility is not a feature — it's a foundation. We
                believe everyone deserves equal access to our services, and we're
                committed to continuously improving our digital experience for all
                users.
              </p>
              <p className="mt-4 text-gray-700">
                If you have any accessibility concerns or suggestions, we'd love to
                hear from you. Please contact our accessibility team at{" "}
                <a
                  href="mailto:accessibility@myprivacytool.io"
                  className="text-blue-600 hover:text-blue-700"
                >
                  accessibility@myprivacytool.io
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default Accessibility;
