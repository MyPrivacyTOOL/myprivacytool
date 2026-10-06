import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Index from "./pages/Index";
import Scan from "./pages/Scan";
import Report from "./pages/Report";
import Business from "./pages/Business";
import Start from "./pages/Start";
import AIAccessCheck from "./pages/AIAccessCheck";
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
import DPA from "./pages/DPA";
import Trust from "./pages/Trust";
import OptOutGuides from "./pages/OptOutGuides";
import OptOutGuide from "./pages/OptOutGuide";
import Journey from "./pages/Journey";
import AmIExposed from "./pages/AmIExposed";
import Developers from "./pages/Developers";
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
            <Route path="/ai-access-check" element={<AIAccessCheck />} />
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
            <Route path="/dpa" element={<DPA />} />
            <Route path="/trust" element={<Trust />} />
            {/* Guides */}
            <Route path="/opt-out-guides" element={<OptOutGuides />} />
            <Route path="/opt-out-guides/:slug" element={<OptOutGuide />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/am-i-exposed" element={<AmIExposed />} />
            {/* Developer portal (MPC-7250) */}
            <Route path="/developers" element={<Developers />} />
            <Route path="/guides/remove-my-info-from-internet" element={<Navigate to="/blog/remove-personal-information-from-internet" replace />} />
            <Route path="/guides/remove-from-google" element={<Navigate to="/blog/remove-your-name-and-info-from-google" replace />} />
            <Route path="/guides/stop-spam" element={<Navigate to="/blog/stop-spam-calls-texts-and-emails" replace />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
