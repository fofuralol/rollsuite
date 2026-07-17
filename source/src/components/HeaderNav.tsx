import { Calculator, BarChart3, MessageSquare, KeyRound, Monitor, Wifi, SplitSquareHorizontal } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useSplitView } from "@/hooks/useSplitView";
import { cn } from "@/lib/utils";

const items = [
  { title: "Financeiro", url: "/", icon: BarChart3 },
  { title: "Calculadora", url: "/calc", icon: Calculator },
  { title: "Chaves Pix", url: "/pix", icon: KeyRound },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageSquare },
  { title: "Painel de Tarefas", url: "/monitor", icon: Monitor },
  { title: "Monitor Proxy", url: "/proxy", icon: Wifi },
];

export function HeaderNav() {
  const { pathname } = useLocation();
  const { secondary, toggle } = useSplitView();

  return (
    <nav className="flex items-center gap-0.5">
      {items.map((item) => {
        const isPrimary = pathname === item.url;
        const isSecondary = secondary === item.url;
        const Icon = item.icon;
        return (
          <div key={item.url} className="group/nav relative flex items-center shrink-0">
            <NavLink
              to={item.url}
              end
              className={cn(
                "flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                isPrimary
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{item.title}</span>
            </NavLink>
            {!isPrimary && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(item.url); }}
                title={isSecondary ? "Fechar painel dividido" : "Abrir em painel dividido"}
                className={cn(
                  "ml-0.5 h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition opacity-0 group-hover/nav:opacity-100",
                  isSecondary && "opacity-100 text-primary bg-primary/10"
                )}
              >
                <SplitSquareHorizontal className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
