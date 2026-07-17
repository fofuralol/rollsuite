// Cores baseadas nas logos oficiais dos bancos
export const BANCO_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "NUBANK":          { bg: "bg-[#820AD1]/15", text: "text-[#C77DFF]", border: "border-[#820AD1]/50" },
  "BRADESCO":        { bg: "bg-[#CC092F]/15", text: "text-[#FF6B81]", border: "border-[#CC092F]/50" },
  "BRADESCO CC":     { bg: "bg-[#CC092F]/15", text: "text-[#FF6B81]", border: "border-[#CC092F]/50" },
  "SANTANDER":       { bg: "bg-[#EC0000]/15", text: "text-[#FF5757]", border: "border-[#EC0000]/50" },
  "ITAÚ":            { bg: "bg-[#EC7000]/15", text: "text-[#FFA94D]", border: "border-[#EC7000]/50" },
  "ITAU":            { bg: "bg-[#EC7000]/15", text: "text-[#FFA94D]", border: "border-[#EC7000]/50" },
  "CAIXA":           { bg: "bg-[#0070AF]/15", text: "text-[#4DA3D9]", border: "border-[#0070AF]/50" },
  "BANCO DO BRASIL": { bg: "bg-[#FAE128]/15", text: "text-[#FAE128]", border: "border-[#FAE128]/50" },
  "PAGSEGURO":       { bg: "bg-[#00A868]/15", text: "text-[#3DD598]", border: "border-[#00A868]/50" },
  "PAGBANK":         { bg: "bg-[#00A868]/15", text: "text-[#3DD598]", border: "border-[#00A868]/50" },
  "PICPAY":          { bg: "bg-[#21C25E]/15", text: "text-[#5EE38C]", border: "border-[#21C25E]/50" },
  "99PAY":           { bg: "bg-[#FFD80B]/15", text: "text-[#FFD80B]", border: "border-[#FFD80B]/50" },
  "STONE":           { bg: "bg-[#00DC84]/15", text: "text-[#00DC84]", border: "border-[#00DC84]/50" },
  "AGIBANK":         { bg: "bg-[#FF6B00]/15", text: "text-[#FF8A3D]", border: "border-[#FF6B00]/50" },
  "SICREDI":         { bg: "bg-[#3FA535]/15", text: "text-[#5BC851]", border: "border-[#3FA535]/50" },
  "SUMUP":           { bg: "bg-[#1B73E8]/15", text: "text-[#5B9CF7]", border: "border-[#1B73E8]/50" },
  "NEON":            { bg: "bg-[#00E5C5]/15", text: "text-[#00E5C5]", border: "border-[#00E5C5]/50" },
  "EFÍ":             { bg: "bg-[#F37020]/15", text: "text-[#FF9555]", border: "border-[#F37020]/50" },
  "EFI":             { bg: "bg-[#F37020]/15", text: "text-[#FF9555]", border: "border-[#F37020]/50" },
  "WISE":            { bg: "bg-[#9FE870]/15", text: "text-[#9FE870]", border: "border-[#9FE870]/50" },
  "BANQI":           { bg: "bg-[#FF6E27]/15", text: "text-[#FF8A4F]", border: "border-[#FF6E27]/50" },
  "INFINITYPAY":     { bg: "bg-[#10F981]/15", text: "text-[#10F981]", border: "border-[#10F981]/50" },
  "INFINITEPAY":     { bg: "bg-[#10F981]/15", text: "text-[#10F981]", border: "border-[#10F981]/50" },
  "MERCADOPAGO":     { bg: "bg-[#00B1EA]/15", text: "text-[#4DD0F2]", border: "border-[#00B1EA]/50" },
  "MERCADO PAGO":    { bg: "bg-[#00B1EA]/15", text: "text-[#4DD0F2]", border: "border-[#00B1EA]/50" },
  "INTER":           { bg: "bg-[#FF7A00]/15", text: "text-[#FF9D45]", border: "border-[#FF7A00]/50" },
  "C6":              { bg: "bg-[#242424]/40", text: "text-zinc-200",  border: "border-zinc-500/50" },
  "NEXT":            { bg: "bg-[#00FF5F]/15", text: "text-[#5BFF94]", border: "border-[#00FF5F]/50" },
  "CELCOIN":         { bg: "bg-[#00C2FF]/15", text: "text-[#4DD7FF]", border: "border-[#00C2FF]/50" },
  "WILL":            { bg: "bg-[#FF4081]/15", text: "text-[#FF6B9D]", border: "border-[#FF4081]/50" },
  "WILL FINANCEIRA": { bg: "bg-[#FF4081]/15", text: "text-[#FF6B9D]", border: "border-[#FF4081]/50" },
};

export const getBancoColor = (banco: string) => {
  const key = (banco || "").toUpperCase().trim();
  return BANCO_COLORS[key] || { bg: "bg-muted", text: "text-foreground", border: "border-border" };
};
