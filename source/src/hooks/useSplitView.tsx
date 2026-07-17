import { createContext, useContext, useState, ReactNode, ComponentType, lazy } from "react";

const CalculadoraPage = lazy(() => import("@/pages/CalculadoraPage"));
const DkDashPage = lazy(() => import("@/pages/DkDashPage"));
const ChavesPixPage = lazy(() => import("@/pages/ChavesPixPage"));
const WhatsAppPage = lazy(() => import("@/pages/WhatsAppPage"));
const MonitorPage = lazy(() => import("@/pages/MonitorPage"));
const ProxyPage = lazy(() => import("@/pages/ProxyPage"));

export const SPLIT_PAGES: Record<string, { label: string; Component: ComponentType }> = {
  "/": { label: "DK Dash Lucros", Component: DkDashPage },
  "/calc": { label: "Calculadora", Component: CalculadoraPage },
  "/dkdash": { label: "DK Dash Lucros", Component: DkDashPage },
  "/pix": { label: "Chaves Pix", Component: ChavesPixPage },
  "/whatsapp": { label: "Monitor WhatsApp", Component: WhatsAppPage },
  "/monitor": { label: "Monitor Turno+Wpp", Component: MonitorPage },
  "/proxy": { label: "Monitor Proxy", Component: ProxyPage },
};

type Ctx = {
  secondary: string | null;
  setSecondary: (path: string | null) => void;
  toggle: (path: string) => void;
};

const SplitCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = "splitview_secondary";

export function SplitViewProvider({ children }: { children: ReactNode }) {
  const [secondary, setSecondaryState] = useState<string | null>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "__none__") return null;
      return v && SPLIT_PAGES[v] ? v : "/monitor";
    } catch {
      return "/monitor";
    }
  });
  const setSecondary = (path: string | null) => {
    setSecondaryState(path);
    try {
      if (path) localStorage.setItem(STORAGE_KEY, path);
      else localStorage.setItem(STORAGE_KEY, "__none__");
    } catch {}
  };
  const toggle = (path: string) =>
    setSecondary(secondary === path ? null : path);
  return (
    <SplitCtx.Provider value={{ secondary, setSecondary, toggle }}>
      {children}
    </SplitCtx.Provider>
  );
}
export function useSplitView() {
  const ctx = useContext(SplitCtx);
  if (!ctx) throw new Error("useSplitView must be used inside SplitViewProvider");
  return ctx;
}
