import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  getTimerVolume,
  setTimerVolume,
  getTimerAutoStart,
  setTimerAutoStart,
} from "@/components/MessageTimer";

export default function MessageTimerExtraSettings() {
  const [volume, setVolume] = useState<number>(getTimerVolume());
  const [autoStart, setAutoStart] = useState<boolean>(getTimerAutoStart());

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">Volume do alarme</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">{Math.round(volume * 100)}%</div>
        </div>
        <Slider
          value={[Math.round(volume * 100)]}
          min={0}
          max={100}
          step={5}
          onValueChange={([v]) => {
            const f = v / 100;
            setVolume(f);
            setTimerVolume(f);
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Iniciar automaticamente</div>
          <div className="text-[11px] text-muted-foreground">Cada mensagem nova dispara o cronômetro sozinho.</div>
        </div>
        <Switch
          checked={autoStart}
          onCheckedChange={(v) => {
            setAutoStart(v);
            setTimerAutoStart(v);
          }}
        />
      </div>
    </div>
  );
}
