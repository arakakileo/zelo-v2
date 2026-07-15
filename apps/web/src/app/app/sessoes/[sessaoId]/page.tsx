'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  CatalogoEstruturadoResponse,
  CatalogEntryEstruturado,
  RelatorioSessao,
  buttonPrimaryClass,
  buttonSecondaryClass,
  formatCredits,
  formatDateTime,
  glassCard,
  isResultadoClinico,
  motorStatusLabel,
  safeApi,
  statusSessaoLabel,
  useRequireAuth,
} from '@/lib/app';
import { RespostaWizardModal } from './_components/RespostaWizardModal';

export default function SessaoDetalhePage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const router = useRouter();
  const token = useRequireAuth();
  const [sessaoId, setSessaoId] = useState('');
  const [relatorio, setRelatorio] = useState<RelatorioSessao | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  // Carrega o catálogo estruturado de forma tolerante (item 2 do card):
  // se o endpoint falhar, devolvemos null e o wizard cai no fallback.
  const [catalogoEstruturado, setCatalogoEstruturado] =
    useState<CatalogoEstruturadoResponse | null>(null);

  useEffect(() => {
    params.then((resolved) => setSessaoId(resolved.sessaoId));
  }, [params]);

  const load = async () => {
    if (!token || !sessaoId) return;
    const data = await safeApi<RelatorioSessao>(
      router,
      `/testes/sessoes/${sessaoId}/relatorio`,
      { token },
    );
    setRelatorio(data);
  };

  // Carrega o catálogo estruturado uma vez por token — não depende do sessaoId,
  // mas só roda após o token estar disponível para não disparar 401 antes do login.
  useEffect(() => {
    if (!token) return;
    safeApi<CatalogoEstruturadoResponse>(
      router,
      '/testes/catalogo-estruturado',
      { token },
    )
      .then((data) => setCatalogoEstruturado(data))
      .catch(() => {
        // tolerante: deixa null; wizard usa fallback JSON
        setCatalogoEstruturado(null);
      });
  }, [token, router]);

  useEffect(() => {
    if (!token || !sessaoId) return;
    load()
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao carregar sessão'),
      )
      .finally(() => setLoading(false));
  }, [sessaoId, token]);

  // Casa o teste da sessão com a definição estruturada pelo slug (item 2).
  // Se o slug estiver ausente (sessão antiga) OU se o catálogo não carregou,
  // devolve null → wizard abre em modo fallback-JSON.
  const definicaoEstruturada: CatalogEntryEstruturado | null = useMemo(() => {
    if (!relatorio) return null;
    const slug = relatorio.teste.slug;
    if (!slug) return null;
    const found = (catalogoEstruturado?.tests ?? []).find((t) => t.slug === slug);
    return found ?? null;
  }, [relatorio, catalogoEstruturado]);

  async function handleCancelar() {
    if (!token || !sessaoId) return;
    setCanceling(true);
    setError('');
    try {
      await safeApi(router, `/testes/sessoes/${sessaoId}/cancelar`, {
        token,
        method: 'POST',
      });
      setSuccess('Sessão cancelada e créditos estornados.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cancelar sessão');
    } finally {
      setCanceling(false);
    }
  }

  /**
   * Callback invocado pelo wizard quando o POST de finalizar falha.
   *  - `mutated` → servidor mutou a sessão (ex: BLOQUEADO_REGRA após 422).
   *    Fechamos o modal e mostramos erro/estado atualizado na página,
   *    recarregando o relatório. Se a sessão já veio no body do erro,
   *    reaproveitamos; senão, refazemos o GET.
   *  - `validation` → erro de validação sem mutação. Mantemos o modal
   *    aberto (parent não interfere); apenas mostramos um toast leve
   *    para confirmar que o erro foi visto pelo servidor.
   */
  function handleWizardError(
    reason: 'mutated' | 'validation',
    sessaoAtualizada: typeof relatorio,
  ) {
    if (reason === 'mutated') {
      setWizardOpen(false);
      const isBloqueada = sessaoAtualizada?.status === 'BLOQUEADO_REGRA';
      const isFinalizada = sessaoAtualizada?.status === 'FINALIZADO';
      setError(
        isBloqueada
          ? 'O motor de scoring bloqueou esta sessão (regra indisponível ou não-clínica). Os créditos foram estornados.'
          : isFinalizada
            ? 'A sessão já consta como finalizada no servidor.'
            : 'A sessão mudou de estado no servidor.',
      );
      load().catch((err) =>
        setError(err instanceof Error ? err.message : 'Erro ao recarregar relatório'),
      );
    }
    // 'validation' → modal mantém draft + mensagem interna; nada a fazer aqui.
  }

  if (!token || loading) {
    return <p className="text-sm text-white/40">Carregando sessão...</p>;
  }

  if (!relatorio) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
        Sessão não encontrada.
      </div>
    );
  }

  const isAberta = relatorio.status === 'ABERTO';
  const isBloqueada = relatorio.status === 'BLOQUEADO_REGRA';
  const hasResultadoClinico =
    isResultadoClinico(relatorio.motor.status) && relatorio.resultadoClinico !== null;

  return (
    <section className="space-y-6">
      <div className={glassCard + ' p-6'}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/40">Sessão</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">
              {relatorio.teste.sigla} — {relatorio.teste.nome}
            </h1>
            <p className="mt-2 text-sm text-white/50">Paciente: {relatorio.paciente.nome}</p>
            <p className="mt-1 text-sm text-white/35">
              Aplicado por: {relatorio.psicologo.nome}
              {relatorio.psicologo.registro ? ` (CRP ${relatorio.psicologo.registro})` : ''}
            </p>
            {relatorio.teste.slug && definicaoEstruturada && (
              <p className="mt-1 text-xs text-white/30">
                Definição estruturada disponível ({definicaoEstruturada.fields.length} campos).
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
              {statusSessaoLabel(relatorio.status)}
            </span>
            {relatorio.motor.status && !isAberta && (
              <span className="text-xs text-white/35">{motorStatusLabel(relatorio.motor.status)}</span>
            )}
          </div>
        </div>
        {relatorio.finalizadoEm && (
          <p className="mt-3 text-xs text-white/30">
            Finalizada em {formatDateTime(relatorio.finalizadoEm)}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
          {error}
          {isBloqueada && (
            <p className="mt-2 text-xs text-red-300/70">
              O motor de scoring bloqueou esta sessão (regra indisponível ou não-clínica). Os
              créditos foram estornados automaticamente.
            </p>
          )}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400">
          {success}
        </div>
      )}

      {isAberta && (
        <div className={glassCard + ' p-6'}>
          <p className="text-sm text-white/40">Finalizar sessão</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Registrar respostas</h2>
          <p className="mt-2 text-xs text-white/35">
            {definicaoEstruturada ? (
              <>
                Definição estruturada disponível ({definicaoEstruturada.fields.length} campos).
                O wizard vai guiá-lo por uma pergunta numérica por etapa.
              </>
            ) : relatorio.teste.slug ? (
              <>
                O teste possui definição estruturada, mas o catálogo detalhado não pôde ser
                carregado. O wizard abrirá no modo editor JSON avançado.
              </>
            ) : (
              <>
                Este teste não possui definição estruturada registrada. O wizard abrirá no
                modo editor JSON avançado — você informa as respostas no formato canônico{' '}
                <code className="rounded bg-white/5 px-1 py-0.5 text-white/55">
                  {`{"campo": numero}`}
                </code>
                .
              </>
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className={buttonPrimaryClass}
            >
              Registrar respostas
            </button>
            <button
              type="button"
              disabled={canceling}
              onClick={handleCancelar}
              className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 font-medium text-amber-300 transition-colors hover:bg-amber-500/20"
            >
              {canceling ? 'Cancelando...' : 'Cancelar sessão (estornar)'}
            </button>
          </div>
        </div>
      )}

      {!isAberta && (
        <div className="grid gap-6 xl:grid-cols-2">
          {hasResultadoClinico && relatorio.resultadoClinico && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Resultado clínico</p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-xs text-white/35">Score</p>
                  <p className="mt-1 text-3xl font-semibold text-white">
                    {relatorio.resultadoClinico.score}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/35">Classificação</p>
                  <p className="mt-1 text-lg text-white/80">{relatorio.resultadoClinico.banda}</p>
                </div>
                <div>
                  <p className="text-xs text-white/35">Versão do motor</p>
                  <p className="mt-1 text-sm text-white/60">
                    {relatorio.resultadoClinico.versaoMotor} (regra{' '}
                    {relatorio.resultadoClinico.versaoRegra})
                  </p>
                </div>
              </div>
            </div>
          )}

          {isBloqueada && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Sessão bloqueada</p>
              <div className="mt-4 space-y-3">
                <p className="text-sm text-white/70">
                  Esta sessão foi bloqueada pelo motor de scoring SATEPSI. {relatorio.motor.observacao}
                </p>
                {relatorio.estorno && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    Créditos estornados: {formatCredits(relatorio.estorno.valor)}
                    <br />
                    <span className="text-xs text-emerald-300/70">{relatorio.estorno.motivo}</span>
                  </div>
                )}
                <p className="text-xs text-white/35">
                  Status do motor: {motorStatusLabel(relatorio.motor.status)}
                </p>
              </div>
            </div>
          )}

          {relatorio.conclusaoPsicologo && (
            <div className={glassCard + ' p-6'}>
              <p className="text-sm text-white/40">Conclusão do psicólogo</p>
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                {relatorio.conclusaoPsicologo}
              </p>
            </div>
          )}

          {/* Compliance SATEPSI: status DEMO NUNCA deve aparecer como
              resultado clínico real. Mostra painel explícito "Demo (não-clínico)"
              com a observação do motor, mas SEM score/banda do resultado. */}
          {!hasResultadoClinico &&
            !isBloqueada &&
            relatorio.status === 'FINALIZADO' &&
            relatorio.motor.status === 'DEMO' && (
              <div className={glassCard + ' p-6'}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/40">Resultado</p>
                    <p className="mt-1 text-base font-medium text-amber-200">
                      Demo (não-clínico)
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                    Adaptador determinístico
                  </span>
                </div>
                <p className="mt-4 text-sm text-white/65">
                  Este teste foi processado por um adapter determinístico
                  não-clínico. <strong className="font-semibold text-white/80">
                    O score/banda persistido é apenas para auditoria interna e não
                    representa um resultado clínico válido</strong> — não utilize
                  este número para diagnóstico, laudo ou tomada de decisão clínica.
                </p>
                {relatorio.motor.observacao && (
                  <p className="mt-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-white/55">
                    <span className="text-white/40">Observação do motor: </span>
                    {relatorio.motor.observacao}
                  </p>
                )}
                <p className="mt-3 text-xs text-white/40">
                  Versão do motor: {relatorio.motor.versao ?? '—'}
                  {relatorio.motor.versaoRegra ? ` · regra ${relatorio.motor.versaoRegra}` : ''}
                </p>
                <p className="mt-3 text-xs text-white/40">
                  Para resultados clínicos reais, é necessário uma regra
                  <em> PRODUCAO </em> licenciada (atualmente nenhuma existe no repositório).
                </p>
              </div>
            )}

          {!hasResultadoClinico &&
            !isBloqueada &&
            relatorio.status === 'FINALIZADO' &&
            relatorio.motor.status !== 'DEMO' && (
              <div className={glassCard + ' p-6'}>
                <p className="text-sm text-white/40">Resultado</p>
                <p className="mt-4 text-sm text-white/50">
                  Sem resultado clínico disponível para esta sessão.
                </p>
              </div>
            )}
        </div>
      )}

      <div className="flex gap-3">
        <Link href="/app/testes" className={buttonSecondaryClass}>
          ← Voltar para testes
        </Link>
      </div>

      {/* Wizard modal — só renderiza quando aberto */}
      <RespostaWizardModal
        open={wizardOpen}
        token={token}
        sessaoId={sessaoId}
        testeSigla={relatorio.teste.sigla}
        testeNome={relatorio.teste.nome}
        definicao={definicaoEstruturada}
        onClose={() => setWizardOpen(false)}
        onFinalizado={async () => {
          setWizardOpen(false);
          setSuccess('Sessão finalizada com sucesso.');
          try {
            await load();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro ao recarregar relatório');
          }
        }}
        onError={handleWizardError}
      />
    </section>
  );
}