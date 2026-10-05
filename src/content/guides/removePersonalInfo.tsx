import { Link } from "react-router-dom";

export const sections = [
  { id: "what-removal-means", title: "What removing your information really means" },
  { id: "audit", title: "Step 1: Audit what is already out there" },
  { id: "old-accounts", title: "Step 2: Close old accounts and tighten social privacy" },
  { id: "data-brokers", title: "Step 3: Opt out of people-search sites and data brokers" },
  { id: "search-engines", title: "Step 4: Remove results from search engines" },
  { id: "stop-new-exposure", title: "Step 5: Stop new exposure" },
  { id: "manual-vs-automated", title: "Manual removal versus automated services" },
  { id: "how-long", title: "How long it takes and when to re-check" },
  { id: "apac", title: "Your rights in Hong Kong, Singapore and Australia" },
  { id: "request-template", title: "A template for opt-out and deletion requests" },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "Can I completely erase my personal information from the internet?",
    a: "No, and anyone who promises that is overselling. You can remove a lot of it: old accounts, people-search listings, marketing-list entries and some search results. But public registers, news archives, and copies held by other people are outside your control. The realistic goal is to shrink your footprint and keep it small, not to disappear.",
  },
  {
    q: "Does Hong Kong, Singapore or Australia have a right to be forgotten?",
    a: "None of them has a general, EU-style right to be forgotten. Instead you have narrower tools: access and correction requests, the right to opt out of direct marketing, and in Singapore the ability to withdraw consent. Australia also expects organisations to destroy or de-identify data they no longer need. These are useful, but they are not a blanket erasure right.",
  },
  {
    q: "How long does it take to remove my data from a data broker?",
    a: "It varies by site. Some process opt-outs within a few days, others take several weeks, and some ask you to confirm by email first. In Hong Kong an organisation has 40 days to answer an access request, and in Singapore and Australia the usual benchmark is 30 days. Check again after a month, then every few months.",
  },
  {
    q: "Why does my information keep coming back after I opt out?",
    a: "Brokers buy and refresh data from marketing lists, public records, apps and other brokers. If your details are still in the source, they can be re-imported and a new listing appears. That is why a one-off clean-up fades over time, and why a simple log and a regular re-check matter more than a single push.",
  },
  {
    q: "Should I use my real name to make removal requests?",
    a: "Usually you must give enough information for the organisation to find and verify your record, which often means your name and the email or phone number on file. Use only what is needed, avoid sending ID documents unless the organisation clearly requires them, and never send identification to a site you cannot verify is the actual data holder.",
  },
  {
    q: "Is it worth paying for a removal service?",
    a: "It depends on your time and risk. Doing it yourself is free and effective for a handful of sites, but it is repetitive and needs repeating. A service can save time by submitting and tracking requests, though it cannot reach every source. Check which sites and countries it actually covers before you pay.",
  },
  {
    q: "What if an organisation ignores my request?",
    a: "Keep copies of your request and any replies, then follow up in writing after the deadline has passed. If there is still no proper response, you can complain to the regulator: the PCPD in Hong Kong, the PDPC in Singapore, or the OAIC in Australia, which expects you to complain to the organisation first.",
  },
  {
    q: "What should I do first if my home address has been posted online?",
    a: "Screenshot the post with its date and address, report it to the platform under its harassment or privacy rules, and ask the site owner to remove it. If you feel unsafe, contact the police. In Hong Kong, doxxing is an offence and the PCPD can issue cessation notices; Singapore and Australia have separate harassment and privacy remedies.",
  },
];

const Content = () => (
  <>
    <p>
      Search for your own name and you may be surprised. An old forum account, a school
      alumni page, a listing on a people-search site, a company filing with your home
      address on it. None of it was stolen, and much of it was perfectly legal to collect.
      Together, though, it gives scammers, stalkers and marketers a detailed picture of you.
    </p>
    <p>
      This guide walks through a practical, ordered process for reducing that footprint. It
      is written for ordinary people rather than specialists, with a dedicated section on
      Hong Kong, Singapore and Australia, where most privacy advice online is written for
      the US or Europe and does not quite fit. If your main worry is Google results, read
      our companion guide on{" "}
      <Link to="/blog/remove-your-name-and-info-from-google">removing your name and info from Google</Link>
      ; if it is unwanted contact, see{" "}
      <Link to="/blog/stop-spam-calls-texts-and-emails">stopping spam calls, texts and emails</Link>.
    </p>

    <h2 id="what-removal-means">What removing your information really means</h2>
    <p>
      Be realistic from the start. You cannot delete yourself from the internet. Your
      information lives in four broad places, and you have different levels of control over
      each:
    </p>
    <ul>
      <li>
        <strong>Things you posted yourself.</strong> Social profiles, reviews, old blogs and
        accounts. You have the most control here.
      </li>
      <li>
        <strong>Things companies hold about you.</strong> Shops, apps, banks, loyalty
        schemes and marketing databases. Privacy law gives you some rights here, which
        differ by country.
      </li>
      <li>
        <strong>Things data brokers and people-search sites compile.</strong> Often built
        from the two categories above plus public records. You can usually request removal,
        but listings can return.
      </li>
      <li>
        <strong>Things other people or institutions publish.</strong> News articles,
        court records, company registers and photos posted by friends. You have the least
        control here, and removal is often a matter of persuasion or narrow legal grounds.
      </li>
    </ul>
    <p>
      The realistic goal is to <strong>reduce and maintain</strong>: take down what you can,
      make the rest harder to find, and stop feeding the system with new data. That is
      achievable, and it meaningfully lowers your exposure to identity fraud, phishing and
      harassment.
    </p>
    <blockquote>
      <p>
        <strong>Tip:</strong> Work in the order below. Closing old accounts and stopping new
        exposure first means less data flows back into the places you are about to clean.
      </p>
    </blockquote>

    <h2 id="audit">Step 1: Audit what is already out there</h2>
    <p>
      You cannot remove what you have not found. Set aside an hour and build a simple
      spreadsheet with columns for the site, the URL, what is exposed, the date you found
      it, and the status of your request. This becomes your log for the rest of the
      process.
    </p>

    <h3>Search yourself properly</h3>
    <ul>
      <li>
        Search your full name in quotation marks, then again with your suburb, city, employer
        or school. Try common variations and any maiden or former names.
      </li>
      <li>
        Search your phone numbers and email addresses in quotation marks. Results from
        directories or lead-generation sites are worth logging.
      </li>
      <li>
        Search your home address. This reveals property records, delivery listings and
        people-search pages that a name search misses.
      </li>
      <li>
        Use a private browsing window, ideally with a logged-out browser, so your search
        history does not personalise the results.
      </li>
      <li>
        Check the first few pages, not just the first. Broker pages often sit on pages two
        and three.
      </li>
    </ul>

    <h3>Check images and usernames</h3>
    <p>
      Run a reverse image search on your main profile photos to see where they have been
      reused. Search your common usernames too, because people reuse the same handle across
      forums, gaming sites and marketplaces, and that makes them easy to link together.
    </p>

    <h3>Check for data breaches</h3>
    <p>
      Enter your email addresses into{" "}
      <a href="https://haveibeenpwned.com" target="_blank" rel="noopener noreferrer">
        Have I Been Pwned
      </a>{" "}
      to see which breaches include them. A breach is not something you can delete, but the
      list tells you which accounts to close, which passwords to change, and which
      companies may be holding more than they should.
    </p>

    <h3>Run a scan for broker exposure</h3>
    <p>
      Manual searching misses a lot, because many broker pages are not indexed well by
      search engines. A{" "}
      <Link to="/scan?utm_source=blog&utm_medium=remove-personal-information-from-internet">free scan</Link>{" "}
      can show where your details appear across data-broker and people-search sites, so you
      know which requests are worth your time.
    </p>

    <h2 id="old-accounts">Step 2: Close old accounts and tighten social privacy</h2>
    <p>
      Every account you no longer use is a copy of your data sitting with a company whose
      security you do not control. Many breaches involve accounts people forgot they had.
    </p>

    <h3>Find your forgotten accounts</h3>
    <ul>
      <li>
        Search your email inbox for phrases such as &quot;welcome to&quot;, &quot;verify your
        email&quot; and &quot;your account&quot; to list services you signed up for.
      </li>
      <li>
        Check the saved logins in your browser and password manager.
      </li>
      <li>
        Review the apps and sites connected to your Google, Apple, Facebook and Microsoft
        sign-ins, and remove anything you do not recognise or use.
      </li>
    </ul>

    <h3>Delete, do not just deactivate</h3>
    <p>
      Deactivating usually hides an account but keeps the data. Look for an option called
      delete or close account, and if there is none, email the company&apos;s privacy contact
      and ask for deletion. Before you delete, change the profile name and details if you
      can, since some services keep the last saved version.
    </p>

    <h3>Lock down the accounts you keep</h3>
    <ul>
      <li>Set profiles to private or friends-only and hide your friends list.</li>
      <li>
        Remove your phone number, birthday, workplace and home town from public fields.
      </li>
      <li>Turn off location tagging and review old photos with visible street signs or plates.</li>
      <li>
        Check who can find you by phone number or email, and restrict it to people you know.
      </li>
      <li>
        Ask friends and family to check before tagging you or posting images of your home.
      </li>
    </ul>

    <h2 id="data-brokers">Step 3: Opt out of people-search sites and data brokers</h2>
    <p>
      Data brokers collect personal details from many sources, package them into profiles,
      and sell or publish them. People-search sites are the public face of this: type a
      name, see an age, address history, relatives and phone numbers.
    </p>

    <h3>What to expect in this region</h3>
    <p>
      Many of the largest people-search sites are US-focused, so a person in Hong Kong,
      Singapore or Australia may find fewer obvious profiles. That does not mean your data
      is absent. In the Asia-Pacific region, information typically appears through
      marketing and lead lists, business and company registries, property and professional
      records, directories, and data leaked in breaches and resold. If you have ever lived,
      studied or worked in the US, or used a US service, US-style listings are also
      possible.
    </p>

    <h3>How a manual opt-out usually works</h3>
    <ol>
      <li>
        <strong>Find your listing.</strong> Copy the exact URL of the page that shows your
        information.
      </li>
      <li>
        <strong>Find the opt-out route.</strong> Look in the site footer for wording such as
        &quot;opt out&quot;, &quot;do not sell my information&quot;, &quot;remove my
        listing&quot; or &quot;privacy&quot;. If there is no form, use the privacy contact
        email.
      </li>
      <li>
        <strong>Submit the request.</strong> Provide only what is needed to identify the
        listing. Use a dedicated email address for requests so confirmation messages do not
        clutter your main inbox.
      </li>
      <li>
        <strong>Confirm.</strong> Many sites send a verification link. Click it promptly or
        the request lapses.
      </li>
      <li>
        <strong>Check again.</strong> Come back after a few weeks to verify the listing is
        gone, and record the result.
      </li>
    </ol>

    <h3>The re-listing problem</h3>
    <p>
      Opting out of one site rarely stops the source. If a broker re-buys the same marketing
      list or scrapes the same register, a new profile can appear months later. The best
      defences are to cut off the sources (Steps 2 and 5), to make requests that reference
      your legal rights where they apply (see the regional section below), and to re-check
      on a schedule.
    </p>

    <h3>Keep a log</h3>
    <p>
      For each request, record the date, the site, how you asked, what you were told and the
      outcome. If you later need to complain to a regulator, a dated paper trail is what
      turns &quot;they ignored me&quot; into something they can act on.
    </p>

    <blockquote>
      <p>
        <strong>Be careful with fake opt-out sites.</strong> Scam pages imitate removal
        forms to harvest more of your details. Only use opt-out links reached from the
        company&apos;s own site, and be wary of any &quot;removal&quot; page that asks for
        ID or payment details.
      </p>
    </blockquote>

    <h2 id="search-engines">Step 4: Remove results from search engines</h2>
    <p>
      Removing a search result is not the same as removing the page. If the page still
      exists, anyone with the link can visit it, and other search engines may still list
      it. Whenever possible, get the page itself changed or deleted, then ask the search
      engine to refresh its index.
    </p>
    <ul>
      <li>
        <strong>Ask the site owner first.</strong> A polite email to the webmaster or
        privacy contact solves many cases quickly.
      </li>
      <li>
        <strong>Use the search engine&apos;s own tools.</strong> Google, Bing and others
        offer forms for outdated content, personal contact details, government ID numbers,
        explicit images and doxxing content. Eligibility is narrow and decisions are
        discretionary.
      </li>
      <li>
        <strong>Follow the whole process.</strong> Our guide to{" "}
        <Link to="/blog/remove-your-name-and-info-from-google">removing your name and info from Google</Link>{" "}
        covers the forms, the evidence to gather and what to do if a request is refused.
      </li>
    </ul>

    <h2 id="stop-new-exposure">Step 5: Stop new exposure</h2>
    <p>
      Cleaning up is only half the job. If you keep handing out the same details, the
      profiles will rebuild. These habits matter more than any single removal.
    </p>

    <h3>Use email aliases</h3>
    <p>
      Give each shop, app and newsletter its own alias address that forwards to your inbox.
      When an alias starts receiving spam, you know who leaked or sold it, and you can turn
      it off without changing your real email. Many email providers and privacy services
      offer this.
    </p>

    <h3>Treat your phone number as sensitive</h3>
    <ul>
      <li>Do not give your mobile number to retailers that do not need it.</li>
      <li>
        Consider a secondary number for forms, deliveries and marketplaces, and keep your
        main number for banks and close contacts.
      </li>
      <li>
        Prefer an authenticator app over SMS codes where you can, since numbers can be
        hijacked.
      </li>
    </ul>

    <h3>Use a password manager and unique passwords</h3>
    <p>
      A password manager lets you use a different strong password everywhere, so one breach
      does not unlock everything. Turn on two-factor authentication for email, banking and
      social accounts first.
    </p>

    <h3>Protect your credit and identity</h3>
    <p>
      Where credit bureaus operate, check your report for accounts you do not recognise.
      Many countries let you place a temporary ban or freeze on your credit file if you fear
      identity fraud (see the regional section). Set up alerts with your bank for new
      payees and large transactions.
    </p>

    <h3>Limit public registers where you can</h3>
    <p>
      Some records are public by design: company directors, property titles, electoral rolls
      and professional registers. You usually cannot remove them, but you can often restrict
      what is shown, for example by using a business or correspondence address instead of
      your home. Check each register&apos;s current rules.
    </p>

    <h2 id="manual-vs-automated">Manual removal versus automated services</h2>
    <p>
      You can do all of this yourself for free, and for a small footprint that may be all you
      need. Automated removal services exist because the work is repetitive and needs
      repeating. Here is an honest comparison.
    </p>
    <table>
      <thead>
        <tr>
          <th>Factor</th>
          <th>Doing it yourself</th>
          <th>Automated service</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Cost</td>
          <td>Free, but costs your time</td>
          <td>Subscription fee</td>
        </tr>
        <tr>
          <td>Time</td>
          <td>Several hours up front, then regular re-checks</td>
          <td>Mostly automatic once set up</td>
        </tr>
        <tr>
          <td>Coverage</td>
          <td>Only the sites you find and know how to handle</td>
          <td>Limited to the sites the provider supports</td>
        </tr>
        <tr>
          <td>Re-listing</td>
          <td>Easy to forget to re-check</td>
          <td>Can re-submit and monitor on a schedule</td>
        </tr>
        <tr>
          <td>Control</td>
          <td>You see and choose everything</td>
          <td>You rely on the provider&apos;s process and reporting</td>
        </tr>
        <tr>
          <td>Legal requests</td>
          <td>You can send tailored access and deletion requests</td>
          <td>Usually standard opt-out requests</td>
        </tr>
      </tbody>
    </table>
    <p>
      Whichever route you choose, ask which sites and countries are actually covered, since
      a service built around US brokers may do little for data held in Asia-Pacific. At
      MyPrivacyTOOL, the{" "}
      <Link to="/scan?utm_source=blog&utm_medium=remove-personal-information-from-internet">free scan</Link>{" "}
      shows where your data is exposed, and removal requests can be automated once you know
      what needs to go. Use the scan results as a to-do list even if you decide to handle
      requests yourself.
    </p>

    <h2 id="how-long">How long it takes and when to re-check</h2>
    <p>
      Expect a process measured in weeks, not days. Simple opt-outs may take effect quickly,
      while requests that go through a privacy officer can take a month or more. The legal
      response times in Hong Kong, Singapore and Australia are covered below, and they are
      a useful benchmark for chasing a slow organisation.
    </p>
    <ul>
      <li>
        <strong>Week 1:</strong> audit, close old accounts, tighten social settings, set up
        aliases and a password manager.
      </li>
      <li>
        <strong>Weeks 1 to 3:</strong> submit broker and search-engine requests and record
        each one in your log.
      </li>
      <li>
        <strong>Week 6:</strong> verify results, and follow up in writing on anything
        outstanding.
      </li>
      <li>
        <strong>Every three to six months:</strong> repeat your name, phone and address
        searches and re-run a scan.
      </li>
      <li>
        <strong>After a life change:</strong> moving house, a new job, a breach notice or a
        new online account are all good moments to re-check.
      </li>
    </ul>

    <h2 id="apac">Your rights in Hong Kong, Singapore and Australia</h2>
    <p>
      Privacy law in these three markets gives you real tools, but it is important to know
      what they are. <strong>None of the three has a general, EU-style &quot;right to be
      forgotten&quot;.</strong> What you have instead are rights to access your data, to
      correct it, to opt out of marketing, and (in some cases) to withdraw consent. Those
      are enough to clear a lot of marketing-list and broker exposure.
    </p>
    <blockquote>
      <p>
        This is general information, not legal advice. Laws, forms and procedures change,
        so verify the current position with the regulator before you rely on it.
      </p>
    </blockquote>

    <h3>Hong Kong</h3>
    <p>
      The Personal Data (Privacy) Ordinance (PDPO, Cap. 486) is administered by the Office of
      the Privacy Commissioner for Personal Data (PCPD).
    </p>
    <ul>
      <li>
        <strong>Data access request.</strong> Under Data Protection Principle 6 and section
        18, you can ask an organisation whether it holds your personal data and for a copy.
        The PCPD publishes a Data Access Request Form (OPS003). The organisation must
        respond within 40 days (section 19) and may charge a reasonable fee for copying.
      </li>
      <li>
        <strong>Data correction request.</strong> Section 22 lets you ask for inaccurate
        personal data to be corrected.
      </li>
      <li>
        <strong>Direct marketing opt-out.</strong> Under section 35G, you can tell an
        organisation to stop using your data for direct marketing, and it must comply
        without charging you.
      </li>
      <li>
        <strong>Doxxing.</strong> Since the 2021 amendment, section 64 makes it an offence to
        disclose someone&apos;s personal data without consent with intent to, or being
        reckless as to whether it would, cause them specified harm. The PCPD can also serve
        cessation notices requiring the removal of doxxing content.
      </li>
      <li>
        <strong>Do-not-call registers.</strong> The Unsolicited Electronic Messages
        Ordinance (UEMO, Cap. 593) is supported by do-not-call registers run by the
        Office of the Communications Authority (OFCA).
      </li>
      <li>
        <strong>Company directors.</strong> Residential addresses on Companies Registry
        records can be sensitive. The registry has arrangements that let directors use a
        correspondence address and apply to protect residential addresses. Check the
        Companies Registry&apos;s current rules and eligibility before you apply.
      </li>
    </ul>
    <p>
      Start with the PCPD at{" "}
      <a href="https://www.pcpd.org.hk" target="_blank" rel="noopener noreferrer">pcpd.org.hk</a>.
    </p>

    <h3>Singapore</h3>
    <p>
      The Personal Data Protection Act 2012 (PDPA) is enforced by the Personal Data
      Protection Commission (PDPC).
    </p>
    <ul>
      <li>
        <strong>Access request.</strong> Under section 21, you can request access to your
        personal data and information on how it has been used. Organisations should respond
        as soon as reasonably possible, and generally within 30 days.
      </li>
      <li>
        <strong>Withdrawal of consent.</strong> Section 16 lets you withdraw consent to the
        collection, use or disclosure of your data. After reasonable notice, the
        organisation must stop. PDPC guidance treats about 10 business days as a reasonable
        notice period, though the organisation must tell you of the consequences.
      </li>
      <li>
        <strong>Do Not Call Registry.</strong> You can register your number to opt out of
        marketing voice calls, text messages and faxes.
      </li>
      <li>
        <strong>Doxxing and harassment.</strong> The Protection from Harassment Act provides
        remedies where publication of your details is part of harassment or stalking.
      </li>
      <li>
        <strong>Business register caveat.</strong> Information filed with the business
        registry (ACRA), such as officers&apos; details, is generally public by design.
        Removal is limited, so check ACRA&apos;s current rules on what can be masked or
        changed.
      </li>
    </ul>
    <p>
      The regulator&apos;s site is{" "}
      <a href="https://www.pdpc.gov.sg" target="_blank" rel="noopener noreferrer">pdpc.gov.sg</a>.
    </p>

    <h3>Australia</h3>
    <p>
      The Privacy Act 1988 and the Australian Privacy Principles (APPs) are overseen by the
      Office of the Australian Information Commissioner (OAIC). The Act applies to most
      Australian Government agencies and to many private organisations, though small
      businesses are largely exempt unless they fall into specific categories.
    </p>
    <ul>
      <li>
        <strong>Access (APP 12).</strong> You can ask for access to personal information an
        organisation holds about you. The usual response time is 30 days.
      </li>
      <li>
        <strong>Correction (APP 13).</strong> You can ask for inaccurate, out-of-date or
        misleading information to be corrected.
      </li>
      <li>
        <strong>Direct marketing (APP 7).</strong> You can ask an organisation to stop using
        your information for direct marketing and to tell you where it got your details.
      </li>
      <li>
        <strong>Destruction or de-identification (APP 11).</strong> Organisations must take
        reasonable steps to destroy or de-identify information they no longer need, which is
        a helpful argument when asking a company to delete old data.
      </li>
      <li>
        <strong>Complaints.</strong> Complain to the organisation first. If you are not
        satisfied, you can take the complaint to the OAIC at{" "}
        <a href="https://www.oaic.gov.au" target="_blank" rel="noopener noreferrer">oaic.gov.au</a>.
      </li>
      <li>
        <strong>Credit reports.</strong> The credit-reporting bureaus can place a
        ban period on your file if you believe you are a victim of fraud, which stops lenders
        from accessing it for a set time.
      </li>
      <li>
        <strong>Electoral roll.</strong> If your safety is at risk, you may be able to apply
        for silent enrolment with the Australian Electoral Commission (AEC) so that your
        address is not shown on the public roll.
      </li>
      <li>
        <strong>Do Not Call Register.</strong> Register your number at{" "}
        <a href="https://www.donotcall.gov.au" target="_blank" rel="noopener noreferrer">donotcall.gov.au</a>{" "}
        to reduce telemarketing calls.
      </li>
      <li>
        <strong>Serious invasions of privacy.</strong> A statutory tort for serious
        invasions of privacy was introduced in 2024 as part of Privacy Act reforms. Check
        the OAIC or a legal adviser for how and when it applies to you.
      </li>
    </ul>

    <blockquote>
      <p>
        <strong>Tip:</strong> Written requests that cite the correct law and section tend
        to be routed to the right person and taken more seriously. Keep the tone factual
        and polite, and put the deadline in writing.
      </p>
    </blockquote>

    <h2 id="request-template">A template for opt-out and deletion requests</h2>
    <p>
      You can adapt the wording below for a data broker, a retailer or a marketing company.
      It refers to the relevant rights in all three jurisdictions, so delete the ones that
      do not apply to you. Send it to the organisation&apos;s privacy officer or privacy
      contact, and keep a copy.
    </p>
    <blockquote>
      <p><strong>Subject:</strong> Request to stop using and delete my personal data</p>
      <p>Dear Privacy Officer,</p>
      <p>
        I am writing about the personal data you hold about me. My details are: [full name],
        [email address or phone number on file], [URL of the listing, if applicable].
      </p>
      <p>I ask that you:</p>
      <ol>
        <li>
          Stop using my personal data for direct marketing, and stop disclosing it to third
          parties (under section 35G of the PDPO in Hong Kong, section 16 of the PDPA in
          Singapore, or APP 7 in Australia, as applicable).
        </li>
        <li>
          Delete my personal data, or de-identify it if deletion is not possible, where you
          no longer need it for a lawful purpose, and tell me if you are keeping any of it
          and why.
        </li>
        <li>
          Confirm which personal data you hold about me and where you obtained it, treating
          this as an access request (PDPO section 18, PDPA section 21, or APP 12).
        </li>
        <li>
          Confirm in writing when this has been done. I expect a reply within the period
          required by law: 40 days in Hong Kong, or 30 days in Singapore and Australia.
        </li>
      </ol>
      <p>
        If I do not receive a satisfactory reply, I may raise the matter with the relevant
        regulator.
      </p>
      <p>Yours sincerely,<br />[Name]</p>
    </blockquote>
    <p>
      Send only the identifying details the organisation genuinely needs. If it asks for
      ID, check that the request really comes from the organisation and ask what it will do
      with the copy. After sending, add the request to your log, set a reminder for the
      deadline and, if the answer is unsatisfactory, escalate to the PCPD, PDPC or OAIC.
    </p>
    <p>
      If you would rather not manage all of this by hand, you can start with a{" "}
      <Link to="/scan?utm_source=blog&utm_medium=remove-personal-information-from-internet">free scan</Link>{" "}
      to see where your information is exposed, and then decide which requests you want to
      handle yourself.
    </p>
  </>
);

export default Content;
