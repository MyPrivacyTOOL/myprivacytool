import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";
import { BANDS, BAND_LABEL, CATEGORY_WEIGHTS, SCORE_VERSION } from "../../shared/hexagon-registry/score.js";

// MPC-7471-F4: "How we calculate your score". Wording approved by Chris (2026-10-26) from docs/exposure-score-explainer-draft.md.
// The weights and the bands are read from the same constants the score uses (shared/hexagon-registry/score.js), so this page cannot drift from the code.
const CATEGORY_LABEL: Record<keyof typeof CATEGORY_WEIGHTS, string> = {
  fingerprint: "Browser fingerprint",
  social: "Social accounts (cannot be checked from a web page today)",
  security: "Security status",
  storage: "Storage",
  behavior: "Behaviour tracking",
  device: "Device and network",
  privacy: "Privacy settings",
  language: "Language",
  orientation: "Device orientation",
};

const ScoreMethod = () => (
  <>
    <Seo {...pageMeta["/how-we-calculate-your-score"]} path="/how-we-calculate-your-score" />
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-gray-900">How we calculate your score</h1>
        <p className="mb-8 text-lg text-gray-600">Method version <strong>{SCORE_VERSION}</strong>.</p>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">What the number means</h2>
          <p className="mt-2 text-gray-700">
            Your <strong>exposure score</strong> is a number from 0 to 100 that says <strong>how much your browser revealed to us during the scan, with the more sensitive things counting for more</strong>.
          </p>
          <p className="mt-2 text-gray-700">
            It is <strong>not</strong> a chance that something bad will happen to you. It is <strong>not</strong> a grade of how careful you are, and it does not compare you with other people. A high number means your browser shows a lot. It does not mean you did anything wrong.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">The three bands</h2>
          <table className="mt-3 w-full border border-gray-200 bg-white text-left text-gray-700">
            <thead><tr className="bg-gray-100"><th className="p-2">Score</th><th className="p-2">Band</th></tr></thead>
            <tbody>
              {BANDS.map((b) => (
                <tr key={b.key} className="border-t border-gray-200"><td className="p-2">{b.from} to {b.to}</td><td className="p-2">{BAND_LABEL[b.key as keyof typeof BAND_LABEL]}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-gray-700">
            Today almost every complete scan lands in High, because most things a browser shows cannot be "clear": a browser always tells a site its language, for example. We would rather say that than hide it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">How it is worked out</h2>
          <p className="mt-2 text-gray-700">We check up to {HEXAGON_COUNT} things (we call them hexagons). Each one ends up in exactly one of three states:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
            <li><strong>Found</strong>: your browser showed us a real value.</li>
            <li><strong>Checked and clear</strong>: we could check, and there was nothing to show. Only a few things can ever be clear.</li>
            <li><strong>Not checked</strong>: we could not tell, the check failed or was blocked, or this site cannot check it. This is <strong>not</strong> the same as clear and <strong>not</strong> the same as found.</li>
          </ul>
          <p className="mt-3 text-gray-700">
            The things are grouped into nine categories. Each category gets its own exposure: the sensitivity of what was found, as a share of the sensitivity of everything we checked in it. Sensitive things count up to three times more than low-sensitivity ones. The categories are then combined, with these weights:
          </p>
          <table className="mt-3 w-full border border-gray-200 bg-white text-left text-gray-700">
            <thead><tr className="bg-gray-100"><th className="p-2">Category</th><th className="p-2">Weight</th></tr></thead>
            <tbody>
              {(Object.entries(CATEGORY_WEIGHTS) as [keyof typeof CATEGORY_WEIGHTS, number][]).sort((a, b) => b[1] - a[1]).map(([k, w]) => (
                <tr key={k} className="border-t border-gray-200"><td className="p-2">{CATEGORY_LABEL[k]}</td><td className="p-2">{w}%</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-gray-700">A category where nothing was checked is left out, and the others share the weight. The result is rounded to a whole number, and halves round up.</p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Coverage</h2>
          <p className="mt-2 text-gray-700">
            <strong>Coverage</strong> is how much of the full list we were able to check: the things checked, divided by all {HEXAGON_COUNT}. It is a different number from your score. A score with low coverage tells you less, because it is built from fewer checks. Things we could not check lower your coverage. They never raise or lower your score.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">While a scan is still running</h2>
          <p className="mt-2 text-gray-700">The number you see while the scan runs is <strong>provisional</strong>. It uses only what has been checked so far, so it can change as more checks finish. The number at the end is the one to use.</p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Versions and comparing scores</h2>
          <p className="mt-2 text-gray-700">
            Every score is stamped with the version of this method, currently <strong>{SCORE_VERSION}</strong>. If we ever change the method, scores from different versions cannot be compared, and we will say so. Scores saved before this method existed are marked "legacy" and are not compared with new ones. A different number between two versions does not mean your privacy got better or worse.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">What we do not do</h2>
          <p className="mt-2 text-gray-700">We do not guess. Anything we could not check is shown as not checked. We do not turn a missing result into "safe" or "exposed".</p>
        </section>

        <p className="text-gray-700">Questions? See the <Link to="/faq" className="text-primary underline">FAQ</Link> or <Link to="/contact" className="text-primary underline">contact us</Link>.</p>
      </div>
    </main>
  </>
);

export default ScoreMethod;
