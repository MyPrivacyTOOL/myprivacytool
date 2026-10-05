import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const AmIExposed = () => (
  <>
    <Seo {...pageMeta["/am-i-exposed"]} path="/am-i-exposed" />
    <div className="container mx-auto px-4 py-16 max-w-3xl text-center">
      <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">Am I exposed?</h1>
      <p className="text-lg text-muted-foreground mb-8">
        Run our free exposure scan to see where your personal information may be listed, across Hong Kong, Singapore,
        Australia and the United States.
      </p>
      <Button asChild size="lg" className="mb-12">
        <Link to="/scan">Check My Exposure</Link>
      </Button>
      <div className="grid gap-6 sm:grid-cols-3 text-left mb-12">
        {[
          ["1. Scan", "Enter your email to start a free exposure check. No credit card needed."],
          ["2. Review", "See the kinds of sources that may hold your name, contact details and address."],
          ["3. Remove", "Follow our step-by-step opt-out guides to get yourself removed."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-border p-5">
            <h2 className="font-semibold text-foreground mb-1">{t}</h2>
            <p className="text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">
        Already know who has your data? Jump straight to the{" "}
        <Link to="/opt-out-guides" className="text-brand hover:underline">opt-out guides</Link>.
      </p>
    </div>
  </>
);

export default AmIExposed;
