// Every answer here is limited to what the code does (src/lib/deviceDetection.ts, EmailCaptureModal.tsx,
// index.html) or to the published Privacy Policy (sections 2.4 and 6). Encryption and audit claims are deliberately absent: see the MPC-6545 PR notes.
// Never say "open source": the repo is public to read but has no licence (CK-7721).
export const FAQS: { q: string; a: string }[] = [
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
    a: "The detection runs in your browser and the results are shown to you there. The scan code does not send them to a server we operate, unless you choose to save your scan with your email, in which case we keep it for 12 months, then delete it automatically. Separately, where your cookie choices allow analytics, the site reports a summary of the scan to Google Analytics 4: device type, operating system, browser, approximate city and country, ISP, screen resolution, timezone and which hexagons you confirm. We also receive information you submit yourself, for example your email address to get a fix guide or join the newsletter.",
  },
  {
    q: "Does the scan contact any third parties?",
    a: "Not to look up your IP address or location. We do that ourselves, using the approximate location data that our hosting provider, Cloudflare, attaches to every request, so no separate lookup service sees your IP address. Cloudflare necessarily sees your IP address, as it does for any visit to the site. Analytics and sign-up forms are covered in the questions below.",
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
  {
    q: "What is a data broker?",
    a: "A data broker is a company that collects personal information about people, buys and sells it, and often publishes it in people-search sites. Our paid plans ask data brokers to remove you.",
  },
  {
    q: "How can I check the scan stays in my browser?",
    a: "Open your browser's developer tools, go to the Network tab and run the scan: you can watch which requests the page makes. Our source code is public to read at https://github.com/MyPrivacyTOOL/myprivacytool.",
  },
  {
    q: "Who or what is Alice?",
    a: "Alice is an AI guide. Her lines are scripted and are read aloud by your own device's voice. There is no chat, and nothing you do with her voice is sent to us.",
  },
  {
    q: "What happens if I save my scan?",
    a: "If you ask for your report and tick the box to save your scan with your email, we keep it for 12 months, then delete it automatically. To have it deleted earlier, write to privacy@myprivacytool.io.",
  },
];
