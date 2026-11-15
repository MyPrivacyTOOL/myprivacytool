import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { HEXAGON_COUNT } from "../../shared/hexagon-registry/registry.js";
import { countSentence } from "../../shared/hexagon-registry/countSentence.js";
import { HEXAGONS } from "../../shared/hexagon-registry/registry.js";
import { BANDS, BAND_LABEL, CATEGORY_OF, CATEGORY_WEIGHTS, SCORE_VERSION, WEIGHTS_LABEL } from "../../shared/hexagon-registry/score.js";

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

// Categories in which no hexagon can be checked from a web page: they are always left out, so the other categories share their weight.
const UNCHECKABLE = new Set(
  Object.keys(CATEGORY_WEIGHTS).filter((k) => {
    const items = (HEXAGONS as { category: string; truth: { level: string } }[]).filter((h) => CATEGORY_OF[h.category as keyof typeof CATEGORY_OF] === k);
    return items.length > 0 && items.every((h) => h.truth.level === "cannot_be_checked");
  }),
);
const CHECKABLE_TOTAL = Object.entries(CATEGORY_WEIGHTS).filter(([k]) => !UNCHECKABLE.has(k)).reduce((a, [, w]) => a + w, 0);
const effective = (k: string, w: number) => (UNCHECKABLE.has(k) ? "0" : `${Math.round((w / CHECKABLE_TOTAL) * 10000) / 100}`);

const ScoreMethod = () => (
  <>
    <Seo {...pageMeta["/how-we-calculate-your-score"]} path="/how-we-calculate-your-score" />
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-gray-900">How we calculate your score</h1>
        <p className="mb-8 text-lg text-gray-600">Method version <strong>{SCORE_VERSION}</strong>. Category weights: <strong>{WEIGHTS_LABEL}</strong>.</p>

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
          <p className="mt-2 text-gray-700">We check up to {HEXAGON_COUNT} things (we call them hexagons): {countSentence()}. Each one ends up in exactly one of three states:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-gray-700">
            <li><strong>Found</strong>: your browser showed us a real value.</li>
            <li><strong>Checked and clear</strong>: we could check, and there was nothing to show. Only a few things can ever be clear.</li>
            <li><strong>Not checked</strong>: we could not tell, the check failed or was blocked, or this site cannot check it. This is <strong>not</strong> the same as clear and <strong>not</strong> the same as found.</li>
          </ul>
          <p className="mt-3 text-gray-700">
            The things are grouped into nine categories. Each category gets its own exposure: the sensitivity of what was found, as a share of the sensitivity of everything we checked in it. Sensitive things count up to three times more than low-sensitivity ones. The categories are then combined, with these weights:
          </p>
          <table className="mt-3 w-full border border-gray-200 bg-white text-left text-gray-700">
            <thead><tr className="bg-gray-100"><th className="p-2">Category</th><th className="p-2">Weight</th><th className="p-2">Weight used today</th></tr></thead>
            <tbody>
              {(Object.entries(CATEGORY_WEIGHTS) as [keyof typeof CATEGORY_WEIGHTS, number][]).sort((a, b) => b[1] - a[1]).map(([k, w]) => (
                <tr key={k} className="border-t border-gray-200"><td className="p-2">{CATEGORY_LABEL[k]}</td><td className="p-2">{w}%</td><td className="p-2">{effective(k, w)}%</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-gray-700">A category where nothing was checked is left out, and the others share the weight. The result is rounded to a whole number, and halves round up.</p>
          <p className="mt-3 text-gray-700">
            These weights are <strong>version 1, interim</strong>: they are the figures our two earlier formulas already used, approved on 2026-11-08, and we will revisit them once there is enough real scan data. If a weight ever changes, the label above and the method version change with it.
          </p>
          <p className="mt-3 text-gray-700">
            <strong>Social accounts</strong> carry a 20% weight on paper, but none of its checks can be done from a web page, so today it is always "not checked" and left out. The last column shows what that means: the other categories share its weight, so the weight actually used today for social accounts is 0%. If we add a check that works from a web page, the 20% starts to count.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Overlapping checks and ordinary browser features</h2>
          <p className="mt-2 text-gray-700">
            Some checks look at related things. <strong>Battery</strong> and the battery part of the browser fingerprint, <strong>Screen</strong> and the screen part of the fingerprint, and the <strong>WebRTC leak</strong> check and the <strong>DNS leak</strong> check each count as separate items, because each one shows a different thing: a battery reading, a screen size, a real network address. DNS leak cannot be checked from a web page today, so it is "not checked". We say this plainly rather than merging them, because merging would hide which one your browser revealed.
          </p>
          <p className="mt-2 text-gray-700">
            Ordinary browser features such as your language and the orientation of your device are counted like everything else, at low sensitivity, because every site you visit can read them. They are in the score on purpose, with low weight, and they are why almost no one scores zero. We do not check accessibility settings (for example reduced motion or larger text) at all today, so they never affect your score. If we ever add such a check, it will not be treated as risky or as a mistake: nobody should be marked down for how they use their device.</p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Three things the score is not</h2>
          <p className="mt-2 text-gray-700">
            <strong>Progress, accuracy and exposure are different things.</strong> How far through the scan you are is task progress and does not change the score. Whether a result is right is a question of accuracy, and each result says how sure we are. The score only measures exposure: how much was revealed. <strong>Sensitivity is not personal risk.</strong> A high-sensitivity item is one that is more revealing in general, not one that is more dangerous for you in particular. <strong>The number of things shown is not how identifiable you are.</strong> Many common items together can describe a lot of people, while one rare item can describe only you, and the score does not try to tell those apart.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">What the score covers: channels and places</h2>
          <p className="mt-2 text-gray-700">
            The score describes what <strong>this web scan</strong> could see from your browser, on this device, at the time of the scan. It does not include what you share through other channels, such as Telegram, WhatsApp or email, or what other sites or companies already hold about you. It is the same method wherever you are in the world: we do not weight it differently by country, and the location a scan sees is only what your network shows.
          </p>
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
