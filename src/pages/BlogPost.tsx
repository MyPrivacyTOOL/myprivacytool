import React from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Share2, Copy } from 'lucide-react';

interface Post {
  slug: string;
  title: string;
  author: string;
  date: string;
  category: string;
  readTime: number;
  image?: string;
  content: React.ReactNode;
}

const blogContent: { [key: string]: Post } = {
  "how-exposed-are-you": {
    slug: "how-exposed-are-you",
    title: "How Exposed Are You? The 46 Things Tracking You Online",
    author: "MyPrivacyTOOL",
    date: "August 30, 2026",
    category: "Privacy Awareness",
    readTime: 8,
    image: "/blog/exposure-guide.jpg",
    content: (
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
    )
  },
  "linkedin-data-brokers": {
    slug: "linkedin-data-brokers",
    title: "Your LinkedIn Profile Is a Data Broker's Best Friend",
    author: "MyPrivacyTOOL",
    date: "August 29, 2026",
    category: "Social Media",
    readTime: 6,
    image: "/blog/linkedin-privacy.jpg",
    content: (
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
    )
  },
  "ai-training-data-opt-out": {
    slug: "ai-training-data-opt-out",
    title: "AI Is Training on Your Data — Here's How to Opt Out",
    author: "MyPrivacyTOOL",
    date: "Coming Soon",
    category: "AI & Emerging Threats",
    readTime: 7,
    content: (
      <div className="prose prose-slate max-w-none">
        <p>Your tweets, Reddit comments, blog posts, and public profiles are being used to train AI models. OpenAI, Google, Meta, and dozens of startups have already ingested billions of lines of your data. Coming soon: the full breakdown of how to opt out.</p>
      </div>
    )
  }
};

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  if (!slug || !blogContent[slug]) {
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

  const post = blogContent[slug];

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
