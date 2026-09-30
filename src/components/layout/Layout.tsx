import { useEffect } from "react";
import { Helmet } from "react-helmet";
import { Outlet, useLocation } from "react-router-dom";
import Header from "./Header";
import Footer from "./Footer";

const SITE_URL = "https://www.myprivacytool.io";

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

  // Default self-referencing canonical (no query/hash, no trailing slash). Pages that
  // render their own <Helmet> canonical override this because react-helmet keeps the
  // deepest instance. Without it every route inherits the homepage canonical from index.html.
  const canonicalPath = location.pathname.replace(/\/+$/, "");

  return (
    <div className="flex min-h-screen flex-col">
      <Helmet>
        <link rel="canonical" href={`${SITE_URL}${canonicalPath}`} />
      </Helmet>
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
};

export default Layout;
