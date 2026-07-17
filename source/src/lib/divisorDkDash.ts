// Algoritmo idêntico ao calcularSplitter() do DK Dash (montante.js)
// Garante soma exata == total. Para total > 2000, divide em chunks de 2000 + resto,
// distribuindo as contas proporcionalmente entre cada chunk.
export function divisorDkDash(total: number, contas: number, minManual: number = 0): number[] {
  if (!Number.isFinite(total) || !Number.isFinite(contas)) return [];
  total = Math.floor(total);
  contas = Math.floor(contas);
  if (total <= 0 || contas <= 0) return [];
  contas = Math.min(contas, 10_000);
  if (contas === 1) return [total];

  const MAX_TOTAL = 2000;
  const MAX_CONTAS = 10;

  // Quebra recursiva quando passa do limite (em valor OU em contas)
  if (total > MAX_TOTAL || contas > MAX_CONTAS) {
    // 1) divide o total em pedaços de 2000 + resto
    const numFull = Math.floor(total / MAX_TOTAL);
    const rem = total - numFull * MAX_TOTAL;
    const totalChunks: number[] = [];
    for (let i = 0; i < numFull; i++) totalChunks.push(MAX_TOTAL);
    if (rem > 0) totalChunks.push(rem);

    // 2) aloca contas proporcional ao valor de cada chunk (somando exatamente `contas`)
    const counts = totalChunks.map((c) => Math.max(1, Math.round((contas * c) / total)));
    let diff = contas - counts.reduce((a, b) => a + b, 0);
    while (diff > 0) {
      const idx = Math.floor(Math.random() * counts.length);
      counts[idx]++;
      diff--;
    }
    while (diff < 0) {
      const idx = counts.findIndex((c) => c > 1);
      if (idx < 0) break;
      counts[idx]--;
      diff++;
    }

    const out: number[] = [];
    totalChunks.forEach((c, k) => {
      let n = counts[k];
      if (n <= 0) return;
      // se ainda passa de 10 contas dentro do chunk, sub-divide o chunk
      if (n > MAX_CONTAS) {
        const subParts = Math.ceil(n / MAX_CONTAS);
        const baseN = Math.floor(n / subParts);
        const extraN = n - baseN * subParts;
        const baseC = Math.floor(c / subParts);
        const extraC = c - baseC * subParts;
        for (let s = 0; s < subParts; s++) {
          const sn = baseN + (s < extraN ? 1 : 0);
          const sc = baseC + (s < extraC ? 1 : 0);
          if (sn > 0 && sc > 0) out.push(...divisorDkDash(sc, sn, minManual));
        }
      } else {
        out.push(...divisorDkDash(c, n, minManual));
      }
    });

    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ===== caso base: total <= 2000 e contas <= 10 =====
  let GAP_MINIMO = 18;
  let somaGaps = (GAP_MINIMO * (contas * (contas - 1))) / 2;

  const minPorConta = 1;
  if (somaGaps + contas * minPorConta > total) {
    const denom = (contas * (contas - 1)) / 2;
    GAP_MINIMO = denom > 0 ? Math.max(1, Math.floor((total - contas * minPorConta) / denom)) : 1;
    somaGaps = (GAP_MINIMO * (contas * (contas - 1))) / 2;
  }

  const baseMinimaObrigatoria = contas * minManual;
  if (total < baseMinimaObrigatoria + somaGaps) {
    minManual = 0;
  }

  const percentualDesejado = total <= 1000 ? 0.15 : 0.12;
  const minSugerido = Math.floor(total * percentualDesejado);

  let startingVal = Math.max(minManual, minSugerido);
  const maxPossivelDePartida = Math.floor((total - somaGaps) / contas);
  startingVal = Math.max(minPorConta, Math.min(startingVal, maxPossivelDePartida));

  const baseDistribuida = contas * startingVal + somaGaps;
  const remaining = Math.max(0, total - baseDistribuida);

  const pesos: number[] = [];
  let somaPesos = 0;
  for (let i = 0; i < contas; i++) {
    const peso = Math.pow(Math.random(), 3);
    pesos.push(peso);
    somaPesos += peso;
  }

  const sobrasAleatorias: number[] = [];
  let sobraDistribuida = 0;
  for (let i = 0; i < contas - 1; i++) {
    const add = Math.floor(remaining * (pesos[i] / somaPesos));
    sobrasAleatorias.push(add);
    sobraDistribuida += add;
  }
  sobrasAleatorias.push(remaining - sobraDistribuida);
  sobrasAleatorias.sort((a, b) => a - b);

  const result: number[] = [];
  for (let i = 0; i < contas; i++) {
    result.push(startingVal + i * GAP_MINIMO + sobrasAleatorias[i]);
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
