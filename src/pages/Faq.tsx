import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";

// Every answer here is limited to what the code does (src/lib/deviceDetection.ts, EmailCaptureModal.tsx,
// index.html). Encryption, retention and audit claims are deliberately absent: see the MPC-6545 PR notes.
const FAQS: { q: string; a: string }[] = [
  {
    q: "What is MyPrivacyTOOL?",
    a: "MyPrivacyTOOL shows you your digital shadow: the information your browser and device reveal to the websites you visit, presented as Privacy Hexagons and a risk score.",
  },
  {
    q: "How does the scan work?",
    a: "When you run the scan, your browser checks the characteristics it exposes, such as device, browser, screen, storage and settings. Each Privacy Hexagon is one category of information, and it lights up when something is detected. The more that light up, the larger your digital shadow.",
  },
  {
    q: "Does the scan send my results to your servers?",
    a: "The detection runs in your browser and the results are shown to you there. The scan code does not send them to a server we operate. Separately, where your cookie choices allow analytics, the site reports a summary of the scan to Google Analytics 4: device type, operating system, browser, approximate city and country, ISP, screen resolution, timezone and which hexagons you confirm. We also receive information you submit yourself, for example your email address to get a fix guide or join the newsletter.",
  },
  {
    q: "Does the scan contact any third parties?",
    a: "Yes. To show your IP address and approximate location, your browser requests them from two third-party services, ipify (api.ipify.org) and ipapi.co. Those services necessarily see your IP address when you run the scan.",
  },
  {
    q: "What do you receive if I enter my email address?",
    a: "If you ask for the fix guide after a scan, we receive your email address, your risk score and the number of hexagons confirmed, together with the consent you ticked. Our Privacy Policy describes how that information is used, who processes it and your rights.",
  },
  {
    q: "Do you use cookies or analytics?",
    a: "Yes. The site uses a cookie consent banner, Google Analytics 4 and HubSpot. You can change your choices at any time with 'Manage cookies' in the footer. The Cookie Policy lists the cookies and what they do.",
  },
  {
    q: "Is the scan free?",
    a: "Yes. You can run the scan from the home page without creating an account.",
  },
  {
    q: "How often should I scan?",
    a: "Scan again whenever you change browser, device, VPN or privacy settings, or install extensions. Checking once in a while is a sensible habit.",
  },
  {
    q: "How do I reduce my digital shadow?",
    a: "After a scan, follow the suggested steps and our opt-out guides, for example for removing your information from the internet and from Google, and for stopping spam calls and emails.",
  },
  {
    q: "Who is behind MyPrivacyTOOL?",
    a: "MyPrivacyTOOL Ltd, a company based in Hong Kong, founded by Chris Ransford. See the About page for details.",
  },
  {
    q: "How do I contact support or ask about my data?",
    a: "Use the contact page or email support@myprivacytool.io. The Privacy Policy explains how to exercise your privacy rights.",
  },
];

const Faq = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return (
    <>
      <Helmet>
        <title>FAQ - MyPrivacyTOOL</title>
        <meta
          name="description"
          content="Answers about MyPrivacyTOOL: how the scan works, what stays in your browser, which third parties are contacted and how to reach us."
        />
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="mb-2 text-4xl font-bold text-gray-900">Frequently asked questions</h1>
          <p className="mb-8 text-lg text-gray-600">
            Can't find your answer? Visit our <Link to="/contact" className="text-primary underline">contact page</Link>
            , or read the <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
          </p>
          <div className="space-y-3">
            {FAQS.map(({ q, a }) => (
              <details key={q} className="group rounded-lg border border-gray-200 bg-white p-4">
                <summary className="cursor-pointer text-lg font-semibold text-gray-900">{q}</summary>
                <p className="mt-3 text-gray-700">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </main>
    </>
  );
};

export default Faq;
