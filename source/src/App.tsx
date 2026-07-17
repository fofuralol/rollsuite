import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router-dom";
import { lazy, Suspense } from "react";
import { IS_DESKTOP } from "@/lib/runtime";

const Router: any = IS_DESKTOP ? HashRouter : BrowserRouter;
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";

import AppLayout from "@/components/AppLayout";
import MontanteResultOverlay from "@/components/MontanteResultOverlay";

const CalculadoraPage = lazy(() => import("./pages/CalculadoraPage"));
const DkDashPage = lazy(() => import("./pages/DkDashPage"));
const ChavesPixPage = lazy(() => import("./pages/ChavesPixPage"));
const WhatsAppPage = lazy(() => import("./pages/WhatsAppPage"));
const MonitorPage = lazy(() => import("./pages/MonitorPage"));
const ProxyPage = lazy(() => import("./pages/ProxyPage"));
const LicensesPage = lazy(() => import("./pages/LicensesPage"));
const Auth = lazy(() => import("./pages/Auth"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      {IS_DESKTOP && <MontanteResultOverlay />}
      <Router>
        <AuthProvider>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<DkDashPage />} />
                <Route path="/calc" element={<CalculadoraPage />} />
                <Route path="/dkdash" element={<DkDashPage />} />
                <Route path="/pix" element={<ChavesPixPage />} />
                <Route path="/whatsapp" element={<WhatsAppPage />} />
                <Route path="/monitor" element={<MonitorPage />} />
                <Route path="/proxy" element={<ProxyPage />} />
                <Route path="/licenses" element={<LicensesPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
