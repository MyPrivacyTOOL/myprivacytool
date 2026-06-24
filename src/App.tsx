import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import LocaleIntent from "./pages/LocaleIntent";
import TestLocale from "./pages/TestLocale";
import DeviceOrientation from "./pages/DeviceOrientation";
import ModelPerformance from "./pages/ModelPerformance";
import TheEncyclical from "./pages/TheEncyclical";
import Scan from "./pages/Scan";
import Report from "./pages/Report";
import Business from "./pages/Business";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/locale-intent" element={<LocaleIntent />} />
          <Route path="/test-locale" element={<TestLocale />} />
          <Route path="/device-orientation" element={<DeviceOrientation />} />
          <Route path="/model-performance" element={<ModelPerformance />} />
          <Route path="/the-encyclical" element={<TheEncyclical />} />
          <Route path="/thepope" element={<Navigate to="/the-encyclical" replace />} />
          {/* Marketing landing pages */}
          <Route path="/scan" element={<Scan />} />
          <Route path="/report" element={<Report />} />
          <Route path="/business" element={<Business />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
