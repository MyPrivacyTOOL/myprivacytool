import { Toaster } from "@/components/ui/toaster";
import CookieBanner from "@/components/CookieBanner";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Index from "./pages/Index";
const Scan = lazy(() => import("./pages/Scan"));
const ScanLiveView = lazy(() => import("./pages/ScanLiveView"));
const DeepDive = lazy(() => import("./pages/DeepDive"));
const Report = lazy(() => import("./pages/Report"));
const Business = lazy(() => import("./pages/Business"));
const Enterprise = lazy(() => import("./pages/Enterprise"));
const Start = lazy(() => import("./pages/Start"));
const AIAccessCheck = lazy(() => import("./pages/AIAccessCheck"));
const ThankYou = lazy(() => import("./pages/ThankYou"));
const Unsubscribe = lazy(() => import("./pages/Unsubscribe"));
const Invite = lazy(() => import("./pages/Invite"));
const Newsletter = lazy(() => import("./pages/Newsletter"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const Pricing = lazy(() => import("./pages/Pricing"));
const About = lazy(() => import("./pages/About"));
const Contact = lazy(() => import("./pages/Contact"));
const Faq = lazy(() => import("./pages/Faq"));
const ScoreMethod = lazy(() => import("./pages/ScoreMethod"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const Cookies = lazy(() => import("./pages/Cookies"));
const AcceptableUse = lazy(() => import("./pages/AcceptableUse"));
const DPA = lazy(() => import("./pages/DPA"));
const Trust = lazy(() => import("./pages/Trust"));
const Developers = lazy(() => import("./pages/Developers"));
const OptOutGuides = lazy(() => import("./pages/OptOutGuides"));
const OptOutGuide = lazy(() => import("./pages/OptOutGuide"));
const Journey = lazy(() => import("./pages/Journey"));
const AmIExposed = lazy(() => import("./pages/AmIExposed"));
const ConnectGitHubPage = lazy(() => import("./pages/ConnectGitHub"));
const Monitoring = lazy(() => import("./pages/Monitoring"));
const ScanResults = lazy(() => import("./pages/ScanResults"));
const HongKongSpam = lazy(() => import("./pages/HongKongSpam"));
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
            <Route path="/scan/live" element={<ScanLiveView />} />
            <Route path="/scan/deep-dive" element={<DeepDive />} />
            <Route path="/report" element={<Report />} />
            <Route path="/business" element={<Business />} />
            <Route path="/enterprise" element={<Enterprise />} />
            {/* Messaging / First Hexagon entry point */}
            <Route path="/start" element={<Start />} />
            {/* Lead capture */}
            <Route path="/newsletter" element={<Newsletter />} />
            <Route path="/ai-access-check" element={<AIAccessCheck />} />
            <Route path="/thank-you" element={<ThankYou />} />
            <Route path="/unsubscribe" element={<Unsubscribe />} />
            <Route path="/invite" element={<Invite />} />
            {/* MPC-8454 + MPC-8455: Scan results reveal flow */}
            <Route path="/scan-results" element={<ScanResults />} />
            {/* Blog section */}
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            {/* Info pages */}
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/how-we-calculate-your-score" element={<ScoreMethod />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/cookies" element={<Cookies />} />
            <Route path="/acceptable-use" element={<AcceptableUse />} />
            <Route path="/dpa" element={<DPA />} />
            <Route path="/trust" element={<Trust />} />
            {/* Guides */}
            <Route path="/opt-out-guides" element={<OptOutGuides />} />
            <Route path="/opt-out-guides/:slug" element={<OptOutGuide />} />
            <Route path="/journey" element={<Journey />} />
            <Route path="/am-i-exposed" element={<AmIExposed />} />
            <Route path="/connect/github" element={<ConnectGitHubPage />} />
            {/* Developer portal (MPC-7250) */}
            <Route path="/developers" element={<Developers />} />
            <Route path="/guides/remove-my-info-from-internet" element={<Navigate to="/blog/remove-personal-information-from-internet" replace />} />
            <Route path="/guides/remove-from-google" element={<Navigate to="/blog/remove-your-name-and-info-from-google" replace />} />
            <Route path="/guides/stop-spam" element={<Navigate to="/blog/stop-spam-calls-texts-and-emails" replace />} />
            {/* MPC-7649: Pro monitoring dashboard preview. Noindex, hidden in production until live data exists. */}
            <Route path="/monitoring" element={<Monitoring />} />
            {/* MPC-7446: bilingual HK Do-not-call page. Route matching ignores case, so /hongkongspam renders the
                page, which redirects to the canonical /HongKongSpam. Noindex and unlinked until the hkSpam.json flag. */}
            <Route path="/HongKongSpam" element={<HongKongSpam />} />
            <Route path="/stop-spam-hk" element={<Navigate to="/HongKongSpam" replace />} />
            <Route path="/hong-kong-spam" element={<Navigate to="/HongKongSpam" replace />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
        <CookieBanner />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
