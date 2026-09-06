import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  date: string;
  author: string;
  category: string;
  readTime: number;
  image?: string;
}

const blogPosts: BlogPost[] = [
  {
    id: 1,
    title: "How Exposed Are You? The 46 Things Tracking You Online",
    slug: "how-exposed-are-you",
    excerpt: "Your digital footprint is larger than you think. Discover the 46 privacy vectors exposing your personal data right now — from data brokers to AI training datasets.",
    date: "August 30, 2026",
    author: "MyPrivacyTOOL",
    category: "Privacy Awareness",
    readTime: 8,
    image: "/blog/exposure-guide.jpg"
  },
  {
    id: 2,
    title: "Your LinkedIn Profile Is a Data Broker's Best Friend",
    slug: "linkedin-data-brokers",
    excerpt: "LinkedIn data is scraped legally. Apollo, ZoomInfo, Lusha, and Clearbit all use your profile. Here's how to protect yourself.",
    date: "August 29, 2026",
    author: "MyPrivacyTOOL",
    category: "Social Media",
    readTime: 6,
    image: "/blog/linkedin-privacy.jpg"
  },
  {
    id: 3,
    title: "AI Is Training on Your Data — Here's How to Opt Out",
    slug: "ai-training-data-opt-out",
    excerpt: "Your data is being used to train LLMs. We break down the opt-out options for ChatGPT, Gemini, Claude, and emerging AI platforms.",
    date: "Coming Soon",
    author: "MyPrivacyTOOL",
    category: "AI & Emerging Threats",
    readTime: 7
  }
];

const categoryColors: { [key: string]: string } = {
  "Privacy Awareness": "bg-blue-100 text-blue-800",
  "Social Media": "bg-purple-100 text-purple-800",
  "Data Brokers": "bg-red-100 text-red-800",
  "AI & Emerging Threats": "bg-orange-100 text-orange-800",
  "Regulatory": "bg-green-100 text-green-800"
};

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredPosts = selectedCategory
    ? blogPosts.filter(post => post.category === selectedCategory)
    : blogPosts;

  const categories = Array.from(new Set(blogPosts.map(post => post.category)));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Link to="/" className="text-sm text-slate-600 hover:text-slate-900">
                Home
              </Link>
              <span className="text-slate-300">/</span>
              <span className="text-sm font-medium text-slate-900">Blog</span>
            </div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900 mb-2">Privacy Insights</h1>
              <p className="text-lg text-slate-600">
                Expert articles on data privacy, AI threats, and protecting your digital identity
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Category Filter */}
        <div className="mb-8 flex flex-wrap gap-2">
          <Button
            variant={selectedCategory === null ? "default" : "outline"}
            onClick={() => setSelectedCategory(null)}
            className="rounded-full"
          >
            All Articles
          </Button>
          {categories.map(category => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              onClick={() => setSelectedCategory(category)}
              className="rounded-full"
            >
              {category}
            </Button>
          ))}
        </div>

        {/* Blog Posts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredPosts.map(post => (
            <Card key={post.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              {post.image && (
                <div className="h-48 bg-slate-200 overflow-hidden">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${categoryColors[post.category] || "bg-slate-100 text-slate-800"}`}>
                    {post.category}
                  </span>
                  <span className="text-xs text-slate-500">{post.readTime} min read</span>
                </div>
                <CardTitle className="line-clamp-2">{post.title}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2">{post.excerpt}</CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-slate-500">
                    <p className="font-medium text-slate-700">{post.author}</p>
                    <p>{post.date}</p>
                  </div>
                </div>
                <Link to={`/blog/${post.slug}`}>
                  <Button className="w-full" variant="outline">
                    Read Article →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Empty State */}
        {filteredPosts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-slate-600">No articles found in this category.</p>
          </div>
        )}

        {/* Newsletter CTA */}
        <div className="mt-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-8 text-white text-center">
          <h2 className="text-2xl font-bold mb-2">Get Privacy Updates Weekly</h2>
          <p className="mb-4 text-blue-100">Subscribe to our newsletter for the latest privacy insights and protection tips</p>
          <Link to="/newsletter">
            <Button variant="secondary" size="lg">Subscribe Now</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
