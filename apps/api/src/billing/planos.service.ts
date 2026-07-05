/**
 * Preço por crédito extra (PAYG) por plano, com suporte a rampa
 * progressiva opcional via `PlanoCobrancaExtra[]` no plano.
 *
 * @param plano plano do usuário
 * @param creditosExtrasJaConsumidosNoCiclo créditos extras já consumidos
 *   no ciclo. O próximo crédito é o de índice `+1` (1-indexed).
 */
export function calcularPrecoUnitarioCreditoExtra(
  plano: { precoPaygBRL: unknown; faixasExtra?: { faixaInicio: number; faixaFim: number | null; precoBRL: unknown }[] },
  creditosExtrasJaConsumidosNoCiclo: number,
): { precoUnitario: number; proximoIndice: number; motivo: string } {
  const proximoIndice = creditosExtrasJaConsumidosNoCiclo + 1;

  const faixas = (plano.faixasExtra ?? []).slice().sort((a, b) => a.faixaInicio - b.faixaInicio);
  if (faixas.length === 0) {
    return { precoUnitario: Number(plano.precoPaygBRL), proximoIndice, motivo: 'preco_fixo_plano' };
  }

  for (const faixa of faixas) {
    const inicio = faixa.faixaInicio;
    const fim = faixa.faixaFim ?? Number.MAX_SAFE_INTEGER;
    if (proximoIndice >= inicio && proximoIndice <= fim) {
      return { precoUnitario: Number(faixa.precoBRL), proximoIndice, motivo: 'faixa_progressiva' };
    }
  }

  return { precoUnitario: Number(plano.precoPaygBRL), proximoIndice, motivo: 'fallback_preco_fixo' };
}
