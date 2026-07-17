import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Share, Plus, Bell } from "lucide-react";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

export default function IOSInstallDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-primary" />
            Ativar notificações no iPhone
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            No iPhone, as notificações push só funcionam com o Monitor instalado na Tela de Início (iOS 16.4 ou superior, no Safari).
          </p>
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
              <span>
                Abra esta página no <b>Safari</b> (não funciona no Chrome do iPhone).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
              <span className="flex items-center gap-1.5 flex-wrap">
                Toque no botão <Share className="w-4 h-4 inline" /> <b>Compartilhar</b> (na barra inferior do Safari).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span>
              <span className="flex items-center gap-1.5 flex-wrap">
                Role e escolha <Plus className="w-4 h-4 inline" /> <b>Adicionar à Tela de Início</b>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex-none w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">4</span>
              <span>
                Abra o app <b>Monitor</b> pelo ícone novo na Tela de Início e toque no sininho de novo para permitir notificações.
              </span>
            </li>
          </ol>
          <p className="text-xs text-muted-foreground border-t border-border pt-3">
            Dica: depois de instalado, o app abre direto no Monitor, sem barra do navegador, e recebe notificações mesmo com o celular bloqueado.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
