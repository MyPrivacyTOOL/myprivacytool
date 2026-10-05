import Seo from "@/components/Seo";
import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <Seo title="Page not found | MyPrivacyTOOL" description="The page you were looking for does not exist. Check your exposure from the MyPrivacyTOOL homepage." noindex />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold text-foreground">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Page not found</p>
        <a href="/" className="text-foreground underline hover:text-muted-foreground">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
