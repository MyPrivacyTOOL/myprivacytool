import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import blogPosts from '@/data/blogPosts.json';
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

const categoryColors: { [key: string]: string } = {
  "Privacy Awareness": "bg-secondary text-foreground",
  "Privacy Advocacy": "bg-secondary text-foreground",
  "Social Media": "bg-secondary text-foreground",
  "Data Brokers": "bg-secondary text-foreground",
  "AI & Emerging Threats": "bg-secondary text-foreground",
  "Regulatory": "bg-secondary text-foreground",
  "Privacy Guides": "bg-secondary text-brand"
};

export default function Blog() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const filteredPosts = selectedCategory
    ? blogPosts.filter(post => post.category === selectedCategory)
    : blogPosts;

  const categories = Array.from(new Set(blogPosts.map(post => post.category)));

  return (
    <div className="min-h-screen bg-background">
      <Seo {...pageMeta["/blog"]} path="/blog" />
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
                Home
              </Link>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm font-medium text-foreground">Blog</span>
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Insights</h1>
              <p className="text-lg text-muted-foreground">
                Expert articles on data privacy, AI and your data, and taking back control of your digital footprint
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
            <Card key={post.slug} className="overflow-hidden hover:shadow-lg transition-shadow">
              {post.image && (
                <div className="h-48 bg-muted overflow-hidden">
                  <img
                    src={post.image}
                    alt={post.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${categoryColors[post.category] || "bg-secondary text-foreground"}`}>
                    {post.category}
                  </span>
                  <span className="text-xs text-muted-foreground">{post.readTime} min read</span>
                </div>
                <CardTitle className="line-clamp-2">{post.title}</CardTitle>
                <CardDescription className="line-clamp-2 mt-2">{post.excerpt}</CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">{post.author}</p>
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
            <p className="text-muted-foreground">No articles found in this category.</p>
          </div>
        )}

        {/* Newsletter CTA */}
        <div className="mt-16 bg-brand-soft border border-surface-border rounded-lg p-8 text-foreground text-center">
          <h2 className="text-2xl font-bold mb-2">Privacy Check</h2>
          <p className="mb-4 text-muted-foreground">Subscribe to Privacy Check, our newsletter, for privacy insights and practical steps you can act on</p>
          <Link to="/newsletter">
            <Button size="lg">Subscribe Now</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}