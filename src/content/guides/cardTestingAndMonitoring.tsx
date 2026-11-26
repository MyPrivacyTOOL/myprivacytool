import { Link } from "react-router-dom";
import { blogCtaHref } from "@/lib/blogTracking";

export const sections = [
  { id: "what-is-card-testing", title: "What is card testing?" },
  { id: "how-criminals-get-your-bin", title: "How criminals get your BIN" },
  { id: "why-you-missed-it", title: "Why you almost missed it" },
  { id: "what-actually-works", title: "What actually protects your card" },
  { id: "find-your-exposure", title: "Check what you are exposing" },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "What is a BIN?",
    a: "Bank Identification Number — the first 6 digits of your card. Criminals use BINs to test whether a card is valid before attempting larger fraudulent charges. A BIN alone is public information, but it's the starting point for card testing.",
  },
  {
    q: "Will my bank catch card testing?",
    a: "Sometimes, but not always. Transaction monitoring systems flag unusual patterns, but small test charges ($1–$3) often slip through. The best defense is you: checking your statement regularly and reporting unauthorized charges immediately.",
  },
  {
    q: "Does 2FA protect me from card testing?",
    a: "Not entirely. 2FA (like 3D Secure) blocks online transactions that require authentication, but card testing often happens on unmonitored platforms or offline systems. 2FA is valuable security, but it's not foolproof against all fraud.",
  },
  {
    q: "What is a virtual card, and does it help?",
    a: "A virtual card is a generated card number tied to your real account, with customizable limits and merchant restrictions. It's one of the strongest defenses: criminals test a number that isn't connected to your real card, so testing doesn't reach your actual account.",
  },
  {
    q: "If my BIN is exposed, am I definitely at risk?",
    a: "Not immediately. A BIN alone is low-risk — criminals need more: your full card number, expiry date, and CVC. But a BIN combined with your name and DOB (all exposed together on some data brokers) is higher-risk. That's why knowing what's exposed matters.",
  },
  {
    q: "How do I report card testing to my bank?",
    a: "Call your bank's fraud line immediately if you spot unauthorized test charges. Report the exact transaction amounts, dates and merchants. Banks can reverse charges and may issue a new card. Some banks also allow you to freeze the card or restrict transaction types directly in their app.",
  },
  {
    q: "Can I remove my card data from data brokers?",
    a: "Card numbers themselves are rarely sold by brokers (they're hard to harvest and quickly blacklisted). But your name, phone, email and address — which criminals use to find your card number elsewhere — can be found on dozens of data brokers. Removing those removes risk.",
  },
  {
    q: "Should I freeze my credit?",
    a: "A credit freeze prevents new accounts from being opened in your name, which protects against identity fraud. Card testing (using an existing card) is not the same as identity fraud, but a freeze is a valuable extra layer if you're concerned about all fraud types.",
  },
];

const Content = () => (
  <>
    <p>
      Card testing is a fraud technique that starts with a simple test: criminals take a card number and attempt a small charge to see if it works. If it does, they know they can use it for larger fraud. If you're checking your bank statement regularly, you might catch it. Most people don't. Here's what you need to know, what actually stops it, and where your card data is exposed in the first place.
    </p>

    <h2 id="what-is-card-testing">What is card testing?</h2>
    <p>
      Card testing (also called "BIN testing" or "carding") works like this:
    </p>
    <ol>
      <li><strong>Criminals obtain a list of card numbers or BINs</strong> (the first 6 digits). These come from data breaches, dark web markets, or publicly exposed data.</li>
      <li><strong>They make tiny test charges</strong> — usually $1 to $3 — to hundreds or thousands of cards at once.</li>
      <li><strong>They track which charges go through.</strong> If a $1 charge succeeds, that card is valid. They move on to larger fraud against the cards that passed.</li>
      <li><strong>You often don't notice.</strong> A $1 charge in an unfamiliar merchant name gets lost in a busy statement or never shows up at all (some merchants never post test charges).</li>
    </ol>
    <p>
      The goal is not the $1 — it's proof that your card works. That's when the real fraud starts.
    </p>

    <h2 id="how-criminals-get-your-bin">How criminals get your BIN</h2>
    <p>
      Your BIN is public, but criminals don't guess it. They find it in exposed data:
    </p>
    <ul>
      <li><strong>Data breaches.</strong> Retailers, payment processors and apps that store card numbers get hacked. Card data leaks to the dark web.</li>
      <li><strong>Data brokers.</strong> Some brokers collect purchase history and payment info and sell it. Your card issuer (bank name), type (credit/debit) and sometimes full number appear alongside your name and phone.</li>
      <li><strong>Public records and scraped sites.</strong> Old receipts, leaked databases, and aggregated financial profiles published online.</li>
      <li><strong>Social engineering.</strong> Phishing emails, fake checkout pages and malware that captures card details as you type.</li>
    </ul>
    <p>
      Once a BIN (or full card number) is in a leaked dataset, it circulates. Criminals don't need to know you personally — they just need your card number and enough confidence that testing it is worth the effort.
    </p>

    <h2 id="why-you-missed-it">Why you almost missed it</h2>
    <p>
      Card testing succeeds because the test charges are tiny and easy to overlook:
    </p>
    <ul>
      <li><strong>They're small.</strong> $1–$3 doesn't trigger fraud alerts in most banks.</li>
      <li><strong>They're fast.</strong> Multiple charges from different merchants in one day can blur together on a statement.</li>
      <li><strong>They're vague.</strong> Test merchants use generic names like "GLOBAL SERVICES" or "ONLINE MERCHANT" to avoid notice.</li>
      <li><strong>They might disappear.</strong> Some test charges never post. The merchant authorizes them to verify the card, then reverses the charge within hours or days.</li>
      <li><strong>You're not checking.</strong> Most people don't review statements in real time. By the time you notice a few $1 charges, your card has already been flagged as valid and larger fraud may have started.</li>
    </ul>

    <h2 id="what-actually-works">What actually protects your card</h2>
    <p>
      No single defense is perfect, but these work:
    </p>

    <h3>1. Statement monitoring — the simplest and most effective</h3>
    <p>
      Check your statement <strong>daily</strong> (most banks offer app notifications for every charge). You will spot test charges before larger fraud happens. Report them to your bank within 24 hours. This is not sexy security, but it catches fraud 100% of the time for the person doing it.
    </p>

    <h3>2. Card locks and transaction controls</h3>
    <p>
      Most modern banking apps let you:
    </p>
    <ul>
      <li><strong>Lock the physical card</strong> so no transactions go through until you unlock it.</li>
      <li><strong>Restrict transaction types</strong> — allow online only, or in-person only.</li>
      <li><strong>Set daily limits</strong> — a $100/day cap stops large fraud immediately.</li>
      <li><strong>Block categories</strong> — disable gambling, international, or subscription merchants entirely if you don't use them.</li>
    </ul>
    <p>
      These controls don't prevent testing entirely, but they limit damage. Test charges may still go through (they're low-value), but criminals won't be able to use your card for the larger fraud they're preparing.
    </p>

    <h3>3. Virtual cards (strongest available)</h3>
    <p>
      Virtual cards are generated card numbers that:
    </p>
    <ul>
      <li>Draw from your real account but aren't linked to your physical card.</li>
      <li>Can be restricted to a single merchant, a spending limit, and an expiration date.</li>
      <li>Can be generated on-demand for each online purchase.</li>
    </ul>
    <p>
      If a virtual card is compromised, criminals test a number that isn't connected to your real card. Your actual card remains safe. Banks like American Express, Citi and many others offer virtual card programs; check whether yours does.
    </p>

    <h3>4. 2FA and 3D Secure — valuable but incomplete</h3>
    <p>
      Two-factor authentication (like 3D Secure on Visa/Mastercard) blocks many online fraud attempts. But:
    </p>
    <ul>
      <li>Test charges are often too small to trigger 2FA prompts.</li>
      <li>Offline and unmonitored platforms bypass it entirely.</li>
      <li>Criminals have automation that sometimes passes 2FA.</li>
    </ul>
    <p>
      Use 2FA (it's good), but don't rely on it alone.
    </p>

    <h3>5. Remove your data from brokers</h3>
    <p>
      Your <strong>card number itself</strong> is rarely exposed by brokers — it's too risky for them to store. But your <strong>name, phone, email, address and payment history</strong> are sold routinely. Removing those stops criminals from finding your card data in the first place.
    </p>

    <h2 id="find-your-exposure">Check what you are exposing</h2>
    <p>
      The best defense is knowing what's already out there. A free MyPrivacyTOOL scan shows what your browser, device and network reveal to websites, and your emailed report adds what your email address reveals. It does not search data brokers, public records or breach databases, and it cannot see your card details.
    </p>
    <p>
      Once you know what's exposed, you can:
    </p>
    <ul>
      <li>Ask each data broker to remove your listing, using our free <Link to="/opt-out-guides">opt-out guides</Link>. When paid plans open, we plan to offer paid removal that sends requests for you; it is not available today.</li>
      <li>Update passwords and security settings on compromised accounts.</li>
      <li>Set a reminder to search for your details again, so you notice if they reappear. MyPrivacyTOOL monitoring alerts are not available today; we plan to offer them when paid plans open.</li>
    </ul>

    <p>
      <Link to={blogCtaHref("card-testing-and-statement-monitoring")}>
        Run a free exposure scan now
      </Link>
      . It shows what your browser, device and network reveal. It does not search for your card details.
    </p>

    <h3>When card testing happens, here's what to do:</h3>
    <ol>
      <li><strong>Call your bank immediately.</strong> Report each unauthorized charge with the exact amount, date and merchant.</li>
      <li><strong>Request a chargeback.</strong> Banks can reverse fraudulent charges within days.</li>
      <li><strong>Ask for a new card.</strong> A replacement stops criminals from testing the number further.</li>
      <li><strong>Add a fraud alert or credit freeze</strong> if you're concerned about identity fraud too.</li>
      <li><strong>Monitor your statement for 60 days.</strong> If larger fraud follows, catch it early.</li>
    </ol>

    <h3>Long-term: remove your exposure</h3>
    <p>
      The final step is removing your data from the places where criminals find it. Data brokers, leaked databases, and exposed public records are where your card info circulates. Removing your data from these sources stops the cycle before card testing even starts.
    </p>

    <p>
      Today you send those requests yourself: our opt-out guides show the steps. When paid plans open, we plan to offer a paid removal service that sends requests for you. It is not available today.
    </p>
  </>
);

export default Content;