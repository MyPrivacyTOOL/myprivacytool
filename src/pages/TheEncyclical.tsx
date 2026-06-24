import { useEffect } from "react";
import { Link } from "react-router-dom";

const TheEncyclical = () => {
  useEffect(() => {
    document.title = "The Encyclical | MyPrivacyTOOL";
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans">

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-white font-bold text-lg tracking-tight">
            MyPrivacyTOOL
          </Link>
          <Link
            to="/"
            className="text-sm text-white/60 hover:text-white transition-colors"
          >
            ← Back
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="pt-32 pb-20 px-6 text-center max-w-4xl mx-auto">
        <div className="inline-block bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/50 tracking-widest uppercase mb-8">
          Papal Encyclical · May 2025
        </div>
        <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6 tracking-tight">
          The Pope Said It.<br />
          <span className="text-white/40">We Built It.</span>
        </h1>
        <p className="text-xl text-white/60 max-w-2xl mx-auto leading-relaxed mb-10">
          In <em>Magnifica Humanitas</em>, Pope Leo XIV warned that the digital economy
          turns human beings into data to be harvested. MyPrivacyTOOL was built to
          give that data back.
        </p>
        <a
          href="https://myprivacytool.io/#waitlist"
          className="inline-block bg-white text-black font-semibold px-8 py-4 rounded-full hover:bg-white/90 transition-colors text-sm tracking-wide"
        >
          Join the Waitlist
        </a>
      </section>

      {/* ── PULL QUOTE 1 ── */}
      <section className="py-16 px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <blockquote className="text-2xl md:text-3xl font-light leading-relaxed text-white/80 italic text-center">
            "Every click, every search, every purchase leaves a trace. Taken together,
            these traces compose a portrait of each person — their desires, their fears,
            their vulnerabilities."
          </blockquote>
          <p className="text-center text-white/30 text-sm mt-6 tracking-widest uppercase">
            Magnifica Humanitas §16 · Pope Leo XIV
          </p>
        </div>
      </section>

      {/* ── SECTION A: THE ORIGIN STORY ── */}
      <section className="py-20 px-6 max-w-5xl mx-auto">
        <div className="grid md:grid-cols-2 gap-16 items-start">
          <div>
            <p className="text-xs text-white/30 tracking-widest uppercase mb-4">How It Started</p>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight">
              It began with a username.
            </h2>
            <p className="text-white/60 leading-relaxed mb-4">
              The first time you signed into an app with Google or Facebook, it felt
              convenient. One tap. No password to remember. But you handed something
              over: your identity — cross-referenced, timestamped, linked.
            </p>
            <p className="text-white/60 leading-relaxed mb-4">
              That authentication became the seed. The apps you used built profiles.
              The platforms those apps connected to aggregated them. Data brokers
              bought, packaged and resold what remained.
            </p>
            <p className="text-white/60 leading-relaxed">
              Today there are over 4,000 data brokers operating globally. Most people
              appear on hundreds of them. Almost no one knows.
            </p>
          </div>
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-4xl font-bold text-white mb-2">4,000+</p>
              <p className="text-white/50 text-sm">data brokers operating globally</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-4xl font-bold text-white mb-2">700+</p>
              <p className="text-white/50 text-sm">data points held on the average adult</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
              <p className="text-4xl font-bold text-white mb-2">$240B</p>
              <p className="text-white/50 text-sm">global data broker industry annual revenue</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PULL QUOTE 2 ── */}
      <section className="py-16 px-6 border-t border-white/5 bg-white/[0.02]">
        <div className="max-w-3xl mx-auto">
          <blockquote className="text-2xl md:text-3xl font-light leading-relaxed text-white/80 italic text-center">
            "The human person is not a node in a network, not a data point to be
            optimised, not a consumer profile to be monetised. The human person is
            made in the image of God."
          </blockquote>
          <p className="text-center text-white/30 text-sm mt-6 tracking-widest uppercase">
            Magnifica Humanitas §95 · Pope Leo XIV
          </p>
        </div>
      </section>

      {/* ── SECTION B: THE AI INFLECTION ── */}
      <section className="py-20 px-6 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs text-white/30 tracking-widest uppercase mb-4">The Inflection Point</p>
          <h2 className="text-3xl md:text-4xl font-bold leading-tight max-w-2xl mx-auto">
            AI changed the equation permanently.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="text-2xl mb-4">📍</div>
            <h3 className="font-semibold mb-2">Before AI</h3>
            <p className="text-white/50 text-sm leading-relaxed">
              Data brokers sold static lists. Advertisers matched demographics.
              Annoying, but largely blunt.
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 border-white/20">
            <div className="text-2xl mb-4">⚡</div>
            <h3 className="font-semibold mb-2">The Shift</h3>
            <p className="text-white/50 text-sm leading-relaxed">
              LLMs can now infer personality, mental state, financial stress and
              political persuadability from digital exhaust alone.
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="text-2xl mb-4">🔒</div>
            <h3 className="font-semibold mb-2">After AI</h3>
            <p className="text-white/50 text-sm leading-relaxed">
              Your exposure isn't just your data anymore. It's what AI can
              reconstruct about you from fragments you never knowingly shared.
            </p>
          </div>
        </div>
      </section>

      {/* ── PULL QUOTE 3 ── */}
      <section className="py-16 px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto">
          <blockquote className="text-2xl md:text-3xl font-light leading-relaxed text-white/80 italic text-center">
            "We call on technologists, entrepreneurs and investors: build tools that
            protect rather than exploit. The market for human dignity is waiting to
            be served."
          </blockquote>
          <p className="text-center text-white/30 text-sm mt-6 tracking-widest uppercase">
            Magnifica Humanitas §171 · Pope Leo XIV
          </p>
        </div>
      </section>

      {/* ── SECTION C: DOCTRINE ALIGNMENT ── */}
      <section className="py-20 px-6 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs text-white/30 tracking-widest uppercase mb-4">Where We Stand</p>
          <h2 className="text-3xl md:text-4xl font-bold leading-tight max-w-2xl mx-auto">
            Five doctrines. One product.
          </h2>
          <p className="text-white/50 mt-4 max-w-xl mx-auto">
            The encyclical names the problem precisely. MyPrivacyTOOL is the answer
            to each of its five core concerns.
          </p>
        </div>
        <div className="space-y-4">
          {[
            {
              doctrine: "Human Dignity",
              quote: "§9 — The body's interiority must not be made transparent to algorithmic inspection.",
              response: "We show you what's exposed and help you close it down.",
            },
            {
              doctrine: "Informational Self-Determination",
              quote: "§16 — Every person must retain the right to control the narrative of their own life.",
              response: "We give you the tools to see, dispute and remove your data.",
            },
            {
              doctrine: "Solidarity",
              quote: "§136 — The vulnerable are most exposed. Privacy is not a luxury.",
              response: "We price for accessibility. Privacy tools shouldn't cost £20/month.",
            },
            {
              doctrine: "Common Good",
              quote: "§95 — No algorithm may substitute for human judgment in matters of personal consequence.",
              response: "We flag risk. You decide. We never automate removal without consent.",
            },
            {
              doctrine: "Subsidiarity",
              quote: "§171 — The market for human dignity is waiting to be served.",
              response: "We are that market. Built by entrepreneurs, for people.",
            },
          ].map((item) => (
            <div
              key={item.doctrine}
              className="bg-white/5 border border-white/10 rounded-2xl p-6 grid md:grid-cols-3 gap-4 items-start"
            >
              <div>
                <p className="font-semibold text-white">{item.doctrine}</p>
              </div>
              <div>
                <p className="text-white/40 text-sm italic leading-relaxed">{item.quote}</p>
              </div>
              <div>
                <p className="text-white/70 text-sm leading-relaxed">{item.response}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6 border-t border-white/10 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
            The market for human dignity<br />
            <span className="text-white/40">is open.</span>
          </h2>
          <p className="text-white/60 text-lg mb-10 leading-relaxed">
            Join the waitlist. Be among the first to see what's out there —
            and take it back.
          </p>
          <a
            href="https://myprivacytool.io/#waitlist"
            className="inline-block bg-white text-black font-semibold px-10 py-4 rounded-full hover:bg-white/90 transition-colors text-sm tracking-wide mr-4"
          >
            Join the Waitlist
          </a>
          <a
            href="https://www.vatican.va/content/leo-xiv/en/encyclicals/documents/magnifica-humanitas.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block border border-white/20 text-white/60 font-medium px-8 py-4 rounded-full hover:border-white/40 hover:text-white/80 transition-colors text-sm"
          >
            Read the Encyclical →
          </a>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-10 px-6 border-t border-white/5 text-center">
        <p className="text-white/20 text-sm">
          © {new Date().getFullYear()} MyPrivacyTOOL · Built in response to{" "}
          <em>Magnifica Humanitas</em> · Pope Leo XIV, 2025
        </p>
      </footer>

    </div>
  );
};

export default TheEncyclical;
