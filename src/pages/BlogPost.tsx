import React, { useEffect, useRef } from 'react';
import FeatureStatus from "@/components/FeatureStatus";
import { Helmet } from 'react-helmet';
import Seo from '@/components/Seo';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Share2, Copy } from 'lucide-react';
import { HEXAGONS, HEXAGON_GROUPS, HEXAGON_COUNT, HEXAGON_ALWAYS_COUNT } from '../../shared/hexagon-registry/registry.js';
import { countSentence } from '../../shared/hexagon-registry/countSentence.js';
import blogPosts from '@/data/blogPosts.json';
import { guides } from '@/content/guides';
import { trackBlogCtaClick, trackBlogPostView, trackBlogScrollDepth } from '@/lib/analytics';
import { blogCtaDestination, blogCtaHref, newlyReachedThresholds, scrollDepthPercent } from '@/lib/blogTracking';

const SITE_URL = 'https://www.myprivacytool.io';

const toIsoDate = (d: string) => {
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
};

const blogContent: { [key: string]: React.ReactNode } = {
  "how-exposed-are-you": (
      <div className="article article-headings:text-foreground article-p:text-foreground article-li:text-foreground article-strong:text-foreground article-a:text-brand max-w-none">
        <p>Your personal data is everywhere. Not because you posted it, and not because you signed up willingly. Brokers, marketers, data aggregators, and forgotten websites have been collecting, trading, and selling pieces of you for years.</p>
        <p>You probably know some of this happens. But do you know how much of your information is out there, where it lives, and what someone could do with it? That is what MyPrivacyTOOL is built to help you answer.</p>

        <h2>The Scale of the Exposure</h2>
        <p>Every day, your data moves. When you fill out a form online, even a simple contact submission, that information does not stay in one place. It can be sold, aggregated, and cross-referenced with other datasets. By the time you close the browser tab, your name, email, phone number, and address may already be held by companies you have never heard of.</p>
        <p>This is the data broker industry. People-search sites such as Whitepages, PeopleFinders, and Spokeo exist to collect, organize, and sell personal information. They draw on public records, scrape social media, and buy lists from other brokers, then sell access to marketers, employers, landlords, and anyone else willing to pay. The result is a fragmented portrait of you, scattered across hundreds of databases, most of which you do not know exist.</p>
        <p>Add the data you did leave behind on purpose: social media profiles, old email accounts, forgotten job applications, abandoned shopping carts, archived forum posts. These can sit online indefinitely, indexed by search engines and open to anyone.</p>
        <p>Then there are breaches. Large companies lose customer data regularly. Equifax exposed about 147 million people in 2017, and Yahoo has said that all three billion of its accounts were affected by its 2013 breach. Each breach can put another copy of your information in circulation.</p>
        <p>The question is not whether your data is exposed. It is how exposed, and what can be done about it.</p>

        <h2>The 54 Privacy Vectors Exposing Your Data</h2>
        <p>{countSentence()}. We've identified distinct sources where your personal information is currently exposed:<FeatureStatus feature="F9" /></p>

        {/* MPC-9832: the real 54 web-scan hexagons, grouped by the registry's own groups. Rendered from the registry so the
            list and its counts cannot drift from the scan again (the old hand-written lists added up to 46). */}
        {HEXAGON_GROUPS.map((group) => {
          const items = HEXAGONS.filter((h) => h.group === group);
          return (
            <React.Fragment key={group}>
              <h3>{group} ({items.length})</h3>
              <ul>
                {items.map((h) => (
                  <li key={h.id}>{h.label}</li>
                ))}
              </ul>
            </React.Fragment>
          );
        })}
        <p>{HEXAGON_ALWAYS_COUNT} of the {HEXAGON_COUNT} run on every scan; the other {HEXAGON_COUNT - HEXAGON_ALWAYS_COUNT} run only when your device offers them.</p>

        <h2>Why You Should Care</h2>
        <p>Privacy is not about having something to hide. It is about control: knowing what information exists in your name and deciding who gets to see it. When your data is exposed:</p>
        <ul>
          <li><strong>Marketers learn your vulnerabilities.</strong> They track your browsing and build behavioral profiles of what you search for, buy, and care about, then target you with precision.</li>
          <li><strong>Scammers get a roadmap.</strong> A name, address, phone number, and email are the raw material of social engineering. With them, someone can impersonate you, attempt password resets, or call your bank pretending to be you.</li>
          <li><strong>Employers and landlords decide on incomplete information.</strong> An old record, a negative review, or a name mix-up with someone else can cost you an opportunity without you ever knowing why.</li>
          <li><strong>Your safety can be at risk.</strong> For journalists, activists, and survivors of abuse, an exposed address or phone number is a physical threat. Data brokers do not distinguish between private citizens and people in danger.</li>
          <li><strong>Your autonomy shrinks.</strong> When you are tracked, categorized, and targeted constantly, you are being nudged and sorted into groups that can shape the prices you see and the information that reaches you.</li>
        </ul>
        <p>Privacy underpins dignity, autonomy, and safety. When it is gone, everything else becomes negotiable.</p>

        <h2>How MyPrivacyTOOL Works</h2>
        <p>Most privacy tools start by selling you removal. MyPrivacyTOOL starts with visibility, because you cannot manage what you cannot see.</p>
        <ol>
          <li><strong>Run your scan.</strong> Enter your details and the free scan checks data brokers for your information.</li>
          <li><strong>See what was found.</strong> Each broker is shown as listed, not listed, or not checked, with an evidence link, so you can see what was actually checked rather than a vague score.</li>
          <li><strong>Understand the exposure.</strong> Know what information is exposed, who can access it, and what someone could do with it.</li>
          <li><strong>Take control.</strong> Follow our step-by-step opt-out guides to remove or restrict your listings at brokers that allow it. Some opt-outs take minutes. Others take waiting, paperwork, or a paid service, and we say so up front.</li>
        </ol>
        <p>Automated removal requests<FeatureStatus feature="F4" /> and breach monitoring with alerts<FeatureStatus feature="F5" /> are not live yet, and we label them so you can see what works today and what is still coming.</p>

        <h2>What Makes This Different</h2>
        <ul>
          <li><strong>We show what we checked, and what we did not.</strong> A result marked not checked is not the same as clear, and we do not blur the two.</li>
          <li><strong>We do not use fear to sell.</strong> We tell you what is exposed and what it can mean. If your exposure is small, we will tell you that too.</li>
          <li><strong>We explain the why.</strong> Privacy is not abstract. We show what could happen if specific data is exposed, to inform you rather than to frighten you.</li>
          <li><strong>We give you control, not false security.</strong> We do not claim to protect you forever. Some removals are permanent and some need repeating, and we are honest about which is which.</li>
        </ul>

        <h2>Your Privacy, Your Choice</h2>
        <p>You did not choose to be in these databases, but you can choose what happens next. Take the scan, see your exposure, understand what it means, and then decide what to do.</p>
        <p>The map changes weekly as new brokers emerge and existing ones evolve. A one-time fix isn't enough, so regular removal rounds help keep your footprint small.</p>
      </div>
  ),
  "25-years-mass-surveillance": (
      <div className="article article-headings:text-foreground article-p:text-foreground article-li:text-foreground article-strong:text-foreground article-a:text-brand max-w-none">
        <p>A generation has grown up under constant digital surveillance. From CCTV networks to smartphone tracking, we've normalized the abnormal. It's time to ask for a different future.</p>
        
        <h2>The Timeline: How We Got Here</h2>
        
        <h3>2001 — The PATRIOT Act & The Beginning</h3>
        <p>After 9/11, governments were given unprecedented surveillance powers. The PATRIOT Act authorized bulk data collection without individual warrants. What was supposed to be temporary became permanent infrastructure.</p>
        
        <h3>2007 — The Smartphone Era</h3>
        <p>The iPhone launched, and with it, a new vector: location tracking. Every smartphone became a tracking device, with Apple, Google, and app developers collecting your movement history. GPS, cellular, and WiFi triangulation made it impossible to move without leaving a digital trail.</p>
        
        <h3>2013 — The Snowden Revelations</h3>
        <p>Edward Snowden revealed the scope: the NSA was collecting billions of phone records daily, the GCHQ was tapping undersea cables, and Silicon Valley tech companies were forwarding user data to intelligence agencies under secret court orders.</p>
        
        <p>Surveillance continued, now with public knowledge.</p>
        
        <h3>2015–2020 — The Data Broker Boom</h3>
        <p>Private companies saw a market in selling collected data. ZoomInfo, Apollo, Hunter, Clearbit, and hundreds of smaller brokers scraped the web and resold profiles to sales teams, marketers, and private investigators.</p>
        
        <h3>2020–2024 — AI Training</h3>
        <p>All of your collected data — public profiles, deleted tweets, medical records, shopping history, location data, chat logs — was fed into AI models. Now, AI can predict your behavior, preferences, and vulnerabilities better than you can yourself.</p>
        
        <h2>What We've Normalized</h2>
        
        <p>Ask a teenager today if they'd accept this deal: "Let us watch everywhere you go, everything you buy, everyone you talk to, and everything you read. In exchange, a free app and personalized ads."</p>
        
        <p>They would say no.</p>
        
        <p>But ask a 35-year-old who grew up before smartphones, and they'll tell you: this is the trade-off of modern life. No alternatives exist.</p>
        
        <p>Except they do. And we've normalized away the fact that they do.</p>
        
        <h3>Surveillance Technologies We Accept Without Question:</h3>
        <ul>
          <li><strong>Location tracking:</strong> Our phones report our location to governments, tech companies, and advertisers in real-time</li>
          <li><strong>Facial recognition:</strong> Deployed at airports, borders, and increasingly on streets without consent or oversight</li>
          <li><strong>Cell-site simulators (Stingrays):</strong> Law enforcement uses fake cell towers to intercept calls and track location, often without warrants</li>
          <li><strong>Financial surveillance:</strong> Every bank transaction, crypto transaction, and credit card purchase is logged, analyzed, and shared</li>
          <li><strong>Digital forensics on your devices:</strong> Police can extract all data from your phone if you're stopped</li>
          <li><strong>Email & chat interception:</strong> End-to-end encryption is still not the default; most messages pass through unencrypted servers</li>
          <li><strong>DNA databases:</strong> Police build genetic profiles without consent, using family members' data</li>
          <li><strong>Workplace surveillance:</strong> Employers track mouse movement, keystroke activity, camera feeds, and location</li>
        </ul>
        
        <h2>What Is at Stake</h2>
        
        <p>The main concern with 25 years of surveillance is not only what is collected, but how that data can be misused:</p>
        
        <ul>
          <li><strong>Political manipulation:</strong> Detailed profiles of voters used to target propaganda with surgical precision (we're seeing this now)</li>
          <li><strong>Discrimination:</strong> Employers, landlords, and insurance companies using algorithmic profiles to deny opportunities</li>
          <li><strong>Blackmail & extortion:</strong> Access to intimate data being used against individuals</li>
          <li><strong>Authoritarian control:</strong> In countries with repressive regimes, this data becomes a tool of oppression</li>
          <li><strong>Systemic oppression:</strong> Minority communities are disproportionately surveilled and tracked by law enforcement</li>
        </ul>
        
        <h2>Why Opting Out Isn't the Answer</h2>
        
        <p>Privacy advocates will tell you: delete your apps, use a VPN, encrypt your messages. True. These are necessary. But they're not sufficient.</p>
        
        <p>Why? Because you're surrounded by 8 billion other people who didn't opt out. The data brokers don't need your phone — they can buy your profile from someone who sold their phone.</p>
        
        <p>The issue isn't personal. It's systemic.</p>
        
        <h2>What Real Change Looks Like</h2>
        
        <h3>1. Regulate Surveillance Tech, Not Just Use</h3>
        <p>Cell-site simulators, facial recognition, and predictive policing should require warrants, not departmental oversight. GDPR-style regulations should apply to governments, not just companies.</p>
        
        <h3>2. Require Consent For Data Brokers</h3>
        <p>The FTC should ban the sale of personal profiles without explicit opt-in. Europe's GDPR requires this. The US should too.</p>
        
        <h3>3. Sunset Mass Surveillance Programs</h3>
        <p>Programs like bulk phone metadata collection were authorized under emergency powers. Those emergencies are 25 years old. Sunsets are necessary.</p>
        
        <h3>4. Default Encryption Everywhere</h3>
        <p>All messages, emails, and online file storage should be end-to-end encrypted by default. No backdoors for governments.</p>
        
        <h3>5. Right to Deletion & Audit</h3>
        <p>You should have the right to know what data is held about you, who holds it, and how to delete it. GDPR's CCPA's model works.</p>
        
        <h2>The Generation That Doesn't Know What Privacy Is</h2>
        
        <p>Kids born after 2007 have never lived in a world without persistent location tracking. They've never had a meaningful conversation without considering that it might be recorded or analyzed. They've never made a choice without knowing it's being profiled.</p>
        
        <p>This is not normal. It's not inevitable. And it doesn't have to continue.</p>
        
        <h2>What You Can Do</h2>
        
        <ul>
          <li><strong>Vote for privacy:</strong> Support politicians who prioritize data protection and surveillance limits</li>
          <li><strong>Join privacy organizations:</strong> EFF, Access Now, Privacy International are building the movement</li>
          <li><strong>Opt out individually:</strong> While systemic change happens, reduce your own exposure</li>
          <li><strong>Demand transparency:</strong> Companies and governments should disclose what data they hold and how it's used</li>
          <li><strong>Educate others:</strong> Most people don't know the scope of surveillance. Awareness is the first step</li>
        </ul>
      </div>
  ),
  "linkedin-data-brokers": (
      <div className="article article-headings:text-foreground article-p:text-foreground article-li:text-foreground article-strong:text-foreground article-a:text-brand max-w-none">
        <p>LinkedIn says your profile is yours to control. But companies like Apollo, ZoomInfo, Lusha, and Clearbit are legally scraping your entire profile — every job, school, skill, and connection — and reselling it to thousands of sales teams and recruiters.</p>
        
        <h2>How Your LinkedIn Data Is Collected</h2>
        <p>LinkedIn's ToS technically forbids scraping. But enforcement is almost nonexistent, and the data is too valuable to ignore. These brokers operate in a gray zone:</p>
        
        <ul>
          <li><strong>Apollo & Hunter.io:</strong> Scrape profiles and match them to business email addresses, then sell access to sales teams</li>
          <li><strong>ZoomInfo:</strong> Largest B2B database; openly advertises having 2B+ contact profiles</li>
          <li><strong>Lusha & Rocketreach:</strong> Tier-2 scrapers with 10-50M profiles each</li>
          <li><strong>Clearbit:</strong> Acquired by HubSpot; now embedded in sales automation workflows</li>
        </ul>
        
        <h2>What They Know About You</h2>
        <p>A typical scrape includes:</p>
        <ul>
          <li>Full name, location, phone (if public)</li>
          <li>Complete job history with dates</li>
          <li>Education and credentials</li>
          <li>Skills and endorsements</li>
          <li>Company size and industry signals</li>
          <li>Inferred seniority and decision-making authority</li>
          <li>Email address (matched via various databases)</li>
        </ul>
        
        <p>A sales recruiter can now see: you're a mid-market CMO, recently switched companies, have expertise in SaaS, and are probably in-market for new tools. Targeted outreach — sometimes 50+ messages per week — begins immediately.</p>
        
        <h2>How to Protect Yourself</h2>
        
        <h3>1. Limit What You Share</h3>
        <ul>
          <li>Set your profile to "Private" (not Public Search Results)</li>
          <li>Remove your phone number if it's not critical</li>
          <li>Be vague about current location if possible</li>
          <li>Turn off activity broadcasts</li>
        </ul>
        
        <h3>2. Opt Out Where Possible</h3>
        <p>Most brokers have opt-out mechanisms:</p>
        <ul>
          <li>ZoomInfo: <code>zoominfo.com/b/optout</code></li>
          <li>Apollo: Apollo.io/opt-out (limited effectiveness)</li>
          <li>Hunter.io: Hunter.io/opt-out</li>
          <li>Clearbit: clearbit.com/privacy</li>
        </ul>
        <p><em>Note:</em> Opt-outs take 30-90 days and often require re-opting after scrapers refresh their data.</p>
        
        <h3>3. Use a Separate Email for LinkedIn</h3>
        <p>If you use a unique email for LinkedIn that differs from your professional email, it becomes much harder to match and resell your profile across brokers.</p>
        
        <h2>The Bigger Picture</h2>
        <p>LinkedIn is a privacy trade-off: you gain network visibility in exchange for your data being commodified. That's the deal. But knowing the scope of that deal — and taking active steps to limit it — is the only protection available.</p>
      </div>
  ),
  "ai-training-data-opt-out": (
      <div className="article article-headings:text-foreground article-p:text-foreground article-li:text-foreground article-strong:text-foreground article-a:text-brand max-w-none">
        <p>Every tweet, Reddit comment, blog post, and public profile you've ever published is now part of an AI training dataset. OpenAI, Google, Meta, and dozens of startups have already ingested billions of lines of your data into their models. The question is no longer "is my data in AI?" — it's "where can I opt out?"</p>
        
        <h2>How Your Data Became AI Training Material</h2>
        
        <h3>Common Crawl: The Foundation</h3>
        <p>Most large language models start with <strong>Common Crawl</strong>, a free, open dataset of the entire indexed web. It contains:</p>
        <ul>
          <li>Every public blog post ever published</li>
          <li>All Wikipedia content</li>
          <li>Forum discussions and Q&A sites</li>
          <li>News articles and press releases</li>
          <li>Academic papers and research</li>
        </ul>
        <p>Common Crawl snapshots are released quarterly and are used by OpenAI (GPT), Google (Gemini), Meta (LLaMA), Anthropic (Claude), Mistral, Stability AI, and hundreds of smaller AI labs.</p>
        
        <h3>Specialized Datasets: The Targeted Scrapes</h3>
        <p>Beyond Common Crawl, AI labs also scrape:</p>
        <ul>
          <li><strong>Reddit:</strong> 100M+ posts used for training conversational models (users did not opt in)</li>
          <li><strong>GitHub:</strong> 2M+ public repositories for code generation (Copilot, CodeT5)</li>
          <li><strong>Stack Overflow:</strong> Q&A content for technical models</li>
          <li><strong>YouTube transcripts:</strong> Video captions for multimodal models</li>
          <li><strong>Twitter/X:</strong> Public tweets for sentiment and language patterns</li>
          <li><strong>Goodreads & book metadata:</strong> For literary training</li>
          <li><strong>Scientific papers:</strong> ArXiv, PubMed for domain-specific models</li>
        </ul>
        
        <h2>What This Means For Your Privacy</h2>
        
        <p>Your data in AI models raises several privacy concerns:</p>
        
        <h3>1. Information Leakage</h3>
        <p>AI models can sometimes reproduce exact training data if prompted correctly. A researcher at DeepMind demonstrated that GPT-3 could reproduce verbatim personal information (SSNs, addresses, phone numbers) when the model had been trained on scraped datasets containing this data.</p>
        
        <h3>2. Membership Inference</h3>
        <p>Researchers can determine if your data was in the training set by submitting queries and analyzing the model's confidence and output patterns. This "membership inference" attack works even on large models.</p>
        
        <h3>3. Commercial Reuse Without Consent</h3>
        <p>Your words — your thoughts, your writing, your expertise — are now part of a product that generates billions in value. You received no compensation, and no one asked permission.</p>
        
        <h3>4. Impersonation Risk</h3>
        <p>If your writing style and ideas are part of a model's training data, someone could use that model to impersonate you convincingly or generate content falsely attributed to your voice.</p>
        
        <h2>How to Opt Out (The Current Options)</h2>
        
        <h3>1. Block Common Crawl (robots.txt)</h3>
        <p>If you own a website, add this to your <code>robots.txt</code> file:</p>
        <pre><code>User-agent: CCBot
Disallow: /</code></pre>
        <p><strong>Limitation:</strong> This only prevents <em>future</em> crawls. Common Crawl's existing snapshots (released quarterly going back to 2013) already contain your content. Opting out now won't remove past data.</p>
        
        <h3>2. Platform-Level Opt-Out Requests</h3>
        <p><strong>OpenAI:</strong> Use the <code>https://openai.com/form/privacy-requests</code> form to request removal from ChatGPT training (note: this only removes your data from <em>future training</em>, not existing models).</p>
        <p><strong>Google:</strong> File a removal request through Google's <code>Google-Extended</code> opt-out mechanism (robots.txt: <code>User-agent: Googlebot-Extended Disallow: /</code>).</p>
        <p><strong>Reddit:</strong> You cannot opt out of past scraping, but you can delete your account and all historical posts. Reddit's new API terms (2024) now restrict scraping, so future data should be better protected.</p>
        <p><strong>GitHub:</strong> Use <code>Settings → Copilot → Block matching public code</code> to prevent future training on your repos, though past training is not reversed.</p>
        
        <h3>3. Delete Your Content (Most Thorough Option)</h3>
        <p>The only way to guarantee your data is not in AI models going forward is to delete it entirely:</p>
        <ul>
          <li>Delete old blog posts and archives</li>
          <li>Remove Reddit posts (use a tool like Pushshift if available, or manually delete)</li>
          <li>Untag yourself from social media</li>
          <li>Make archived content private</li>
        </ul>
        <p><strong>This doesn't remove past training data</strong> — it just prevents new scrapers from finding it in the future.</p>
        
        <h3>4. Contact AI Labs Directly (Formal Request)</h3>
        <p>Some AI labs accept formal GDPR/CCPA removal requests if you're in a jurisdiction that grants that right:</p>
        <ul>
          <li><strong>Anthropic:</strong> privacy@anthropic.com</li>
          <li><strong>OpenAI:</strong> privacy@openai.com</li>
          <li><strong>Google DeepMind:</strong> privacy@deepmind.com</li>
        </ul>
        <p>These requests vary in effectiveness. GDPR gives you strong removal rights in the EU, but US privacy laws are weaker.</p>
        
        <h2>What Opting Out Can and Cannot Do</h2>
        <p>Opting out today only stops future training. Data already used in training cannot be removed from existing models with current technology.</p>
        
        <p>The real protection comes from:</p>
        <ol>
          <li><strong>Regulatory pressure:</strong> Pushing for laws that require AI labs to respect opt-out requests (like the GDPR rights being tested in court now)</li>
          <li><strong>Data minimization:</strong> Reducing what you post publicly going forward</li>
          <li><strong>Transparency:</strong> Knowing which models have your data and how it's used</li>
        </ol>
        
        <h2>What's Coming Next</h2>
        <p>The AI industry is fragmenting into two camps:</p>
        <p><strong>Open models</strong> (Meta's LLaMA, Mistral) that publicly disclose training data sources, making opt-outs easier to track.</p>
        <p><strong>Closed models</strong> (OpenAI's GPT-4, Google Gemini) that provide no visibility into training data, making accountability almost impossible.</p>
        
        <p>If you care about privacy, supporting open models and pushing for transparency laws is as important as opting out today.</p>
      </div>
  ),
};

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const meta = slug ? blogPosts.find((p) => p.slug === slug) : undefined;

  const guide = slug ? guides[slug] : undefined;

  const articleRef = useRef<HTMLDivElement>(null);

  // Blog funnel tracking (runbook step 6): one view per post, then scroll depth at 25/50/75/100%.
  useEffect(() => {
    if (!slug || !meta) return;
    trackBlogPostView(slug, meta.category, Number(meta.readTime) || 0);
  }, [slug, meta]);

  useEffect(() => {
    if (!slug) return;
    const fired = new Set<number>();
    const onScroll = () => {
      const el = articleRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const percent = scrollDepthPercent(rect.top, rect.height, window.innerHeight);
      for (const threshold of newlyReachedThresholds(percent, fired)) {
        fired.add(threshold);
        trackBlogScrollDepth(slug, threshold);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [slug]);

  // One delegated handler counts every call-to-action link (scan, pricing, newsletter, other posts).
  const handleContentClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!slug) return;
    const anchor = (e.target as HTMLElement).closest('a');
    const destination = blogCtaDestination(anchor?.getAttribute('href'));
    if (!anchor || !destination) return;
    const location = anchor.closest('[data-cta-location]')?.getAttribute('data-cta-location') ?? 'in_content';
    trackBlogCtaClick(slug, location, destination);
  };

  if (!slug || !meta || (!blogContent[slug] && !guide)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Article Not Found</h1>
          <Link to="/blog">
            <Button variant="outline">← Back to Blog</Button>
          </Link>
        </div>
      </div>
    );
  }

  const GuideContent = guide?.Content;
  const post = { ...meta, content: GuideContent ? <GuideContent /> : blogContent[slug] };
  const updated = 'updated' in meta ? (meta as { updated?: string }).updated : undefined;
  const canonical = `${SITE_URL}/blog/${slug}`;
  const scanHref = blogCtaHref(slug);
  const relatedGuides = guide
    ? blogPosts.filter((p) => p.slug !== slug && guides[p.slug])
    : [];

  const jsonLd: object[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: post.title,
      description: post.excerpt,
      ...(post.image ? { image: [`${SITE_URL}${post.image}`] } : {}),
      author: { '@type': 'Organization', name: post.author },
      publisher: { '@type': 'Organization', name: 'MyPrivacyTOOL', url: SITE_URL },
      datePublished: toIsoDate(post.date),
      dateModified: toIsoDate(updated ?? post.date),
      mainEntityOfPage: canonical,
    },
  ];
  if (guide && guide.faqs.length > 0) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: guide.faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }

  const handleShare = async () => {
    const url = `${window.location.origin}/blog/${slug}`;
    const text = `${post.title} - MyPrivacyTOOL`;
    
    if (navigator.share) {
      navigator.share({ title: post.title, text, url });
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(url);
      alert('Link copied to clipboard');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title={`${post.title} | MyPrivacyTOOL`}
        description={post.excerpt}
        path={`/blog/${slug}`}
        type="article"
        image={post.image ? `${SITE_URL}${post.image}` : undefined}
      />
      <Helmet>
        {jsonLd.map((block, i) => (
          <script key={i} type="application/ld+json">{JSON.stringify(block)}</script>
        ))}
      </Helmet>
      {/* Article Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Button
            variant="ghost"
            onClick={() => navigate('/blog')}
            className="mb-6"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Blog
          </Button>

          <div className="space-y-4">
            <div className="inline-block px-3 py-1 rounded-full text-sm font-semibold bg-secondary text-foreground">
              {post.category}
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold text-foreground">
              {post.title}
            </h1>

            <div className="flex items-center justify-between text-muted-foreground pt-4">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-medium text-foreground">By {post.author}</p>
                  <p className="text-sm">
                    Published <time dateTime={toIsoDate(post.date)}>{post.date}</time>
                    {updated && (
                      <>
                        {' · '}Updated on <time dateTime={toIsoDate(updated)}>{updated}</time>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-sm">
                {post.readTime} min read
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Article Image */}
      {post.image && (
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="h-96 bg-muted rounded-lg overflow-hidden">
            <img
              src={post.image}
              alt={post.title}
              fetchPriority="high"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Article Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12" onClick={handleContentClick}>
        <div className="bg-card rounded-lg p-8 mb-8 shadow-sm">
          {guide && (
            <nav aria-label="Table of contents" className="mb-8 rounded-lg border border-border bg-secondary p-5">
              <p className="font-bold text-foreground mb-3">In this guide</p>
              <ol className="list-decimal pl-5 space-y-1 text-foreground">
                {guide.sections.map((sec) => (
                  <li key={sec.id}>
                    <a href={`#${sec.id}`} className="text-brand hover:underline">{sec.title}</a>
                  </li>
                ))}
                <li>
                  <a href="#faq" className="text-brand hover:underline">Frequently asked questions</a>
                </li>
              </ol>
            </nav>
          )}

          <div ref={articleRef} className="article article-headings:text-foreground article-p:text-foreground article-li:text-foreground article-strong:text-foreground article-a:text-brand article-lg max-w-none">
            {post.content}

            {guide && guide.faqs.length > 0 && (
              <section aria-labelledby="faq">
                <h2 id="faq">Frequently asked questions</h2>
                {guide.faqs.map((f) => (
                  <div key={f.q}>
                    <h3>{f.q}</h3>
                    <p>{f.a}</p>
                  </div>
                ))}
              </section>
            )}
          </div>

          {/* Social Share & CTA */}
          <div className="border-t border-border mt-8 pt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Share this article</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShare}
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/blog/${slug}`);
                      alert('Link copied to clipboard');
                    }}
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy Link
                  </Button>
                </div>
              </div>
            </div>

            {/* CTA Box */}
            <div className="bg-secondary rounded-lg p-6 border border-border" data-cta-location="end_of_post">
              <h3 className="font-bold text-foreground mb-2">Ready to reclaim your privacy?</h3>
              <p className="text-muted-foreground mb-4">See where your data is exposed, then take it back.</p>
              <Button asChild>
                <Link to={scanHref}>Check My Exposure →</Link>
              </Button>
            </div>
          </div>
        </div>

        {relatedGuides.length > 0 && (
          <Card className="mb-8" data-cta-location="related_guides">
            <CardContent className="p-8">
              <h3 className="text-xl font-bold text-foreground mb-3">More privacy guides</h3>
              <ul className="space-y-2">
                {relatedGuides.map((p) => (
                  <li key={p.slug}>
                    <Link to={`/blog/${p.slug}`} className="text-brand hover:underline">{p.title}</Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Related Content CTA */}
        <Card className="bg-brand-soft border-surface-border text-foreground" data-cta-location="newsletter_card">
          <CardContent className="p-8">
            <h3 className="text-2xl font-bold mb-2">Privacy Check</h3>
            <p className="text-muted-foreground mb-4">Privacy Check is our newsletter: new articles on data brokers, AI and your data, and practical protection steps, delivered to your inbox.</p>
            <Button asChild>
              <Link to="/newsletter">Subscribe Now</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}