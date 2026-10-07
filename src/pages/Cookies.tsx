import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

const Cookies = () => {
  return (
    <>
      <Seo {...pageMeta["/cookies"]} path="/cookies" />
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="prose prose-lg max-w-none">
            <h1 className="mb-2 text-4xl font-bold text-foreground">
              Cookie Policy
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Last updated: 30 September 2026
            </p>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                1. What Are Cookies?
              </h2>
              <p className="text-muted-foreground">
                Cookies are small text files that are stored on your device (computer,
                tablet, or mobile phone) when you visit a website. They contain
                information about your browsing activity and preferences. Similar
                technologies include web beacons, pixels, and local storage.
              </p>
              <p className="mt-4 text-muted-foreground">
                We use cookies and similar technologies to recognize your device,
                remember your preferences, and understand how you use our Services.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                2. Types of Cookies We Use
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.1 Essential / Functional Cookies
              </h3>
              <p className="text-muted-foreground">
                These cookies are necessary for the website to function properly.
                They enable basic features like page navigation and access to
                secure areas. These cookies do not track your personal information
                and cannot be disabled.
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Session ID:</strong> Maintains your login session
                </li>
                <li>
                  <strong>CSRF Token:</strong> Protects against cross-site request
                  forgery attacks
                </li>
                <li>
                  <strong>Consent Choice:</strong> Records your cookie choices via
                  our consent manager (Consentmanager) so we do not ask again on
                  every visit
                </li>
                <li>
                  <strong>User Preferences:</strong> Remembers your language and
                  theme settings
                </li>
                <li>
                  <strong>Security Tokens:</strong> Used for authentication and
                  authorization
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.2 Analytics Cookies
              </h3>
              <p className="text-muted-foreground">
                These cookies help us understand how visitors use our website.
                They collect anonymized data about page views, clicks, and user
                flow to help us improve our Services.
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Google Analytics 4:</strong> Tracks aggregated website
                  usage statistics
                </li>
                <li>
                  <strong>HubSpot Tracking Cookie (hubspotutk):</strong> Set when
                  HubSpot tracking is allowed. When you submit a sign-up or
                  waitlist form, it links that submission to your earlier visits
                  to our site so we can see which pages and campaigns led to it
                </li>
                <li>
                  <strong>Campaign Parameters:</strong> UTM parameters in the
                  links you arrive from are attached to sign-up and analytics
                  events
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                We do not use session recording or heatmap tools. The device scan
                on our site asks two third-party services, ipify (api.ipify.org)
                and ipapi.co, for your IP address and approximate location when
                you load the scan. They necessarily see your IP address, and this
                happens whether or not you have accepted analytics cookies,
                because it is how the scan shows you what a website can see.
              </p>
              <p className="mt-4 text-muted-foreground">
                Google Analytics 4 and HubSpot tracking only run after you
                allow analytics in our consent banner. Google Analytics 4 does not
                store full IP addresses. HubSpot tracking can identify you once
                you submit a form with your email address; you can withdraw
                consent at any time through the Cookie Management Center.
              </p>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.3 Marketing / Advertising Cookies
              </h3>
              <p className="text-muted-foreground">
                These cookies track your browsing behavior to show you targeted
                advertisements. They may be set by us or by third-party advertising
                partners.
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Retargeting Pixels:</strong> Show ads on other websites
                  based on your visit
                </li>
                <li>
                  <strong>Conversion Tracking:</strong> Measure the effectiveness
                  of advertising campaigns
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                2.4 Preference Cookies
              </h3>
              <p className="text-muted-foreground">
                These cookies remember choices you've made, such as your language,
                currency, or display preferences, to personalize your experience.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                3. Third-Party Cookies
              </h2>
              <p className="text-muted-foreground">
                We use services from third parties that may set their own cookies:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Google Analytics:</strong> Analytics and website traffic
                  analysis
                </li>
                <li>
                  <strong>Stripe:</strong> Payment processing and fraud prevention
                </li>
                <li>
                  <strong>Social Media Platforms:</strong> Share buttons and social
                  tracking
                </li>
                <li>
                  <strong>Advertising Networks:</strong> Targeted advertising and
                  retargeting
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                These third parties have their own privacy policies. We recommend
                reviewing their cookie and privacy policies to understand their
                practices.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                4. Cookie Duration
              </h2>
              <p className="text-muted-foreground">
                Cookies have different lifespans depending on their purpose:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Session Cookies:</strong> Deleted when you close your
                  browser (essential and some analytics cookies)
                </li>
                <li>
                  <strong>Persistent Cookies:</strong> Remain on your device for a
                  set period, typically 1-2 years (analytics and marketing cookies)
                </li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                5. Cookie Consent & Preferences
              </h2>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                5.1 Consent Model
              </h3>
              <p className="text-muted-foreground">
                When you first visit our website, you will see a cookie banner
                informing you about our use of cookies. We operate on an
                opt-in/opt-out model:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Essential Cookies:</strong> Always enabled (necessary
                  for functionality)
                </li>
                <li>
                  <strong>Analytics & Marketing:</strong> Opt-in required (you must
                  consent)
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                5.2 Managing Your Preferences
              </h3>
              <p className="text-muted-foreground">
                You can manage your cookie preferences in several ways:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Cookie Management Center:</strong> Click "Cookie
                  Settings" at the bottom of any page to update your preferences
                </li>
                <li>
                  <strong>Browser Settings:</strong> Most browsers allow you to
                  block or delete cookies
                </li>
                <li>
                  <strong>Opt-Out Tools:</strong> Use the Network Advertising
                  Initiative (NAI) or Digital Advertising Alliance (DAA) opt-out
                  tools
                </li>
              </ul>

              <h3 className="mt-6 text-xl font-semibold text-foreground">
                5.3 Browser-Level Controls
              </h3>
              <p className="text-muted-foreground">
                Most web browsers provide options to control cookie behavior:
              </p>
              <div className="mt-4 space-y-2 text-muted-foreground">
                <p>
                  <strong>Chrome:</strong> Settings → Privacy and security → Cookies
                  and other site data
                </p>
                <p>
                  <strong>Firefox:</strong> Preferences → Privacy & Security →
                  Cookies and Site Data
                </p>
                <p>
                  <strong>Safari:</strong> Preferences → Privacy → Cookies and
                  website data
                </p>
                <p>
                  <strong>Edge:</strong> Settings → Privacy, search, and services
                  → Clear browsing data
                </p>
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                6. Do Not Track (DNT)
              </h2>
              <p className="text-muted-foreground">
                Some browsers include a "Do Not Track" feature. Currently, there
                is no universal standard for recognizing DNT signals. We do not
                currently respond to DNT signals, but we do provide the cookie
                management tools above to give you control over tracking.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                7. Local Storage & Similar Technologies
              </h2>
              <p className="text-muted-foreground">
                In addition to cookies, we use browser local storage and similar
                technologies to store information on your device:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>
                  <strong>Local Storage:</strong> Stores application data on your
                  device such as your theme preference and results and settings for
                  our on-device analysis tools. This stays in your browser and is
                  not sent to us unless you submit it
                </li>
                <li>
                  <strong>IndexedDB:</strong> Stores larger amounts of data for
                  offline functionality
                </li>
                <li>
                  <strong>Web Beacons & Pixels:</strong> Tiny images used to track
                  page views and email opens
                </li>
              </ul>
              <p className="mt-4 text-muted-foreground">
                These technologies work similarly to cookies and can be managed
                through your browser settings.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                8. Cross-Domain Tracking
              </h2>
              <p className="text-muted-foreground">
                Our cookies may be used to track your behavior across multiple
                domains and services, including partner websites, for marketing
                and analytics purposes. You can limit this through the cookie
                management tools and browser settings above.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                9. Consent for Minors
              </h2>
              <p className="text-muted-foreground">
                Our Services are not intended for individuals under 16 years old.
                We do not knowingly collect cookies from minors without parental
                consent. If we discover a child's data, we will delete it
                immediately.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                10. Cookie Policy Updates
              </h2>
              <p className="text-muted-foreground">
                We may update this Cookie Policy from time to time to reflect
                changes in our practices or legal requirements. We will notify you
                of material changes by posting the updated policy on this page with
                an updated "Last updated" date.
              </p>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                11. GDPR Compliance
              </h2>
              <p className="text-muted-foreground">
                If you are located in the EU/EEA, our use of cookies is governed by
                GDPR. We obtain explicit consent before setting non-essential cookies.
                You have the right to:
              </p>
              <ul className="list-inside list-disc space-y-2 text-muted-foreground mt-4">
                <li>Withdraw your consent at any time</li>
                <li>Request information about cookies we use</li>
                <li>Opt out of specific cookie categories</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2 className="text-2xl font-bold text-foreground">
                12. Contact Us
              </h2>
              <p className="text-muted-foreground">
                If you have questions about our use of cookies, please contact us:
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
              </div>
            </section>

            <section className="mb-12 rounded-lg bg-muted p-6">
              <h3 className="mb-4 text-lg font-semibold text-foreground">
                Quick Reference: Cookie Categories
              </h3>
              <table className="w-full text-sm text-muted-foreground">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left font-semibold">Category</th>
                    <th className="text-left font-semibold">Purpose</th>
                    <th className="text-left font-semibold">Consent Required</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td>Essential</td>
                    <td>Site functionality</td>
                    <td>No</td>
                  </tr>
                  <tr>
                    <td>Analytics</td>
                    <td>Website usage insights</td>
                    <td>Yes</td>
                  </tr>
                  <tr>
                    <td>Marketing</td>
                    <td>Targeted advertising</td>
                    <td>Yes</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </main>
    </>
  );
};

export default Cookies;
