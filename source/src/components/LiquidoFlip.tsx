import { useState } from "react";

type Props = {
  liquido: number;
  bruto: number;
  format: (v: number) => string;
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
  liquidoLabel?: string;
  brutoLabel?: string;
  showLabel?: boolean;
};

/**
 * Mostra o valor líquido por padrão. Ao clicar, gira (rotateY) e mostra o bruto.
 * Bruto = retorno - investido (sem comissão).
 */
export default function LiquidoFlip({
  liquido,
  bruto,
  format,
  className = "",
  valueClassName = "",
  labelClassName = "text-[9px] font-bold tracking-[0.15em] text-muted-foreground",
  liquidoLabel = "LÍQUIDO",
  brutoLabel = "BRUTO",
  showLabel = false,
}: Props) {
  const [flipped, setFlipped] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setFlipped((v) => !v); }}
      className={`group [perspective:1000px] cursor-pointer text-left ${className}`}
      title={flipped ? "Mostrar líquido" : "Mostrar bruto"}
    >
      <div
        className="relative transition-transform duration-500 [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Frente: líquido */}
        <div className="[backface-visibility:hidden]">
          {showLabel && <p className={labelClassName}>{liquidoLabel}</p>}
          <span className={`whitespace-nowrap ${valueClassName}`}>{format(liquido)}</span>
        </div>
        {/* Verso: bruto */}
        <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {showLabel && <p className={labelClassName}>{brutoLabel}</p>}
          <span className={`whitespace-nowrap ${valueClassName}`}>{format(bruto)}</span>
        </div>
      </div>
    </button>
  );
}
