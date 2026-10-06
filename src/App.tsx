import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Index from "./pages/Index";
const Scan = lazy(() => import("./pages/Scan"));
const Report = lazy(() => import("./pages/Report"));
const Business = lazy(() => import("./pages/Business"));
const Start = lazy(() => import("./pages/Start"));
const AIAccessCheck = lazy(() => import("./pages/AIAccessCheck"));
const Newsletter = lazy(() => import("./pages/Newsletter"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Pricing = lazy(() => import("./pages/Pricing"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Faq = lazy(() => import("./pages/Faq"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Cookies = lazy(() => import("./pages/Cookies"));
const OptOutGuides = lazy(() => import("./pages/OptOutGuides"));
const OptOutGuide = lazy(() => import("./pages/OptOutGuide"));
const Journey = lazy(() => import("./pages/Journey"));
const AmIExposed = lazy(() => import("./pages/AmIExposed"));
const NotFound = lazy(() => import("./pages/NotFound"));

// MPC-7200: every route except the home page is code-split so the first paint only downloads what it renders.
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
            {/* Guides */}
            <Route path="/opt-out-guides" element={<OptOutGuides />} />
            <Route path="/opt-out-guides/:slug" element={<OptOutGuide />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/am-i-exposed" element={<AmIExposed />} />
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
