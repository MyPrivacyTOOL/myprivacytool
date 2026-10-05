import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";
import { Link } from "react-router-dom";

const About = () => (
  <>
    <Seo {...pageMeta["/about"]} path="/about" />
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="mb-2 text-4xl font-bold text-gray-900">About MyPrivacyTOOL</h1>
        <p className="mb-8 text-lg text-gray-600">Helping people see and control their digital shadow.</p>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Our mission</h2>
          <p className="text-gray-700">
            Every browser and device gives away information about you, usually without you noticing. We believe
            you should be able to see that information plainly, understand what it means, and decide what to do
            about it.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">What MyPrivacyTOOL does</h2>
          <p className="text-gray-700">
            MyPrivacyTOOL shows you your digital shadow: the signals your device and browser reveal to the
            websites you visit. It turns them into a visual map of Privacy Hexagons and a risk score, and points
            you to practical steps and opt-out guides.
          </p>
          <p className="mt-4 text-gray-700">
            <Link to="/" className="text-primary underline">Run a free scan</Link> to see your own hexagons, or
            read our <Link to="/faq" className="text-primary underline">FAQ</Link> and{" "}
            <Link to="/privacy" className="text-primary underline">Privacy Policy</Link> for what we collect.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Why APAC first</h2>
          <p className="text-gray-700">
            We are based in Hong Kong. Most consumer privacy tools are built around US and European rules and
            audiences, while people across Asia-Pacific live under a patchwork of different laws, such as Hong
            Kong's PDPO and Singapore's PDPA, and have far fewer tools built with them in mind. We start in the
            region we know and work in.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Founder</h2>
          <p className="text-gray-700">
            MyPrivacyTOOL was founded by Chris Ransford, who has more than 20 years of experience working with
            enterprises across Asia-Pacific.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Company</h2>
          <p className="text-gray-700">
            MyPrivacyTOOL Ltd
            <br />
            12E, Block 5, 8 Pak Lai Road, Park Island, Ma Wan, Tsuen Wan District, New Territories, Hong Kong, HK99
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">Contact</h2>
          <p className="text-gray-700">
            Questions or feedback? Visit our <Link to="/contact" className="text-primary underline">contact page</Link>{" "}
            or email{" "}
            <a href="mailto:support@myprivacytool.io" className="text-primary underline">support@myprivacytool.io</a>.
          </p>
        </section>
      </div>
    </main>
  </>
);

export default About;
