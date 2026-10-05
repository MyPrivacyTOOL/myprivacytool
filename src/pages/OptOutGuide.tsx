import { Helmet } from "react-helmet";
import Seo from "@/components/Seo";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import guides from "@/data/optOutGuides.json";
import NotFound from "./NotFound";


const OptOutGuide = () => {
  const { slug } = useParams();
  const guide = guides.find((g) => g.slug === slug);
  if (!guide) return <NotFound />;

  const related = guides.filter((g) => g.slug !== guide.slug && g.country === guide.country).slice(0, 3);
  const title = `How to opt out of ${guide.name}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: title,
    description: guide.summary,
    step: guide.steps.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
  };

  return (
    <>
      <Seo
        title={`${title} (${guide.countryName}) | MyPrivacyTOOL`}
        description={guide.summary}
        path={`/opt-out-guides/${guide.slug}`}
      />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <article className="container mx-auto px-4 py-12 max-w-3xl">
        <nav className="text-sm text-muted-foreground mb-6" aria-label="Breadcrumb">
          <Link to="/opt-out-guides" className="hover:text-foreground">Opt-out guides</Link> / {guide.name}
        </nav>
        <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-3">{title}</h1>
        <p className="text-lg text-muted-foreground mb-6">{guide.summary}</p>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg border border-border p-4 mb-8 text-sm">
          <div><dt className="text-muted-foreground">Region</dt><dd className="font-medium">{guide.countryName}</dd></div>
          <div><dt className="text-muted-foreground">Time needed</dt><dd className="font-medium">{guide.timeNeeded}</dd></div>
          <div><dt className="text-muted-foreground">Difficulty</dt><dd className="font-medium">{guide.difficulty}</dd></div>
          <div><dt className="text-muted-foreground">Last reviewed</dt><dd className="font-medium">{guide.lastVerified}</dd></div>
        </dl>

        <Button asChild size="lg" className="mb-8">
          <a href={guide.optOutUrl} target="_blank" rel="noopener noreferrer">
            Official opt-out page: {guide.optOutUrlLabel} <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
          </a>
        </Button>

        <h2 className="text-2xl font-semibold text-foreground mb-3">What you need</h2>
        <ul className="list-disc pl-6 space-y-1 text-muted-foreground mb-8">
          {guide.requirements.map((r) => <li key={r}>{r}</li>)}
        </ul>

        <h2 className="text-2xl font-semibold text-foreground mb-3">Steps</h2>
        <ol className="list-decimal pl-6 space-y-3 text-foreground mb-4">
          {guide.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
        <p className="text-sm text-muted-foreground mb-8">Processing time: {guide.processingTime}.</p>

        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 mb-10 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-foreground mb-1">Warning: you can be re-listed</h2>
            <p className="text-sm text-muted-foreground">{guide.relistingWarning}</p>
          </div>
        </div>

        <div className="rounded-lg bg-secondary p-6 text-center mb-10">
          <h2 className="text-xl font-semibold text-foreground mb-2">Find out where else you're exposed</h2>
          <p className="text-muted-foreground mb-4">Scan free to see which other sites hold your data.</p>
          <Button asChild><Link to="/scan">Scan free</Link></Button>
        </div>

        {related.length > 0 && (
          <>
            <h2 className="text-xl font-semibold text-foreground mb-3">More {guide.countryName} guides</h2>
            <ul className="space-y-2">
              {related.map((g) => (
                <li key={g.slug}>
                  <Link className="text-primary hover:underline" to={`/opt-out-guides/${g.slug}`}>How to opt out of {g.name}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>
    </>
  );
};

export default OptOutGuide;
