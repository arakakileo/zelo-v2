/**
 * Helpers de janela de ciclo. Toda referência a mês de ciclo
 * passa por aqui para evitar inconsistência entre chamadas.
 */
export function getCicloAtual(ref: Date = new Date()): { yyyymm: string; inicio: Date; fim: Date } {
  const inicio = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
  const fim = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  const mm = String(inicio.getUTCMonth() + 1);
  const padded = mm.length < 2 ? '0' + mm : mm;
  const yyyymm = `${inicio.getUTCFullYear()}-${padded}`;
  return { yyyymm, inicio, fim };
}

export function yyyymmToBounds(yyyymm: string): { inicio: Date; fim: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) throw new Error(`Ciclo inválido: ${yyyymm}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const inicio = new Date(Date.UTC(ano, mes - 1, 1, 0, 0, 0, 0));
  const fim = new Date(Date.UTC(ano, mes, 1, 0, 0, 0, 0));
  return { inicio, fim };
}

export function addMonths(ref: Date, months: number): Date {
  return new Date(
    Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth() + months,
      ref.getUTCDate(),
      ref.getUTCHours(),
      ref.getUTCMinutes(),
      ref.getUTCSeconds(),
      ref.getUTCMilliseconds(),
    ),
  );
}
