import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { Link } from "react-router-dom";
import { Clock, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import guides from "@/data/optOutGuides.json";

const SITE_URL = "https://www.myprivacytool.io";

const COUNTRY_FILTERS = [
  { code: "ALL", label: "All countries" },
  { code: "HK", label: "Hong Kong" },
  { code: "SG", label: "Singapore" },
  { code: "AU", label: "Australia" },
  { code: "US", label: "United States" },
];

const OptOutGuides = () => {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guides.filter((g) => {
      if (country !== "ALL" && g.country !== country) return false;
      if (!q) return true;
      return [g.name, g.countryName, g.type, g.summary].some((s) => s.toLowerCase().includes(q));
    });
  }, [query, country]);

  const apacGuides = filtered.filter((g) => g.region === "APAC");
  const usGuides = filtered.filter((g) => g.region !== "APAC");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Data broker & marketing list opt-out guides",
    url: `${SITE_URL}/opt-out-guides`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: guides.map((g, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `How to opt out of ${g.name}`,
        url: `${SITE_URL}/opt-out-guides/${g.slug}`,
      })),
    },
  };

  const renderGrid = (items: typeof guides) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((g) => (
        <Link
          key={g.slug}
          to={`/opt-out-guides/${g.slug}`}
          className="rounded-lg border border-border bg-card p-5 hover:border-primary/50 transition-colors"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <span className="rounded-full bg-secondary px-2 py-0.5">{g.countryName}</span>
            <span>{g.type}</span>
          </div>
          <h3 className="font-semibold text-foreground mb-1">{g.name}</h3>
          <p className="text-sm text-muted-foreground mb-3">{g.summary}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" /> {g.timeNeeded} · Reviewed {g.lastVerified}
          </p>
        </Link>
      ))}
    </div>
  );

  return (
    <>
      <Seo {...pageMeta["/opt-out-guides"]} path="/opt-out-guides" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        <h1 className="text-4xl font-bold text-foreground mb-3">Opt-out guides</h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-3xl">
          Step-by-step opt-out guides for do-not-call registers, marketing lists, directory listings and people-search
          sites, starting with Hong Kong, Singapore and Australia, where few other services help. Every guide links to
          the official opt-out page and shows when we last reviewed it.
        </p>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides, e.g. Spokeo or Do Not Call"
            aria-label="Search opt-out guides"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2 mb-10" role="group" aria-label="Filter by country">
          {COUNTRY_FILTERS.map((f) => (
            <Button
              key={f.code}
              type="button"
              size="sm"
              variant={country === f.code ? "default" : "outline"}
              onClick={() => setCountry(f.code)}
              className="rounded-full"
              aria-pressed={country === f.code}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="text-muted-foreground py-10 text-center">No guides match your search.</p>
        )}

        {apacGuides.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">Asia-Pacific</h2>
            {renderGrid(apacGuides)}
          </section>
        )}
        {usGuides.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl font-semibold text-foreground mb-4">United States</h2>
            {renderGrid(usGuides)}
          </section>
        )}

        <div className="rounded-lg bg-secondary p-6 text-center">
          <h2 className="text-xl font-semibold text-foreground mb-2">Not sure who has your data?</h2>
          <p className="text-muted-foreground mb-4">Run a free scan first, then use the guides to remove what you find.</p>
          <Button asChild>
            <Link to="/am-i-exposed">Check if I'm exposed</Link>
          </Button>
        </div>
      </div>
    </>
  );
};

export default OptOutGuides;
