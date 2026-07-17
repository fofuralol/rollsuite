import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Wallet, LayoutDashboard, Layers, Trophy } from "lucide-react";
import DkDashLucrosPanel from "@/components/DkDashLucrosPanel";
import BalancoDiarioPanel from "@/components/BalancoDiarioPanel";
import DkDashMainPanel from "@/components/DkDashMainPanel";
import PlatformAnalysisPanel from "@/components/PlatformAnalysisPanel";
import RankingRollSuitePanel from "@/components/RankingRollSuitePanel";

export default function DkDashPage() {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <Tabs defaultValue="main" className="w-full">
        <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="main" className="gap-1.5">
              <LayoutDashboard className="w-3.5 h-3.5" />
              Principal
            </TabsTrigger>
            <TabsTrigger value="lucros" className="gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" />
              Ciclos
            </TabsTrigger>
            <TabsTrigger value="balanco" className="gap-1.5">
              <Wallet className="w-3.5 h-3.5" />
              Balanço do dia
            </TabsTrigger>
            <TabsTrigger value="plataformas" className="gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              Plataformas
            </TabsTrigger>
            <TabsTrigger value="ranking" className="gap-1.5">
              <Trophy className="w-3.5 h-3.5" />
              Ranking RollSuite
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="main">
          <DkDashMainPanel />
        </TabsContent>
        <TabsContent value="lucros">
          <DkDashLucrosPanel />
        </TabsContent>
        <TabsContent value="balanco">
          <BalancoDiarioPanel />
        </TabsContent>
        <TabsContent value="plataformas">
          <PlatformAnalysisPanel />
        </TabsContent>
        <TabsContent value="ranking">
          <RankingRollSuitePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
