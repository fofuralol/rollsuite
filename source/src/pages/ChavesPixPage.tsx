import ChavesPixPanel from "@/components/ChavesPixPanel";
import PixImportExportButtons from "@/components/PixImportExportButtons";
import BankPriorityPanel from "@/components/BankPriorityPanel";
import { KeyRound } from "lucide-react";

const ChavesPixPage = () => {
  return (
    <div className="container mx-auto max-w-3xl p-4 md:p-6">
      <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 tracking-tight">
            <KeyRound className="w-5 h-5 md:w-6 md:h-6 text-primary" />
            Chaves Pix
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Gerencie suas chaves Pix. Arraste para reordenar, clique para editar.
          </p>
        </div>
        <PixImportExportButtons />
      </header>
      <BankPriorityPanel />
      <ChavesPixPanel />
    </div>
  );
};

export default ChavesPixPage;
