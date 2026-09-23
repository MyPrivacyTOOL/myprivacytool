import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Share2, Copy } from 'lucide-react';
import blogPosts from '@/data/blogPosts.json';

const blogContent: { [key: string]: React.ReactNode } = {
  "how-exposed-are-you": (
      <div className="prose prose-slate max-w-none">
        <p>Your digital footprint is larger than you think. Every day, your personal data is being collected, packaged, sold, and used in ways you never authorized.</p>
        
        <h2>The 46 Privacy Vectors Exposing Your Data</h2>
        <p>We've identified 46 distinct sources where your personal information is currently exposed:</p>
        
        <h3>Data Broker Networks (12)</h3>
        <ul>
          <li>PeopleFinder, TruthFinder, Spokeo</li>
          <li>WhitePages Pro, Instant Checkmate</li>
          <li>People.com, FastBackgroundCheck</li>
          <li>MyLife, ZoomInfo, Apollo</li>
          <li>Hunter.io, Lusha</li>
          <li>Clearbit (corporate)</li>
        </ul>
        
        <h3>Social Media & Public Records (8)</h3>
        <ul>
          <li>LinkedIn (scraped by dozens of B2B brokers)</li>
          <li>Facebook (through Meta's advertiser network)</li>
          <li>Twitter/X (public archive APIs)</li>
          <li>Public records databases (criminal, property, marriage)</li>
          <li>Court records (civil litigation)</li>
          <li>Voter registration data</li>
          <li>DMV & driver's license records</li>
          <li>Property tax assessor records</li>
        </ul>
        
        <h3>AI & Machine Learning Training (7)</h3>
        <ul>
          <li>OpenAI's GPT training corpus (Common Crawl)</li>
          <li>Google's Gemini dataset</li>
          <li>Anthropic's Claude training</li>
          <li>Meta's LLaMA models</li>
          <li>Mistral AI datasets</li>
          <li>Stability AI image training</li>
          <li>Academic AI research repositories</li>
        </ul>
        
        <h3>Advertising Networks & Trackers (10)</h3>
        <ul>
          <li>Google Analytics (on 80% of the web)</li>
          <li>Meta Pixel (on 25% of sites)</li>
          <li>Third-party cookies (still present on 70% of sites)</li>
          <li>Behavioral targeting networks</li>
          <li>Email tracking (Superhuman, Mailchimp, HubSpot)</li>
          <li>Mobile app SDKs collecting location</li>
          <li>WiFi network data collection</li>
          <li>Inferential targeting (predicting behavior from browsing)</li>
          <li>Lookalike audiences (targeting based on your type)</li>
          <li>Cross-device tracking</li>
        </ul>
        
        <h3>Forgotten Accounts & Unused Services (9)</h3>
        <ul>
          <li>Old email accounts (with recovery data still linked)</li>
          <li>Social platforms you haven't used in 5+ years</li>
          <li>Fitness trackers with location history</li>
          <li>Smart home device accounts</li>
          <li>Streaming service accounts</li>
          <li>Financial app connections</li>
          <li>Job search platforms</li>
          <li>Dating apps (sometimes never deleted)</li>
          <li>Beta testing accounts</li>
        </ul>
        
        <h2>Why This Matters Now</h2>
        <p>The combination of these 46 vectors creates a complete digital shadow profile of you. Advertisers, employers, landlords, and bad actors can:</p>
        <ul>
          <li>Reconstruct your entire movement history</li>
          <li>Predict your health status, financial situation, and life choices</li>
          <li>Impersonate you or commit identity theft</li>
          <li>Deny you opportunities based on inferred data</li>
          <li>Target you with precision manipulation</li>
        </ul>
        
        <h2>What You Can Do Right Now</h2>
        <p>Run a free scan with MyPrivacyTOOL to see exactly where your data is exposed. We'll map all 46 vectors for you, then give you step-by-step removal instructions for each one.</p>
        
        <p>The map changes weekly as new brokers emerge and existing ones evolve. A one-time fix isn't enough — you need ongoing monitoring and regular removal cycles.</p>
      </div>
  ),
  "25-years-mass-surveillance": (
      <div className="prose prose-slate max-w-none">
        <p>A generation has grown up under constant digital surveillance. From CCTV networks to smartphone tracking, we've normalized the abnormal. It's time to demand a different future.</p>
        
        <h2>The Timeline: How We Got Here</h2>
        
        <h3>2001 — The PATRIOT Act & The Beginning</h3>
        <p>Post-9/11 panic gave governments unprecedented surveillance powers. The PATRIOT Act authorized bulk data collection without individual warrants. What was supposed to be temporary became permanent infrastructure.</p>
        
        <h3>2007 — The Smartphone Era</h3>
        <p>The iPhone launched, and with it, a new vector: location tracking. Every smartphone became a tracking device, with Apple, Google, and app developers collecting your movement history. GPS, cellular, and WiFi triangulation made it impossible to move without leaving a digital trail.</p>
        
        <h3>2013 — The Snowden Revelations</h3>
        <p>Edward Snowden revealed the scope: the NSA was collecting billions of phone records daily, the GCHQ was tapping undersea cables, and Silicon Valley tech companies were forwarding user data to intelligence agencies under secret court orders.</p>
        
        <p>The response? Shock. Then... nothing. Surveillance continued, now with public knowledge.</p>
        
        <h3>2015–2020 — The Data Broker Boom</h3>
        <p>Private companies realized the gold mine: sell what governments collected for free. ZoomInfo, Apollo, Hunter, Clearbit, and hundreds of smaller brokers scraped the web and resold profiles to sales teams, marketers, and private investigators.</p>
        
        <h3>2020–2024 — AI Training & Weaponization</h3>
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
        
        <h2>The Cost We Haven't Paid Yet</h2>
        
        <p>The real danger of 25 years of surveillance is not what's being collected — it's what happens when that data is misused by actors with bad intent:</p>
        
        <ul>
          <li><strong>Political manipulation:</strong> Detailed profiles of voters used to target propaganda with surgical precision (we're seeing this now)</li>
          <li><strong>Discrimination:</strong> Employers, landlords, and insurance companies using algorithmic profiles to deny opportunities</li>
          <li><strong>Blackmail & extortion:</strong> Access to intimate data being weaponized against individuals</li>
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
        <p>All messages, emails, and cloud storage should be end-to-end encrypted by default. No backdoors for governments.</p>
        
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
      <div className="prose prose-slate max-w-none">
        <p>LinkedIn says your profile is yours to control. But behind the scenes, companies like Apollo, ZoomInfo, Lusha, and Clearbit are legally scraping your entire profile — every job, school, skill, and connection — and reselling it to thousands of sales teams and recruiters.</p>
        
        <h2>How Your LinkedIn Data Is Harvested</h2>
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
          <li>Skills and endorsements (a data broker's goldmine)</li>
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
      <div className="prose prose-slate max-w-none">
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
        
        <p>Your data in AI models creates several risks:</p>
        
        <h3>1. Information Leakage</h3>
        <p>AI models can sometimes reproduce exact training data if prompted correctly. A researcher at DeepMind demonstrated that GPT-3 could reproduce verbatim personal information (SSNs, addresses, phone numbers) when the model had been trained on scraped datasets containing this data.</p>
        
        <h3>2. Inference Attacks</h3>
        <p>Researchers can determine if your data was in the training set by submitting queries and analyzing the model's confidence and output patterns. This "membership inference" attack works even on large models.</p>
        
        <h3>3. Commercial Reuse Without Consent</h3>
        <p>Your words — your thoughts, your writing, your expertise — are now part of a product that generates billions in value. You received no compensation, and no one asked permission.</p>
        
        <h3>4. Misinformation & Impersonation Risk</h3>
        <p>If your writing style and ideas are part of a model's training data, an attacker can use that model to impersonate you convincingly or generate content falsely attributed to your voice.</p>
        
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
        
        <h3>3. Delete Your Content (Nuclear Option)</h3>
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
        
        <h2>The Hard Truth</h2>
        <p>Your data is already in dozens of AI models. Opting out today only stops future training. What's already done cannot be undone with current technology.</p>
        
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

  if (!slug || !meta || !blogContent[slug]) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900 mb-4">Article Not Found</h1>
          <Link to="/blog">
            <Button variant="outline">← Back to Blog</Button>
          </Link>
        </div>
      </div>
    );
  }

  const post = { ...meta, content: blogContent[slug] };

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
    <div className="min-h-screen bg-slate-50">
      {/* Article Header */}
      <div className="bg-white border-b border-slate-200">
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
            <div className="inline-block px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800">
              {post.category}
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold text-slate-900">
              {post.title}
            </h1>

            <div className="flex items-center justify-between text-slate-600 pt-4">
              <div className="flex items-center gap-4">
                <div>
                  <p className="font-medium text-slate-900">{post.author}</p>
                  <p className="text-sm">{post.date}</p>
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
          <div className="h-96 bg-slate-200 rounded-lg overflow-hidden">
            <img
              src={post.image}
              alt={post.title}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Article Content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-lg p-8 mb-8 shadow-sm">
          <div className="prose prose-slate prose-lg max-w-none">
            {post.content}
          </div>

          {/* Social Share & CTA */}
          <div className="border-t border-slate-200 mt-8 pt-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">Share this article</p>
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
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border border-blue-200">
              <h3 className="font-bold text-slate-900 mb-2">Ready to reclaim your privacy?</h3>
              <p className="text-slate-600 mb-4">Run a free scan to see exactly where your data is exposed.</p>
              <Link to="/scan">
                <Button className="bg-blue-600 hover:bg-blue-700">
                  Start Free Scan →
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Related Content CTA */}
        <Card className="bg-slate-900 text-white">
          <CardContent className="p-8">
            <h3 className="text-2xl font-bold mb-2">Get Privacy Updates Weekly</h3>
            <p className="text-slate-200 mb-4">New articles on data brokers, AI threats, and protection tactics delivered to your inbox.</p>
            <Link to="/newsletter">
              <Button variant="secondary">Subscribe Now</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}