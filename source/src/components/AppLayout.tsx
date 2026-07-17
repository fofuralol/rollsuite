import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, ComponentType, lazy, Suspense } from "react";
import { useAuth } from "@/hooks/useAuth";
import TurnoAlertOverlay from "@/components/TurnoAlertOverlay";
import TurnoFloatingPopup from "@/components/TurnoFloatingPopup";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { SplitViewProvider, useSplitView, SPLIT_PAGES } from "@/hooks/useSplitView";
import { PaneContainerProvider } from "@/hooks/usePaneContainer";
import HeaderPixConsult from "@/components/HeaderPixConsult";
import { HeaderNav } from "@/components/HeaderNav";
import SettingsDialog from "@/components/SettingsDialog";
import ComprovantePopupsHost from "@/components/ComprovantePopupsHost";
import UpdateAvailablePopup from "@/components/UpdateAvailablePopup";
import { useRankingPresence } from "@/hooks/useRankingPresence";

const LicensesPage = lazy(() => import("@/pages/LicensesPage"));

// Keep-alive: cada guia visitada permanece montada; alternar entre elas apenas
// troca CSS `display`. Elimina o custo de remontar páginas pesadas (MonitorPage,
// DkDashPage, etc.) a cada navegação, deixando a troca instantânea.
const KEEP_ALIVE_PAGES: Record<string, ComponentType> = {
  ...Object.fromEntries(Object.entries(SPLIT_PAGES).map(([k, v]) => [k, v.Component])),
  "/licenses": LicensesPage,
};

function KeepAliveOutlet() {
  const { pathname } = useLocation();
  const visitedRef = useRef<Set<string>>(new Set());
  const activePath = KEEP_ALIVE_PAGES[pathname] ? pathname : null;
  if (activePath) visitedRef.current.add(activePath);
  const visited = Array.from(visitedRef.current);

  // Fallback: rota desconhecida ainda usa Outlet padrão do Router.
  if (!activePath) return <Outlet />;

  return (
    <Suspense fallback={null}>
      {visited.map((p) => {
        const Comp = KEEP_ALIVE_PAGES[p];
        const active = p === activePath;
        return (
          <div
            key={p}
            style={{ display: active ? "block" : "none" }}
            className="h-full"
            aria-hidden={!active}
          >
            <Comp />
          </div>
        );
      })}
    </Suspense>
  );
}

function MainArea() {
  const { secondary } = useSplitView();
  const { pathname } = useLocation();

  const secondaryEntry = secondary && secondary !== pathname ? SPLIT_PAGES[secondary] : null;

  if (!secondaryEntry) {
    return (
      <main className="flex-1 min-w-0 min-h-0">
        <PaneContent>
          <KeepAliveOutlet />
        </PaneContent>
      </main>
    );
  }

  const SecondaryComponent = secondaryEntry.Component;

  return (
    <main className="flex-1 min-w-0 min-h-0">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={50} minSize={20}>
          <PaneContent>
            <KeepAliveOutlet />
          </PaneContent>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={20}>
          <PaneContent>
            <SecondaryComponent />
          </PaneContent>
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>
  );
}

function PaneContent({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setEl} className="h-full relative overflow-hidden">
      <div className="h-full overflow-auto scrollbar-hide">
        <PaneContainerProvider container={el}>{children}</PaneContainerProvider>
      </div>
    </div>
  );
}


function DeferredRankingPresence() {
  useRankingPresence();
  return null;
}

export default function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [presenceReady, setPresenceReady] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [user, loading, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setPresenceReady(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (loading || !user) return null;

  return (
    <SplitViewProvider>
      <div className="flex flex-col w-full bg-background overflow-hidden" style={{ height: "var(--app-vh, 100vh)" }}>
        <header className="h-11 flex items-center gap-1 border-b border-border bg-card/40 sticky top-0 z-10 px-2 overflow-hidden">
          <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
            <HeaderNav />
            <SettingsDialog />
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <HeaderPixConsult />
          </div>
        </header>

        <div className="flex-1 flex min-w-0 min-h-0">
          <MainArea />
        </div>

        <TurnoAlertOverlay />
        <TurnoFloatingPopup />
        <ComprovantePopupsHost />
        <UpdateAvailablePopup />
        {presenceReady && <DeferredRankingPresence />}
      </div>
    </SplitViewProvider>
  );
}

