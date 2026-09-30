import { useEffect } from "react";
import { Helmet } from "react-helmet";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";
import MatrixRain from "@/components/MatrixRain";

const SITE_URL = "https://www.myprivacytool.io";
const DEFAULT_DESCRIPTION =
  "Discover what data brokers know about you in 3 minutes. See your location, device, ISP, and 8+ data points detected without asking. Free privacy scan.";

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

  // index.html's canonical/description/robots carry data-react-helmet so Helmet replaces them
  // instead of duplicating them. Defaults below; deeper <Helmet>/<Seo> instances override.
  // Default self-referencing canonical (no query/hash, no trailing slash). Pages that
  // render their own <Helmet> canonical override this because react-helmet keeps the
  // deepest instance. Without it every route inherits the homepage canonical from index.html.
  const canonicalPath = location.pathname.replace(/\/+$/, "");

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip">
      <Helmet>
        <link rel="canonical" href={`${SITE_URL}${canonicalPath}`} />
        <meta name="description" content={DEFAULT_DESCRIPTION} />
        <meta name="robots" content="index, follow" />
      </Helmet>
      <MatrixRain />
      <div className="relative z-10 flex min-h-screen flex-1 flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  );
};

export default Layout;
