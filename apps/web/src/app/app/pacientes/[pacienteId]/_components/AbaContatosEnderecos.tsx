'use client';

import { useState, type FormEvent } from 'react';
import {
  PacienteContato,
  PacienteEndereco,
  glassCard,
  inputClass,
  safeApi,
  buttonSecondaryClass,
} from '@/lib/app';
import type { DetalheCallbacks, DetalheState } from './state';

const TIPOS_CONTATO = ['EMAIL', 'TELEFONE', 'CELULAR', 'WHATSAPP'] as const;
const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

interface Props {
  state: DetalheState;
  callbacks: DetalheCallbacks;
}

export function AbaContatosEnderecos({ state, callbacks }: Props) {
  const { token, router, paciente, contatos, enderecos } = state;

  const [contatoForm, setContatoForm] = useState({ tipo: 'EMAIL' as string, valor: '' });
  const [enderecoForm, setEnderecoForm] = useState({
    logradouro: '',
    bairro: '',
    complemento: '',
    cep: '',
    numero: '',
    cidade: '',
    estado: 'SP',
  });
  const [savingContato, setSavingContato] = useState(false);
  const [savingEndereco, setSavingEndereco] = useState(false);
  const [error, setError] = useState('');

  if (!paciente) return null;

  async function handleAddContato(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    setSavingContato(true);
    setError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/contatos`, {
        token,
        method: 'POST',
        body: JSON.stringify(contatoForm),
      });
      setContatoForm({ tipo: 'EMAIL', valor: '' });
      await callbacks.reloadContatos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar contato');
    } finally {
      setSavingContato(false);
    }
  }

  async function handleRemoveContato(contatoId: string) {
    if (!paciente) return;
    setError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/contatos/${contatoId}`, {
        token,
        method: 'DELETE',
      });
      await callbacks.reloadContatos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover contato');
    }
  }

  async function handleAddEndereco(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paciente) return;
    setSavingEndereco(true);
    setError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/enderecos`, {
        token,
        method: 'POST',
        body: JSON.stringify({
          ...enderecoForm,
          complemento: enderecoForm.complemento || undefined,
        }),
      });
      setEnderecoForm({
        logradouro: '',
        bairro: '',
        complemento: '',
        cep: '',
        numero: '',
        cidade: '',
        estado: 'SP',
      });
      await callbacks.reloadEnderecos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar endereço');
    } finally {
      setSavingEndereco(false);
    }
  }

  async function handleRemoveEndereco(enderecoId: string) {
    if (!paciente) return;
    setError('');
    try {
      await safeApi(router, `/pacientes/${paciente.id}/enderecos/${enderecoId}`, {
        token,
        method: 'DELETE',
      });
      await callbacks.reloadEnderecos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao remover endereço');
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className={glassCard + ' p-6'}>
        <p className="text-sm text-white/40">Contatos</p>
        <p className="text-xs text-white/35">
          {contatos.length} cadastrado{contatos.length === 1 ? '' : 's'}
        </p>

        <div className="mt-4 space-y-3">
          {contatos.length === 0 ? (
            <p className="text-sm text-white/40">Nenhum contato cadastrado.</p>
          ) : (
            contatos.map((contato: PacienteContato) => (
              <div
                key={contato.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"
              >
                <div>
                  <span className="text-white/35">{contato.tipo}: </span>
                  <span className="text-white/80">{contato.valor}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveContato(contato.id)}
                  className="text-xs text-red-400 transition-colors hover:text-red-300"
                  aria-label={`Remover contato ${contato.tipo} ${contato.valor}`}
                >
                  Remover
                </button>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleAddContato}
          className="mt-4 space-y-3 border-t border-white/10 pt-4"
          aria-label="Adicionar contato"
        >
          <div className="flex gap-2">
            <select
              className={inputClass + ' w-auto'}
              value={contatoForm.tipo}
              onChange={(e) => setContatoForm((prev) => ({ ...prev, tipo: e.target.value }))}
              aria-label="Tipo de contato"
            >
              {TIPOS_CONTATO.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {tipo}
                </option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Valor (email ou telefone)"
              value={contatoForm.valor}
              onChange={(e) => setContatoForm((prev) => ({ ...prev, valor: e.target.value }))}
              required
              aria-label="Valor do contato"
            />
          </div>
          <button type="submit" disabled={savingContato} className={buttonSecondaryClass + ' w-full'}>
            {savingContato ? 'Adicionando...' : 'Adicionar contato'}
          </button>
        </form>
      </div>

      <div className={glassCard + ' p-6'}>
        <p className="text-sm text-white/40">Endereços</p>
        <p className="text-xs text-white/35">
          {enderecos.length} cadastrado{enderecos.length === 1 ? '' : 's'}
        </p>

        <div className="mt-4 space-y-3">
          {enderecos.length === 0 ? (
            <p className="text-sm text-white/40">Nenhum endereço cadastrado.</p>
          ) : (
            enderecos.map((endereco: PacienteEndereco) => (
              <div
                key={endereco.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm"
              >
                <div className="text-white/70">
                  <p>
                    {endereco.logradouro}, {endereco.numero}
                  </p>
                  <p className="text-white/50">
                    {endereco.bairro} — {endereco.cidade}/{endereco.estado}
                  </p>
                  <p className="text-white/35">
                    CEP {endereco.cep}
                    {endereco.complemento ? ` · ${endereco.complemento}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveEndereco(endereco.id)}
                  className="text-xs text-red-400 transition-colors hover:text-red-300"
                  aria-label={`Remover endereço ${endereco.logradouro}`}
                >
                  Remover
                </button>
              </div>
            ))
          )}
        </div>

        <form
          onSubmit={handleAddEndereco}
          className="mt-4 space-y-3 border-t border-white/10 pt-4"
          aria-label="Adicionar endereço"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={inputClass}
              placeholder="Logradouro"
              value={enderecoForm.logradouro}
              onChange={(e) =>
                setEnderecoForm((prev) => ({ ...prev, logradouro: e.target.value }))
              }
              required
              aria-label="Logradouro"
            />
            <input
              className={inputClass}
              placeholder="Número"
              value={enderecoForm.numero}
              onChange={(e) => setEnderecoForm((prev) => ({ ...prev, numero: e.target.value }))}
              required
              aria-label="Número"
            />
            <input
              className={inputClass}
              placeholder="Bairro"
              value={enderecoForm.bairro}
              onChange={(e) => setEnderecoForm((prev) => ({ ...prev, bairro: e.target.value }))}
              required
              aria-label="Bairro"
            />
            <input
              className={inputClass}
              placeholder="CEP (8 dígitos)"
              maxLength={8}
              value={enderecoForm.cep}
              onChange={(e) => setEnderecoForm((prev) => ({ ...prev, cep: e.target.value }))}
              required
              aria-label="CEP"
            />
            <input
              className={inputClass}
              placeholder="Cidade"
              value={enderecoForm.cidade}
              onChange={(e) => setEnderecoForm((prev) => ({ ...prev, cidade: e.target.value }))}
              required
              aria-label="Cidade"
            />
            <select
              className={inputClass}
              value={enderecoForm.estado}
              onChange={(e) => setEnderecoForm((prev) => ({ ...prev, estado: e.target.value }))}
              aria-label="UF"
            >
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </div>
          <input
            className={inputClass}
            placeholder="Complemento (opcional)"
            value={enderecoForm.complemento}
            onChange={(e) =>
              setEnderecoForm((prev) => ({ ...prev, complemento: e.target.value }))
            }
            aria-label="Complemento"
          />
          <button
            type="submit"
            disabled={savingEndereco}
            className={buttonSecondaryClass + ' w-full'}
          >
            {savingEndereco ? 'Adicionando...' : 'Adicionar endereço'}
          </button>
        </form>

        {error && (
          <div
            className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
            role="alert"
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
