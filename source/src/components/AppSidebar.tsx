import { Calculator, BarChart3, MessageSquare, LogOut, KeyRound, Monitor, Wifi, SplitSquareHorizontal, Download } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useSplitView } from "@/hooks/useSplitView";
import { cn } from "@/lib/utils";
import GlobalBackupButtons from "@/components/GlobalBackupButtons";
import rolldashExtAsset from "@/assets/rolldash-extension.zip.asset.json";
import extensionOpenAsset from "@/assets/extension-open.zip.asset.json";

const items = [
  { title: "Financeiro", url: "/", icon: BarChart3 },
  { title: "Calculadora", url: "/calc", icon: Calculator },
  { title: "Chaves Pix", url: "/pix", icon: KeyRound },
  { title: "WhatsApp", url: "/whatsapp", icon: MessageSquare },
  { title: "Painel de Tarefas", url: "/monitor", icon: Monitor },
  { title: "Monitor Proxy", url: "/proxy", icon: Wifi },
];

async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (e) {
    window.open(url, "_blank");
  }
}


export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { signOut, user } = useAuth();
  const { secondary, toggle } = useSplitView();

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-3 py-3">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary/15 flex items-center justify-center">
              <Calculator className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm font-semibold">Rolls Suite</span>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Painéis</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isPrimary = pathname === item.url;
                const isSecondary = secondary === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <div className="group/split flex items-center w-full">
                      <SidebarMenuButton asChild isActive={isPrimary} className="flex-1">
                        <NavLink to={item.url} end className="flex items-center gap-2">
                          <item.icon className="h-4 w-4" />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                      {!collapsed && !isPrimary && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(item.url); }}
                          title={isSecondary ? "Fechar painel dividido" : "Abrir em painel dividido"}
                          className={cn(
                            "ml-1 mr-1 h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition opacity-0 group-hover/split:opacity-100",
                            isSecondary && "opacity-100 text-primary bg-primary/10"
                          )}
                        >
                          <SplitSquareHorizontal className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-2 py-2">
        {!collapsed && user?.email && (
          <p className="text-[10px] text-muted-foreground truncate px-2 mb-1">
            {user.email.replace(/@rolls\.local$/, "")}
          </p>
        )}
        <GlobalBackupButtons collapsed={collapsed} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadFile(rolldashExtAsset.url, "rolldash-extensao.zip")}
          className="w-full justify-start gap-2 text-muted-foreground"
          title="Baixar extensão Chrome"
        >
          <Download className="w-4 h-4" />
          {!collapsed && <span>Baixar Extensão</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadFile(extensionOpenAsset.url, "rolldash-extensao-open.zip")}
          className="w-full justify-start gap-2 text-muted-foreground"
          title="Baixar extensão Chrome (sem serial)"
        >
          <Download className="w-4 h-4" />
          {!collapsed && <span>Baixar Extensão (Open)</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadFile("/zapo.zip", "zapo.zip")}
          className="w-full justify-start gap-2 text-muted-foreground"
          title="Baixar Zapo"
        >
          <Download className="w-4 h-4" />
          {!collapsed && <span>Baixar Zapo</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadFile("/zapo2.zip", "zapo2.zip")}
          className="w-full justify-start gap-2 text-muted-foreground"
          title="Baixar Zapo2 (standalone)"
        >
          <Download className="w-4 h-4" />
          {!collapsed && <span>Baixar Zapo2</span>}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start gap-2 text-muted-foreground"
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Sair</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
