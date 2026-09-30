import { Link } from "react-router-dom";

export const sections = [
  { id: "why-you-get-spam", title: "Why you keep getting spam calls, texts and emails" },
  { id: "spam-vs-scam", title: "Step 1: Tell spam, scams and legitimate marketing apart" },
  { id: "phones", title: "Step 2: Stop spam calls and texts on your phone" },
  { id: "email", title: "Step 3: Stop spam emails" },
  { id: "reduce-exposure", title: "Step 4: Reduce your exposure at the source" },
  { id: "do-not-call", title: "Step 5: Register on Do-Not-Call lists" },
  { id: "apac", title: "Hong Kong, Singapore and Australia: local rules and tools" },
  { id: "reporting", title: "Step 6: Report spam and scams" },
  { id: "already-engaged", title: "What to do if you have already engaged or fallen for a scam" },
  { id: "expectations", title: "Realistic expectations: what each tool does and does not stop" },
  { id: "maintenance", title: "A simple maintenance checklist" },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "Why do I get spam calls even though I never gave out my number?",
    a: "Your number has probably been collected without you noticing. Common routes include data broker lists, leaked databases from breached services, online forms and competitions, scraped social or business profiles, and dialers that simply generate numbers in sequence. Once a number is on one list it is often resold, which is why the calls keep arriving.",
  },
  {
    q: "Should I reply STOP to a spam text?",
    a: "Only if you recognise the sender as a legitimate business you dealt with. For unexpected texts about parcels, banking, prizes or tax refunds, do not reply at all. A reply confirms your number is active and monitored, which can lead to more messages. Block the sender, report the message to your carrier or regulator, and delete it.",
  },
  {
    q: "Does the Do-Not-Call register stop scam calls?",
    a: "No. Do-Not-Call registers bind legitimate organisations that follow the law, so they cut down genuine telemarketing. Scammers ignore them, and many operate from overseas. Registration is still worth doing because it removes a large share of nuisance marketing, leaving you with fewer calls to screen and making the remaining suspicious ones easier to spot.",
  },
  {
    q: "Is unsubscribing from spam emails safe?",
    a: "It is safe for emails from businesses you recognise and have dealt with, especially where the message comes from a known address and the link is in a standard footer. For unknown senders, do not click unsubscribe. Mark the message as junk instead, because a click can confirm your address is live and lead to more mail.",
  },
  {
    q: "How can I tell if my email address has been leaked?",
    a: "Enter your address into Have I Been Pwned, a well-known breach-checking service run by security researcher Troy Hunt. It shows which known breaches include your address. If you appear, change the password on that service and anywhere you reused it, turn on two-factor authentication, and expect more phishing and spam aimed at that address.",
  },
  {
    q: "Will removing my data from broker sites stop spam completely?",
    a: "It will not stop everything, but it cuts a major source. Brokers sell and share contact details, so removal reduces how many marketers can find you. Scammers may still dial random numbers or use older leaked data. Think of removal as one layer alongside call filtering, email filtering and registration on Do-Not-Call lists.",
  },
  {
    q: "What should I do if I already clicked a link or shared details?",
    a: "Act quickly. Change passwords for any account involved and anything sharing that password, contact your bank or card provider straight away using the number on your card, and report to police or your national scam reporting body. Keep screenshots. Be wary of anyone who then offers to recover your money for a fee.",
  },
  {
    q: "Can I block all unknown callers on my phone?",
    a: "Yes. iPhone offers Silence Unknown Callers and Android offers similar call screening and spam protection. The trade-off is that legitimate callers you have not saved, such as a clinic, courier or new employer, go to voicemail. Many people use silencing for a few weeks, check voicemail and missed calls, and adjust from there.",
  },
];

const Content = () => (
  <>
    <p>
      Almost everyone who owns a mobile phone or email address eventually ends up with a stream of unwanted calls,
      texts and messages. Some are irritating but legal marketing. Others are outright scams designed to steal money or
      identity details. This guide explains where the flood comes from, how to tell the difference between the kinds of
      unwanted contact, and what actually works to reduce it, on your phone, in your inbox and at the source. It also
      covers the specific rules and tools available in Hong Kong, Singapore and Australia.
    </p>
    <p>
      The short version is that blocking and filtering treat symptoms, while cutting off the supply of your contact
      details treats the cause. You need both, and you need realistic expectations about what each one can do.
    </p>

    <h2 id="why-you-get-spam">Why you keep getting spam calls, texts and emails</h2>
    <p>
      Spam does not arrive at random. Your phone number and email address reach senders through a handful of common
      routes, and understanding them explains why simply hitting unsubscribe rarely makes the problem go away.
    </p>
    <ul>
      <li>
        <strong>Data brokers.</strong> Companies collect and package personal details such as names, phone numbers,
        emails, addresses and demographic guesses, then sell or share them with marketers. If you appear in several
        broker lists, several different callers may hold your number.
      </li>
      <li>
        <strong>Leaked and breached databases.</strong> When a service is hacked, its customer records often end up
        being traded. Criminals then use those emails and numbers for phishing and scam campaigns.
      </li>
      <li>
        <strong>Lead-generation forms.</strong> Competitions, quote comparison sites, free-trial forms and survey pages
        often pass your details on to &quot;partners&quot;. A tick-box buried in the terms may be the only sign that it
        happened.
      </li>
      <li>
        <strong>Scraped profiles.</strong> Public social media, business directories, domain registrations and
        professional networking pages can be harvested by automated tools, including phone numbers and work emails you
        posted for entirely different reasons.
      </li>
      <li>
        <strong>Number-generating dialers.</strong> Some callers do not have your number from anywhere. They dial
        through ranges of numbers automatically, and answering tells them yours is live.
      </li>
    </ul>
    <p>
      This is why unsubscribing alone does not solve it. Unsubscribing removes you from one sender&apos;s list, but the
      broker, the leaked database and the dialer keep supplying new senders. To make a lasting difference, you need to
      reduce the number of places your details sit, as well as filter what still gets through. If you want to see how
      exposed you are right now, you can{" "}
      <Link to="/scan?utm_source=blog&utm_medium=stop-spam-calls-texts-and-emails">run a free scan with MyPrivacyTOOL</Link>{" "}
      to check where your phone number and email may appear in broker listings and public sources.
    </p>

    <h2 id="spam-vs-scam">Step 1: Tell spam, scams and legitimate marketing apart</h2>
    <p>
      The right response depends on what you are dealing with, so it helps to sort unwanted contact into three groups
      before doing anything.
    </p>
    <h3>Legitimate marketing</h3>
    <p>
      This comes from a real business you have some link with, or one that has lawfully obtained your details. It
      identifies itself clearly, gives a genuine way to opt out, and honours the request. Unsubscribing here works, and
      in many jurisdictions the law requires it.
    </p>
    <h3>Spam</h3>
    <p>
      Spam is bulk, unsolicited and often irrelevant messaging, such as offers you never asked for, from senders with
      no real relationship to you. It may be sent by companies of questionable legality, and it is often the first
      stage of something worse.
    </p>
    <h3>Scams</h3>
    <p>
      Scams try to trick you into paying, handing over credentials or installing something harmful. Typical themes
      include missed parcel deliveries, unpaid tolls or fines, bank &quot;security alerts&quot;, tax refunds, fake
      job offers, investment tips and messages that begin with a wrong-number opener.
    </p>
    <h3>Red flags to watch for</h3>
    <ul>
      <li>Pressure to act right now, or threats such as account closure, arrest or fines.</li>
      <li>A link to log in or pay, especially a shortened link or a slightly misspelled domain.</li>
      <li>A request to move the conversation to another app or to keep it secret.</li>
      <li>Payment requested by gift card, cryptocurrency or transfer to a personal account.</li>
      <li>A caller who knows some of your details and treats that as proof they are genuine. Details are cheap to buy.</li>
      <li>An unexpected prize or refund that requires a fee first.</li>
    </ul>
    <blockquote>
      <p>
        <strong>Tip:</strong> If a message claims to be from your bank, a courier or a government agency, do not use the
        contact details it gives you. Close it, then find the organisation&apos;s official number from its website or the
        back of your card and contact them yourself.
      </p>
    </blockquote>
    <h3>Rules for handling each type</h3>
    <ul>
      <li>
        Never click links, reply, call back a number in the message, or press a key such as &quot;9&quot; to be removed
        when you suspect spam or a scam. These actions confirm that your number or address is live.
      </li>
      <li>Only unsubscribe from senders you recognise and have a genuine relationship with.</li>
      <li>When unsure, treat it as a scam. Deleting a real message costs little, and they will contact you again.</li>
    </ul>

    <h2 id="phones">Step 2: Stop spam calls and texts on your phone</h2>
    <p>
      Modern phones include solid filters. Turning them on takes a few minutes and removes a good share of the noise.
    </p>
    <h3>On iPhone</h3>
    <ol>
      <li>
        <strong>Silence Unknown Callers.</strong> In Settings, open Phone, then Silence Unknown Callers. Calls from
        numbers not in your contacts, recent outgoing calls or Siri suggestions go straight to voicemail and appear in
        your recents list without ringing. This is strong protection, but check voicemail regularly so you do not miss
        genuine callers.
      </li>
      <li>
        <strong>Call screening features.</strong> Recent versions of iOS offer features that screen unknown callers or
        show a live transcription of voicemail, depending on your model, region and software version. Look in the Phone
        settings on your device to see what is available.
      </li>
      <li>
        <strong>Filter Unknown Senders for messages.</strong> In Settings, open Messages and turn on Filter Unknown
        Senders. Messages from people not in your contacts are sorted into a separate list.
      </li>
      <li>
        <strong>Report Junk.</strong> If an iMessage arrives from someone not in your contacts, a Report Junk link
        appears under the message. Tapping it sends the message to Apple and your carrier, and deletes it.
      </li>
    </ol>
    <h3>On Android</h3>
    <ol>
      <li>
        <strong>Google Phone spam protection.</strong> In the Google Phone app, open Settings, then Caller ID and spam,
        and switch on Filter spam calls. Suspected spam is flagged or silenced. Availability varies by device and
        region.
      </li>
      <li>
        <strong>Call Screen.</strong> Where supported, Call Screen lets the assistant answer unknown calls and show you
        a transcript before you decide whether to pick up.
      </li>
      <li>
        <strong>Spam protection in Google Messages.</strong> In Google Messages settings, turn on spam protection so
        suspicious messages go to a Spam and blocked folder.
      </li>
    </ol>
    <p>
      Samsung and other manufacturers also add their own caller ID and spam features, so check your phone&apos;s call
      settings.
    </p>
    <h3>Carrier tools</h3>
    <p>
      Many carriers provide spam call labelling, SMS filtering or a number for reporting spam. Ask yours what is
      available, and whether it is on by default. These network-level filters catch messages before they reach your
      handset, and they can complement what your phone does.
    </p>
    <h3>Block and report</h3>
    <p>
      Blocking a number helps in the short term, but spammers cycle through many numbers and can spoof caller IDs, so
      do not expect blocking alone to fix things. Reporting is more valuable. Forward suspicious texts to your carrier
      or national reporting service (regional details are below) so that patterns can be detected and numbers shut
      down.
    </p>
    <h3>Why replying &quot;STOP&quot; to scam texts is a mistake</h3>
    <p>
      For legitimate businesses, replying STOP is the recognised way to opt out. For scammers, a reply of any kind tells
      them that a real person read the message on a working number. That can put you on a more valuable list. If you
      do not recognise the sender or the message looks suspicious, do not reply. Block, report and delete.
    </p>

    <h2 id="email">Step 3: Stop spam emails</h2>
    <h3>Use your provider&apos;s filters and train them</h3>
    <p>
      Gmail, Outlook, Apple Mail and other providers filter spam automatically, but they learn from what you do. When
      unwanted mail lands in your inbox, mark it as junk rather than just deleting it. This teaches the filter, and it
      helps protect other users too. Check your spam folder now and then for genuine messages that have been caught
      by mistake.
    </p>
    <h3>Unsubscribe safely</h3>
    <ul>
      <li>
        Use the unsubscribe option for newsletters and promotions from brands you know. Many mail apps show an
        unsubscribe button near the sender name, which is often safer than following a link in the body.
      </li>
      <li>Do not click unsubscribe on messages from unknown senders. Mark them as junk and move on.</li>
      <li>
        Look at the sender address carefully. Scam emails often use lookalike domains or a display name that matches a
        brand while the actual address does not.
      </li>
    </ul>
    <h3>Use email aliases and a separate sign-up address</h3>
    <p>
      An email alias is a different address that forwards to your real inbox. If an alias starts receiving spam, you
      know which service leaked or sold it, and you can switch it off without touching your main address.
    </p>
    <ul>
      <li>Apple&apos;s Hide My Email creates random forwarding addresses for iCloud users.</li>
      <li>
        Gmail plus-addressing lets you add a tag, such as yourname+shop@gmail.com, which still reaches your inbox and
        can be filtered. It is easy for a determined sender to strip the tag, but it works well for spotting leaks.
      </li>
      <li>Email alias services, including several privacy-focused ones, let you generate and disable addresses on demand.</li>
      <li>
        Keep a separate address for shopping, competitions and newsletters, and keep your primary address for banking,
        government and people you trust.
      </li>
    </ul>
    <h3>If you own a domain: SPF, DKIM and DMARC</h3>
    <p>
      If you run your own domain, three DNS-based settings make it harder for someone to send mail that pretends to be
      you. SPF lists the servers allowed to send for your domain. DKIM adds a digital signature that proves a message
      has not been altered. DMARC tells receiving servers what to do when a message fails those checks, and provides
      reports. Your email host or domain registrar usually has a guide for setting them up. They will not reduce the
      spam you receive, but they protect your name from being used to spam others.
    </p>
    <h3>Check whether your address has been breached</h3>
    <p>
      Search your email address on{" "}
      <a href="https://haveibeenpwned.com" target="_blank" rel="noopener noreferrer">
        Have I Been Pwned
      </a>
      . If it appears in a breach, change the password for that service and anywhere else you reused it, and turn on
      two-factor authentication. Expect more targeted phishing that mentions the breached service.
    </p>

    <h2 id="reduce-exposure">Step 4: Reduce your exposure at the source</h2>
    <p>
      Filters clean up what arrives. Reducing exposure limits what gets sent in the first place. This is slower, but
      it is what lowers the volume over time.
    </p>
    <ol>
      <li>
        <strong>Tighten privacy settings.</strong> On social media, hide your phone number and email from public
        profiles and from &quot;find people by phone number&quot; features. Review who can see your contact details on
        professional networking sites.
      </li>
      <li>
        <strong>Delete old accounts.</strong> Forgotten shopping, forum and app accounts hold your details and may be
        sitting in databases that will one day be breached. Use your password manager or email search for old
        &quot;welcome&quot; messages to find them.
      </li>
      <li>
        <strong>Opt out of data brokers.</strong> Each broker has its own opt-out process, often requiring you to find
        your listing, submit a form and confirm by email. Repeat it periodically because listings can reappear. Our
        guide on{" "}
        <Link to="/blog/remove-personal-information-from-internet">removing personal information from the internet</Link>{" "}
        explains the process. You can also{" "}
        <Link to="/scan?utm_source=blog&utm_medium=stop-spam-calls-texts-and-emails">start with a free scan</Link> to
        see where your details appear, and use removal to cut the source rather than chasing each sender.
      </li>
      <li>
        <strong>Be stingy with your phone number.</strong> Loyalty programs, shop checkouts and website forms often ask
        for a number that they do not need. If it is optional, leave it blank. If they insist, ask why.
      </li>
      <li>
        <strong>Tick the marketing opt-out boxes.</strong> Read the consent wording on forms. Untick boxes that agree
        to marketing or sharing with partners. Keep a note of the forms where you could not.
      </li>
      <li>
        <strong>Clean up search results.</strong> Public pages that list your contact details can be scraped. See
        our guide on{" "}
        <Link to="/blog/remove-your-name-and-info-from-google">removing your name and info from Google</Link> for how
        to request removals.
      </li>
    </ol>

    <h2 id="do-not-call">Step 5: Register on Do-Not-Call lists</h2>
    <p>
      Many countries operate a Do-Not-Call (DNC) register. You add your number, and organisations that want to market
      to you by phone or message must check the register and avoid the numbers on it. It costs nothing and takes
      minutes.
    </p>
    <p>
      Two limitations are worth understanding. First, DNC lists bind legitimate organisations that follow the law.
      Scammers ignore them. Second, there are usually exemptions, and registration takes effect after a delay, so
      calls do not stop overnight. The next section gives details for Hong Kong, Singapore and Australia. In other
      countries, search for your national regulator&apos;s DNC page.
    </p>

    <h2 id="apac">Hong Kong, Singapore and Australia: local rules and tools</h2>
    <blockquote>
      <p>
        <strong>Note:</strong> This section is general information, not legal advice. Rules, hotline numbers and
        procedures change, so verify current details with the regulator before relying on them.
      </p>
    </blockquote>

    <h3>Hong Kong</h3>
    <ul>
      <li>
        <strong>Do-Not-Call registers.</strong> Under the Unsolicited Electronic Messages Ordinance (UEMO, Cap. 593),
        the Office of the Communications Authority (OFCA) maintains Do-Not-Call registers. These have covered
        pre-recorded telephone messages, short messages (SMS) and fax, and person-to-person telemarketing calls may
        also be covered. Check{" "}
        <a href="https://www.ofca.gov.hk" target="_blank" rel="noopener noreferrer">
          ofca.gov.hk
        </a>{" "}
        for the current list of registers and how to register, which is free.
      </li>
      <li>
        <strong>Direct marketing opt-out.</strong> Under section 35G of the Personal Data (Privacy) Ordinance (PDPO),
        if an organisation is using your personal data for direct marketing, you can ask it to stop, and it must comply
        without charge. The Privacy Commissioner for Personal Data publishes guidance at{" "}
        <a href="https://www.pcpd.org.hk" target="_blank" rel="noopener noreferrer">
          pcpd.org.hk
        </a>
        .
      </li>
      <li>
        <strong>SMS Sender Registration Scheme.</strong> Under this scheme, registered organisations send messages
        under sender IDs that begin with a &quot;#&quot; prefix. A text that claims to be from a bank or government
        department but lacks the prefix deserves extra suspicion. Details of participants and how the scheme works
        can change, so check the official guidance and, when in doubt, contact the organisation through its own
        published channels.
      </li>
      <li>
        <strong>Scameter and Scameter+.</strong> The Hong Kong Police Force&apos;s Anti-Deception Coordination Centre
        offers Scameter and Scameter+ for checking suspicious phone numbers, URLs, email addresses and payment
        accounts. The Anti-Scam Helpline is 18222. See{" "}
        <a href="https://www.police.gov.hk" target="_blank" rel="noopener noreferrer">
          police.gov.hk
        </a>
        .
      </li>
      <li>
        <strong>+852 call-ID warnings.</strong> Calls that appear to come from a local +852 number but actually route
        from overseas may display a warning on some networks. Treat any such warning seriously, and be careful with
        calls claiming to be from a local authority.
      </li>
    </ul>

    <h3>Singapore</h3>
    <ul>
      <li>
        <strong>Do Not Call (DNC) Registry.</strong> Run by the Personal Data Protection Commission (PDPC) under the
        Personal Data Protection Act (PDPA), it has three registers: voice call, text message and fax. Registration is
        free. It takes effect after a 30-day grace period, and it applies to marketing messages sent to Singapore
        numbers by organisations. It does not stop scammers. You can register online through the PDPC&apos;s DNC
        pages or by SMS, and the site sets out the current process.
      </li>
      <li>
        <strong>Complaints.</strong> If an organisation keeps contacting you after the grace period, you can complain
        to the PDPC. Keep a record of the date, number and what was said.
      </li>
      <li>
        <strong>Spam Control Act.</strong> This law covers unsolicited commercial electronic messages sent in bulk
        by email or SMS. Senders are generally required to provide a working unsubscribe facility and to follow
        labelling requirements. Check the current rules on the regulator&apos;s site.
      </li>
      <li>
        <strong>ScamShield.</strong> The ScamShield app, backed by the Singapore Police Force and the National Crime
        Prevention Council, filters suspected scam calls and SMS. The ScamShield helpline is 1799.
      </li>
      <li>
        <strong>SMS Sender ID Registry.</strong> Organisations can register their sender IDs, so messages that carry
        an unregistered ID may be labelled as likely scams by networks. The precise labelling can change, so treat it as
        a warning sign rather than a guarantee.
      </li>
      <li>
        <strong>Police reporting.</strong> Use 999 for emergencies. For non-emergency scam reporting, the Singapore
        Police Force lists a scam line, currently understood to be 1800-255-0000, and online options at{" "}
        <a href="https://www.police.gov.sg" target="_blank" rel="noopener noreferrer">
          police.gov.sg
        </a>
        . Confirm the number on the site before calling.
      </li>
    </ul>

    <h3>Australia</h3>
    <ul>
      <li>
        <strong>Do Not Call Register.</strong> Run by the Australian Communications and Media Authority (ACMA) at{" "}
        <a href="https://www.donotcall.gov.au" target="_blank" rel="noopener noreferrer">
          donotcall.gov.au
        </a>
        . Registration is free and permanent, so you do not need to renew. Telemarketers must check the list before
        calling, and after you register, there is a period of about 30 days before the rule applies.
      </li>
      <li>
        <strong>Exemptions.</strong> Some organisations may still call you, including charities, political parties,
        researchers and government bodies. You can ask an individual caller to stop contacting you.
      </li>
      <li>
        <strong>Spam Act 2003.</strong> Commercial electronic messages, such as email and SMS, generally need your
        consent, must identify the sender, and must include a working unsubscribe option. Senders must act on
        unsubscribe requests within five business days.
      </li>
      <li>
        <strong>Reporting spam.</strong> Forward spam SMS to 0429 999 888 and spam email to spam@submit.acma.gov.au.
        These reports feed ACMA&apos;s monitoring.
      </li>
      <li>
        <strong>Scams.</strong> Report at{" "}
        <a href="https://www.scamwatch.gov.au" target="_blank" rel="noopener noreferrer">
          scamwatch.gov.au
        </a>{" "}
        and, for cybercrime, at{" "}
        <a href="https://www.cyber.gov.au" target="_blank" rel="noopener noreferrer">
          cyber.gov.au
        </a>{" "}
        through ReportCyber. The National Anti-Scam Centre coordinates the national response.
      </li>
      <li>
        <strong>Identity theft support.</strong> IDCARE at{" "}
        <a href="https://www.idcare.org" target="_blank" rel="noopener noreferrer">
          idcare.org
        </a>{" "}
        provides free help if your identity documents or details have been compromised.
      </li>
    </ul>

    <h3>Quick reference: Do-Not-Call registries</h3>
    <table>
      <thead>
        <tr>
          <th>Country</th>
          <th>Registry and run by</th>
          <th>Cost</th>
          <th>When it takes effect</th>
          <th>What it does not stop</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Hong Kong</td>
          <td>OFCA Do-Not-Call registers under UEMO (check current list)</td>
          <td>Free</td>
          <td>Check OFCA for timing</td>
          <td>Scammers, exempt or non-covered messages</td>
        </tr>
        <tr>
          <td>Singapore</td>
          <td>DNC Registry (voice, text, fax), run by PDPC</td>
          <td>Free</td>
          <td>After a 30-day grace period</td>
          <td>Scammers, and messages outside the PDPA&apos;s scope</td>
        </tr>
        <tr>
          <td>Australia</td>
          <td>Do Not Call Register, run by ACMA</td>
          <td>Free</td>
          <td>Around 30 days; registration is permanent</td>
          <td>Scammers, and exempt callers such as charities and political parties</td>
        </tr>
      </tbody>
    </table>

    <h2 id="reporting">Step 6: Report spam and scams</h2>
    <p>
      Reporting can feel pointless, but it is how numbers get blocked and how regulators build cases. It takes a
      minute.
    </p>
    <ul>
      <li>Forward or screenshot the message, and note the date and time, the number or address and any links.</li>
      <li>
        Report to your phone or mail provider first. Use the built-in Report Junk, Report spam or Mark as junk options.
      </li>
      <li>
        Report to your national regulator or scam body, using the details in the section above, such as Scameter in
        Hong Kong, ScamShield in Singapore, or ACMA and Scamwatch in Australia.
      </li>
      <li>If you lost money or shared credentials, also report to the police, as covered below.</li>
    </ul>
    <p>
      Do not include live links when forwarding to friends as a warning. Use screenshots instead.
    </p>

    <h2 id="already-engaged">What to do if you have already engaged or fallen for a scam</h2>
    <p>
      Do not be embarrassed. Scams are designed by professionals, and many careful people have been caught. What
      matters is how quickly you act.
    </p>
    <ol>
      <li>
        <strong>Stop contact.</strong> Do not reply or send more money. Do not call back a number given by the
        scammer.
      </li>
      <li>
        <strong>Contact your bank or card provider immediately</strong> using the number on your card or the official
        app. Ask them to block or reverse the payment if possible, and to watch the account. Speed can make a real
        difference.
      </li>
      <li>
        <strong>Change passwords</strong> for anything you entered on a suspicious page, plus any account using the same
        password. Turn on two-factor authentication, ideally with an authenticator app rather than SMS.
      </li>
      <li>
        <strong>Check your devices.</strong> If you installed an app or gave remote access, disconnect from the
        internet, remove the app and run a security scan. Seek professional help if you are unsure.
      </li>
      <li>
        <strong>Report to the police</strong> and the scam reporting body in your country. Keep screenshots, receipts
        and transaction details. In Australia, consider IDCARE if identity documents were involved.
      </li>
      <li>
        <strong>Watch for follow-up &quot;recovery&quot; scams.</strong> People who have lost money are often
        contacted by others claiming they can get it back for a fee. Genuine police and regulators do not charge to
        recover funds.
      </li>
      <li>
        <strong>Monitor your accounts</strong> and consider a credit report check, or a credit freeze where your country
        offers one.
      </li>
    </ol>

    <h2 id="expectations">Realistic expectations: what each tool does and does not stop</h2>
    <p>
      No single tool eliminates spam. Layering several tools gives the best result, and the table below shows why.
    </p>
    <table>
      <thead>
        <tr>
          <th>Tool</th>
          <th>Helps with</th>
          <th>Does not stop</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Phone silencing and call filtering</td>
          <td>Unknown and suspected spam calls</td>
          <td>Genuine calls from unsaved numbers may be missed; spoofed numbers can slip through</td>
        </tr>
        <tr>
          <td>Blocking numbers</td>
          <td>Repeat callers and texters</td>
          <td>New or spoofed numbers</td>
        </tr>
        <tr>
          <td>Carrier and SMS filtering</td>
          <td>Known spam and scam patterns</td>
          <td>Brand-new campaigns</td>
        </tr>
        <tr>
          <td>Do-Not-Call registers</td>
          <td>Lawful telemarketing from organisations</td>
          <td>Scammers, and exempt organisations</td>
        </tr>
        <tr>
          <td>Email filters and junk marking</td>
          <td>Bulk unwanted mail and phishing</td>
          <td>Well-crafted targeted phishing</td>
        </tr>
        <tr>
          <td>Email aliases</td>
          <td>Tracing leaks, switching off compromised addresses</td>
          <td>Spam to your existing address</td>
        </tr>
        <tr>
          <td>Data broker removal</td>
          <td>Cutting a major supply of your details to marketers</td>
          <td>Random dialers and older leaked data</td>
        </tr>
        <tr>
          <td>Your own judgement</td>
          <td>Recognising scams at the moment of contact</td>
          <td>Nothing, but it must be used every time</td>
        </tr>
      </tbody>
    </table>
    <p>
      Expect improvement over weeks and months, not days. Removing your data reduces the stream gradually, as lists
      age and are not refreshed with your details.
    </p>

    <h2 id="maintenance">A simple maintenance checklist</h2>
    <p>
      Spam control is not a one-off job. Set aside a few minutes each quarter to keep things tidy.
    </p>
    <ul>
      <li>Check that call and message filtering is still switched on after phone updates.</li>
      <li>Confirm your Do-Not-Call registration is active in each country where you hold a number.</li>
      <li>Review your email spam folder and unsubscribe from newsletters you no longer read.</li>
      <li>Search your email address on Have I Been Pwned for new breaches.</li>
      <li>Close accounts you no longer use and update passwords for any that were breached.</li>
      <li>Use an alias or a separate address for new sign-ups, and skip optional phone number fields.</li>
      <li>
        Re-check where your details appear. Broker listings can reappear, so an occasional{" "}
        <Link to="/scan?utm_source=blog&utm_medium=stop-spam-calls-texts-and-emails">free scan</Link> is a sensible
        habit.
      </li>
      <li>Report anything new and suspicious rather than only deleting it.</li>
    </ul>
    <p>
      This guide gives general information only, and it is not legal advice. Laws, registers, hotline numbers and app
      features change, so verify current procedures with the relevant regulator or provider before you act.
    </p>
  </>
);

export default Content;
