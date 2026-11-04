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
  // MPC-7561 (MPC-7560 approved by Chris 2026-10-28): the report-email questions. Wording is the approved text; do not edit without a new approval.
  {
    q: "What is in my privacy report?",
    a: "Two parts: what we found about your email address, and what your browser showed websites when you ran the scan. Each hexagon is marked FOUND, CHECKED AND CLEAR or NOT CHECKED, with the real value only where we found one. Your scan number is in it, and the full results are attached as a JSON file. Your IP address is not written in the email body; it is only in the attachment.",
  },
  {
    q: "Why are some hexagons marked \"not checked\"?",
    a: "NOT CHECKED means we make no claim. The check may have failed or been blocked, your browser may not offer that setting, or a website simply cannot see it, such as whether you are signed in to Google. We never show a placeholder as a finding and never count it as clear. It means we could not tell, not that you are safe.",
  },
  {
    q: "What does \"estimate\" mean?",
    a: "An estimate is our best guess, not something read from your device. For example, a place worked out from your IP address is often your provider's hub city, not your street. The report labels these \"our estimate, not measured\" so you can tell them apart from measured findings.",
  },
  {
    q: "What do you check about my email address?",
    a: "Up to seven checks: known data breaches (our Privacy Policy says we do not currently check these, so the report says NOT CHECKED), whether your address contains a name, your mail provider and domain, two public profile-picture services, a website ownership record, and public code changes. Only your domain or a scrambled code leaves us, except the code-changes search, which sends your full address to GitHub.",
  },
  {
    q: "What is my scan number?",
    a: "When you save a scan, we give it a number. It is in your report email. If you ask us to delete a saved scan, quote it so we can find the right one without guessing.",
  },
  {
    q: "How do I delete my scan?",
    a: "Write to privacy@myprivacytool.io with your scan number or the email address you used, or reply to your report email. There is no self-service delete button yet, and we say so rather than promise one.",
  },
  {
    q: "Do you sell or share my data?",
    a: "We do not sell your personal data. We share it only with the providers that run the product, such as hosting (Cloudflare), databases (Supabase), email (Resend, HubSpot) and analytics, as listed in the Privacy Policy. One check also sends your full email address to GitHub, to search public code changes. If you use help or messaging, message text may go to an AI provider after we remove email addresses and phone numbers.",
  },
  {
    q: "What is the JSON file?",
    a: "It is attached to your report. It holds every hexagon with its full value and the technical detail that did not fit in the email, so you can open it, search it and analyse it yourself. It is your own data.",
  },
  {
    q: "Why did I get this email, and how do I stop them?",
    a: "You asked for your report. Later emails about your report come from the same request. Every email has an Unsubscribe link in the footer; using it stops further emails from us to that address. You can also reply or write to privacy@myprivacytool.io.",
  },
  {
    q: "Is MyPrivacyTOOL tracking me?",
    a: "The scan runs in your browser and does not save anything unless you ask for your report. We use Google Analytics 4 and HubSpot only if you accept them in the cookie banner. We do not recognise your device in the background, and we count visits without personal data otherwise.",
  },
  {
    q: "What does \"mirror, not tracker\" mean?",
    a: "A tracker watches you without telling you. A mirror shows you what trackers can already see. Anything we compare or recognise happens in the open, only with your consent, and is shown to you with how it was done.",
  },
  {
    q: "What do you record about bots and AI crawlers?",
    a: "When anyone loads a page we keep a log entry: time, page, the program name the visitor reported, IP address, country and network, and a few technical headers. We sort visits into person, other bot, AI crawler or unknown. For bots and AI crawlers we keep the full entry. If you were wrongly sorted as a bot, contact us and we will delete it.",
  },
  {
    q: "What happens to my IP address?",
    a: "For ordinary visits, the IP address is removed from the log after 30 days; the rest of the entry stays without it. If you save a scan, the IP address is part of the saved result for 12 months. It is never written into your report email body.",
  },
];
