import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { FAQS } from "@/data/faqs";

const Faq = () => {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
  return (
    <>
      <Seo {...pageMeta["/faq"]} path="/faq" />
      <Helmet>
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>
      <main className="min-h-screen bg-gray-50">
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
          <h1 className="mb-2 text-4xl font-bold text-gray-900">Frequently asked questions</h1>
          <p className="mb-8 text-lg text-gray-600">
            Can't find your answer? Visit our <Link to="/contact" className="text-primary underline">contact page</Link>
            , or read the <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
          </p>
          <div className="space-y-3">
            {FAQS.map(({ q, a }) => (
              <details key={q} className="group rounded-lg border border-gray-200 bg-white p-4">
                <summary className="cursor-pointer text-lg font-semibold text-gray-900">{q}</summary>
                <p className="mt-3 text-gray-700">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </main>
    </>
  );
};

export default Faq;
