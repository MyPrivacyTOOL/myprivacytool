import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Index from "./pages/Index";
import Scan from "./pages/Scan";
import Report from "./pages/Report";
import Business from "./pages/Business";
import Start from "./pages/Start";
import Newsletter from "./pages/Newsletter";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Pricing from "./pages/Pricing";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Faq from "./pages/Faq";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import Cookies from "./pages/Cookies";
import OptOutGuides from "./pages/OptOutGuides";
import RemoveFromInternet from "./pages/guides/RemoveFromInternet";
import RemoveFromGoogle from "./pages/guides/RemoveFromGoogle";
import StopSpam from "./pages/guides/StopSpam";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Index />} />
            {/* Marketing landing pages */}
            <Route path="/scan" element={<Scan />} />
            <Route path="/report" element={<Report />} />
            <Route path="/business" element={<Business />} />
            {/* Messaging / First Hexagon entry point */}
            <Route path="/start" element={<Start />} />
            {/* Lead capture */}
            <Route path="/newsletter" element={<Newsletter />} />
            {/* Blog section */}
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            {/* Info pages */}
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/cookies" element={<Cookies />} />
            {/* Guides */}
            <Route path="/opt-out-guides" element={<OptOutGuides />} />
            <Route path="/guides/remove-my-info-from-internet" element={<RemoveFromInternet />} />
            <Route path="/guides/remove-from-google" element={<RemoveFromGoogle />} />
            <Route path="/guides/stop-spam" element={<StopSpam />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
