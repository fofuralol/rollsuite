import { MessageSquare } from "lucide-react";
import WhatsAppPanel from "@/components/WhatsAppPanel";
import WhatsAppListenerPanel from "@/components/WhatsAppListenerPanel";
import WhatsAppDebugLog from "@/components/WhatsAppDebugLog";

export default function WhatsAppPage() {
  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold">Monitor WhatsApp</h1>
      </div>
      <WhatsAppListenerPanel />
      <WhatsAppDebugLog />
      <WhatsAppPanel />
    </div>
  );
}
