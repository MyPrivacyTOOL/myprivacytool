import Seo from "@/components/Seo";
import { Link } from "react-router-dom";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ComingSoonPageProps {
  title: string;
  description: string;
}

const ComingSoonPage = ({ title, description }: ComingSoonPageProps) => {
  return (
    <>
      <Seo title={`${title} | MyPrivacyTOOL`} description={description} noindex />
      <div className="min-h-[60vh] flex items-center justify-center px-4 py-20">
        <div className="max-w-lg text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Construction className="w-6 h-6 text-brand" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3">{title}</h1>
          <p className="text-muted-foreground mb-8">{description}</p>
          <p className="text-sm text-muted-foreground mb-8">
            This page is coming soon. In the meantime, check your exposure to see where your data is listed.
          </p>
          <Button asChild size="lg">
            <Link to="/scan">Check My Exposure</Link>
          </Button>
        </div>
      </div>
    </>
  );
};

export default ComingSoonPage;
