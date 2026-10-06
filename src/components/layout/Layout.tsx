import { Suspense, useEffect } from "react";
import { Helmet } from "react-helmet";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import MatrixRain from "@/components/MatrixRain";
import Seo from "@/components/Seo";
import pageMeta from "@/data/pageMeta.json";

const { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION } = pageMeta["/"];

const Layout = () => {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace("#", "");
    const timeout = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 0);
    return () => clearTimeout(timeout);
  }, [location.pathname, location.hash]);

  // index.html's canonical/description/robots/og/twitter tags carry data-react-helmet so Helmet replaces
  // them instead of duplicating them. Defaults below (title, description, og/twitter, canonical);
  // deeper <Helmet>/<Seo> instances override.
  // Default self-referencing canonical (no query/hash, no trailing slash). Pages that
  // render their own <Helmet> canonical override this because react-helmet keeps the
  // deepest instance. Without it every route inherits the homepage canonical from index.html.
  const canonicalPath = location.pathname.replace(/\/+$/, "");

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <Seo title={DEFAULT_TITLE} description={DEFAULT_DESCRIPTION} path={canonicalPath} />
      <Helmet>
        <meta name="robots" content="index, follow" />
      </Helmet>
      <MatrixRain />
      <div className="relative z-10 flex min-h-screen flex-1 flex-col">
        <Header />
        <main className="flex-1">
          {/* Route chunks load lazily (App.tsx); a full-viewport placeholder keeps the footer below the fold so it cannot shift into view (CLS). */}
          <Suspense fallback={<div className="min-h-screen" aria-busy="true" />}>
            <Outlet />
          </Suspense>
        </main>
        <Footer />
      </div>
    </div>
  );
};

export default Layout;
