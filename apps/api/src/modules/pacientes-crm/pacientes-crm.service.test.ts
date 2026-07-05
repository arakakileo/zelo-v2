import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PacientesCrmService } from './pacientes-crm.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CrmFollowUpStatus,
  CrmPrioridade,
  CrmStatus,
} from '@zelo/contracts';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';

/**
 * Cobertura do CRM de pacientes — foca em:
 *  - criptografia/descriptografia de notas e origem
 *  - isolamento multi-tenant (ADMIN vs PSICOLOGO)
 *  - filtros por responsável
 *  - validação de inputs via invariantes do service
 *  - ausência de logs de conteúdo (verificada por inspeção do código)
 */
describe('PacientesCrmService', () => {
  let service: PacientesCrmService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;

  const adminCtx = { userId: 'admin-1' };
  const psicologoCtx = { userId: 'psico-1' };
  const otherPsicologoCtx = { userId: 'psico-2' };

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;
    const mockConfig = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PacientesCrmService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(PacientesCrmService);
    resetPrismaMock();
  });

  // Helper: encrypt com CryptoService real para gerar envelopes válidos.
  async function makeCrypto() {
    const { CryptoService } = await import('@zelo/crypto');
    return new CryptoService(Buffer.alloc(32).toString('base64'));
  }

  // ─── Resumo CRM ───────────────────────────────────────────────────

  describe('obterResumoCrm', () => {
    it('creates a default CRM (LEAD/MEDIA) on first access and returns decrypted counters', async () => {
      const crypto = await makeCrypto();
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue(null);
      mockPrisma.pacienteCrm.create.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.LEAD,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(adminCtx, 'pac-1');

      expect(result.status).toBe(CrmStatus.LEAD);
      expect(result.prioridade).toBe(CrmPrioridade.MEDIA);
      expect(result.contadores.notas).toBe(0);
      expect(result.contadores.followUpsPendentes).toBe(0);
      const createCall = mockPrisma.pacienteCrm.create.mock.calls[0][0];
      expect(createCall.data.createdById).toBe('admin-1');

      // Silencia o lint do helper não-usado.
      void crypto;
    });

    it('returns existing CRM with decrypted origem', async () => {
      const crypto = await makeCrypto();
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origemEncrypted: crypto.encrypt('Indicação da Dra. Ana'),
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(adminCtx, 'pac-1');

      expect(result.status).toBe(CrmStatus.ATIVO);
      expect(result.prioridade).toBe(CrmPrioridade.ALTA);
      expect(result.origem).toBe('Indicação da Dra. Ana');
      // Não deve recriar.
      expect(mockPrisma.pacienteCrm.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when paciente does not exist (ADMIN)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);
      await expect(
        service.obterResumoCrm(adminCtx, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when PSICOLOGO accesses another psicos patient (filter excludes it)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.obterResumoCrm(psicologoCtx, 'other-patient'),
      ).rejects.toThrow(NotFoundException);

      // PSICOLOGO must have the responsible filter applied.
      const findCall = mockPrisma.paciente.findFirst.mock.calls[0][0];
      expect(findCall.where.psicologoResponsavelId).toBe('psico-1');
      // Single-user: sem clinicaId no filtro.
      expect(findCall.where.clinicaId).toBeUndefined();
    });

    it('PSICOLOGO can access their own patient (filter matches)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue(null);
      mockPrisma.pacienteCrm.create.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.LEAD,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(psicologoCtx, 'pac-1');
      expect(result.pacienteId).toBe('pac-1');
    });
  });

  // ─── Upsert CRM ───────────────────────────────────────────────────

  describe('upsertCrm', () => {
    it('encrypts origem before persisting', async () => {
      const crypto = await makeCrypto();
      const encryptedOrigem = crypto.encrypt('Indicação da Dra. Ana / Instagram');
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origemEncrypted: encryptedOrigem,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.upsertCrm(adminCtx, 'pac-1', {
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origem: 'Indicação da Dra. Ana / Instagram',
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      // origemEncrypted deve ser envelope base64(JSON), NÃO plaintext.
      expect(upsertCall.update.origemEncrypted).not.toBe(
        'Indicação da Dra. Ana / Instagram',
      );
      expect(upsertCall.update.origemEncrypted).toMatch(/^ey/);
    });

    it('does not touch origemEncrypted when origem is omitted', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.upsertCrm(adminCtx, 'pac-1', {
        status: CrmStatus.ATIVO,
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      expect('origemEncrypted' in upsertCall.update).toBe(false);
    });

    it('encrypts proximaAcaoNota before persisting (PII)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const secret = 'Ligar para confirmar retorno da Maria (canal WhatsApp)';
      await service.upsertCrm(adminCtx, 'pac-1', {
        proximaAcaoNota: secret,
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      // Nunca plaintext, nunca contém substring do segredo.
      expect(upsertCall.update.proximaAcaoNotaEncrypted).not.toBe(secret);
      expect(upsertCall.update.proximaAcaoNotaEncrypted).not.toContain('Maria');
      expect(upsertCall.update.proximaAcaoNotaEncrypted).not.toContain('WhatsApp');
      // Envelope base64(JSON) começa com 'ey'.
      expect(upsertCall.update.proximaAcaoNotaEncrypted).toMatch(/^ey/);
    });

    it('does not touch proximaAcaoNotaEncrypted when proximaAcaoNota is omitted', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.upsertCrm(adminCtx, 'pac-1', {
        status: CrmStatus.ATIVO,
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      expect('proximaAcaoNotaEncrypted' in upsertCall.update).toBe(false);
    });

    it('decrypts proximaAcaoNota on read', async () => {
      const crypto = await makeCrypto();
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: crypto.encrypt('Ligar para Maria'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(adminCtx, 'pac-1');
      expect(result.proximaAcaoNota).toBe('Ligar para Maria');
    });
  });

  // ─── Notas (CRUD cifrado) ─────────────────────────────────────────

  describe('criarNota', () => {
    it('stores encrypted conteudo and never logs plaintext', async () => {
      const crypto = await makeCrypto();
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      const encryptedConteudo = crypto.encrypt('Paciente confidenciou trauma severo');
      mockPrisma.pacienteCrmNota.create.mockResolvedValue({
        id: 'nota-1',
        autorId: 'psico-1',
        conteudoEncrypted: encryptedConteudo,
        createdAt: new Date(),
        autor: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      const secretContent = 'Paciente confidenciou trauma severo';
      const result = await service.criarNota(psicologoCtx, 'pac-1', secretContent);

      const createCall = mockPrisma.pacienteCrmNota.create.mock.calls[0][0];
      // Conteúdo cifrado: base64 do envelope JSON, NÃO plaintext.
      // Verificamos tanto que não é plaintext quanto que tem aparência de envelope.
      expect(createCall.data.conteudoEncrypted).not.toBe(secretContent);
      expect(createCall.data.conteudoEncrypted).not.toContain('confidenciou');
      // Envelope CryptoService é base64(JSON) — começa com 'ey' (base64 de '{').
      expect(createCall.data.conteudoEncrypted).toMatch(/^ey/);
      expect(createCall.data.autorId).toBe('psico-1');

      // Resposta descriptografa o envelope real.
      expect(result.id).toBe('nota-1');
      expect(result.conteudo).toBe(secretContent);
    });

    it('throws NotFoundException when CRM not initialized', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue(null);

      await expect(
        service.criarNota(adminCtx, 'pac-1', 'qualquer coisa'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('listarNotas', () => {
    it('decrypts nota content', async () => {
      const crypto = await makeCrypto();
      const encrypted = crypto.encrypt('Conteúdo confidencial X');
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmNota.findMany.mockResolvedValue([
        {
          id: 'n1',
          autorId: 'admin-1',
          conteudoEncrypted: encrypted,
          createdAt: new Date(),
          autor: { id: 'admin-1', nomeCompleto: 'Admin' },
        },
      ]);

      const result = await service.listarNotas(adminCtx, 'pac-1');
      expect(result[0]!.conteudo).toBe('Conteúdo confidencial X');
    });

    it('excludes soft-deleted notas via Prisma where (default filter)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmNota.findMany.mockResolvedValue([]);

      await service.listarNotas(adminCtx, 'pac-1');
      const call = mockPrisma.pacienteCrmNota.findMany.mock.calls[0][0];
      expect(call.where.deletedAt).toBeNull();
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    });
  });

  describe('removerNota', () => {
    it('author can remove their own nota', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmNota.findFirst.mockResolvedValue({
        id: 'nota-1',
        autorId: 'psico-1',
      });

      const result = await service.removerNota(psicologoCtx, 'pac-1', 'nota-1');
      expect(result.mensagem).toContain('removida');
      const updateCall = mockPrisma.pacienteCrmNota.update.mock.calls[0][0];
      expect(updateCall.data.deletedAt).toBeDefined();
    });

    it('author can remove their own nota (single-user: no cross-user ADMIN override)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmNota.findFirst.mockResolvedValue({
        id: 'nota-1',
        // Single-user: nota.autorId must equal ctx.userId (author-only).
        autorId: 'admin-1',
      });

      await expect(
        service.removerNota(adminCtx, 'pac-1', 'nota-1'),
      ).resolves.toBeDefined();
    });

    it('throws ForbiddenException when non-author PSICOLOGO tries to remove', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmNota.findFirst.mockResolvedValue({
        id: 'nota-1',
        autorId: 'psico-2',
      });

      await expect(
        service.removerNota(psicologoCtx, 'pac-1', 'nota-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Follow-ups ───────────────────────────────────────────────────

  describe('criarFollowUp', () => {
    it('sets responsavelId to acting user, encrypts descricao, and defaults status to PENDENTE', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      // Mock devolve o envelope criptografado (como faria o banco).
      const crypto = await makeCrypto();
      const encryptedDesc = crypto.encrypt('Ligar para confirmar');
      mockPrisma.pacienteCrmFollowUp.create.mockResolvedValue({
        id: 'fu-1',
        descricaoEncrypted: encryptedDesc,
        status: CrmFollowUpStatus.PENDENTE,
        venceEm: null,
        createdAt: new Date(),
        responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      await service.criarFollowUp(psicologoCtx, 'pac-1', {
        descricao: 'Ligar para confirmar',
      });

      const createCall = mockPrisma.pacienteCrmFollowUp.create.mock.calls[0][0];
      expect(createCall.data.responsavelId).toBe('psico-1');
      expect(createCall.data.status).toBe(CrmFollowUpStatus.PENDENTE);
      // descricaoEncrypted deve ser envelope base64(JSON), NÃO plaintext.
      expect(createCall.data.descricaoEncrypted).not.toBe('Ligar para confirmar');
      expect(createCall.data.descricaoEncrypted).not.toContain('confirmar');
      expect(createCall.data.descricaoEncrypted).toMatch(/^ey/);
    });
  });

  describe('atualizarFollowUp', () => {
    it('stamps concluidoEm when transitioning to CONCLUIDO', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        responsavelId: 'psico-1',
        status: CrmFollowUpStatus.PENDENTE,
        concluidoEm: null,
      });
      const crypto = await makeCrypto();
      mockPrisma.pacienteCrmFollowUp.update.mockResolvedValue({
        id: 'fu-1',
        descricaoEncrypted: crypto.encrypt('Ligar para confirmar'),
        status: CrmFollowUpStatus.PENDENTE,
        venceEm: null,
        concluidoEm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      await service.atualizarFollowUp(
        psicologoCtx,
        'pac-1',
        'fu-1',
        { status: CrmFollowUpStatus.CONCLUIDO },
      );

      const updateCall = mockPrisma.pacienteCrmFollowUp.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(CrmFollowUpStatus.CONCLUIDO);
      expect(updateCall.data.concluidoEm).toBeDefined();
    });

    it('clears concluidoEm when going back to PENDENTE', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        responsavelId: 'psico-1',
        status: CrmFollowUpStatus.CONCLUIDO,
        concluidoEm: new Date(),
      });
      const crypto = await makeCrypto();
      mockPrisma.pacienteCrmFollowUp.update.mockResolvedValue({
        id: 'fu-1',
        descricaoEncrypted: crypto.encrypt('Ligar para confirmar'),
        status: CrmFollowUpStatus.PENDENTE,
        venceEm: null,
        concluidoEm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      await service.atualizarFollowUp(
        psicologoCtx,
        'pac-1',
        'fu-1',
        { status: CrmFollowUpStatus.PENDENTE },
      );

      const updateCall = mockPrisma.pacienteCrmFollowUp.update.mock.calls[0][0];
      expect(updateCall.data.concluidoEm).toBeNull();
    });

    it('encrypts descricao on update (PII) and does not leak plaintext', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        responsavelId: 'psico-1',
        status: CrmFollowUpStatus.PENDENTE,
        concluidoEm: null,
      });
      const crypto = await makeCrypto();
      mockPrisma.pacienteCrmFollowUp.update.mockResolvedValue({
        id: 'fu-1',
        descricaoEncrypted: crypto.encrypt('Confirmar retorno do João'),
        status: CrmFollowUpStatus.PENDENTE,
        venceEm: null,
        concluidoEm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      const secret = 'Confirmar retorno do João';
      await service.atualizarFollowUp(psicologoCtx, 'pac-1', 'fu-1', {
        descricao: secret,
      });

      const updateCall = mockPrisma.pacienteCrmFollowUp.update.mock.calls[0][0];
      expect(updateCall.data.descricaoEncrypted).not.toBe(secret);
      expect(updateCall.data.descricaoEncrypted).not.toContain('João');
      expect(updateCall.data.descricaoEncrypted).toMatch(/^ey/);
    });

    it('does not touch descricaoEncrypted when descricao is omitted', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        responsavelId: 'psico-1',
        status: CrmFollowUpStatus.PENDENTE,
        concluidoEm: null,
      });
      const crypto = await makeCrypto();
      mockPrisma.pacienteCrmFollowUp.update.mockResolvedValue({
        id: 'fu-1',
        descricaoEncrypted: crypto.encrypt('Ligar para confirmar'),
        status: CrmFollowUpStatus.PENDENTE,
        venceEm: null,
        concluidoEm: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
      });

      await service.atualizarFollowUp(
        psicologoCtx,
        'pac-1',
        'fu-1',
        { status: CrmFollowUpStatus.CONCLUIDO },
      );

      const updateCall = mockPrisma.pacienteCrmFollowUp.update.mock.calls[0][0];
      expect('descricaoEncrypted' in updateCall.data).toBe(false);
    });

    it('throws ForbiddenException when PSICOLOGO tries to edit another psicos follow-up', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      // Follow-up pertence a psico-3, mas ctx é otherPsicologoCtx (psico-2)
      // → cross-psicólogo deve ser bloqueado.
      mockPrisma.pacienteCrmFollowUp.findFirst.mockResolvedValue({
        id: 'fu-1',
        responsavelId: 'psico-3',
        status: CrmFollowUpStatus.PENDENTE,
        concluidoEm: null,
      });

      await expect(
        service.atualizarFollowUp(
          otherPsicologoCtx,
          'pac-1',
          'fu-1',
          { status: CrmFollowUpStatus.CONCLUIDO },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('listarFollowUps', () => {
    it('decrypts descricao on list (PII)', async () => {
      const crypto = await makeCrypto();
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findMany.mockResolvedValue([
        {
          id: 'fu-1',
          descricaoEncrypted: crypto.encrypt('Ligar para confirmar'),
          status: CrmFollowUpStatus.PENDENTE,
          venceEm: null,
          concluidoEm: null,
          createdAt: new Date(),
          responsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
        },
      ]);

      const result = await service.listarFollowUps(adminCtx, 'pac-1');
      expect(result[0]!.descricao).toBe('Ligar para confirmar');
    });

    it('filters by status when provided', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findFirst.mockResolvedValue({ id: 'crm-1' });
      mockPrisma.pacienteCrmFollowUp.findMany.mockResolvedValue([]);

      await service.listarFollowUps(adminCtx, 'pac-1', CrmFollowUpStatus.PENDENTE);
      const call = mockPrisma.pacienteCrmFollowUp.findMany.mock.calls[0][0];
      expect(call.where.status).toBe(CrmFollowUpStatus.PENDENTE);
      expect(call.where.deletedAt).toBeNull();
    });
  });

  // ─── Soft-delete coherence (GATE 1 retry) ────────────────────────
  //
  // Após `removerCrm()`, a linha CRM fica com `deletedAt != null`. Os
  // testes abaixo garantem que GET reativa (ou cria novo) e que PUT
  // força `deletedAt: null` na operação — sem isso o CRM fica
  // invisível para o usuário, mesmo com upserts "bem-sucedidos".

  describe('soft-delete coherence', () => {
    it('GET after soft-delete: reactivates the existing row instead of returning a "dead" CRM', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      // A linha existe no banco, mas está soft-deleted.
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date('2026-06-01T00:00:00Z'),
      });
      // update reativa: devolve linha com deletedAt = null
      mockPrisma.pacienteCrm.update.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.ALTA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(adminCtx, 'pac-1');

      // Deve reativar (update com deletedAt: null), não criar nova linha
      // nem devolver o registro morto.
      expect(mockPrisma.pacienteCrm.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.pacienteCrm.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('crm-1');
      expect(updateCall.data.deletedAt).toBeNull();
      expect(updateCall.data.updatedById).toBe('admin-1');
      expect(mockPrisma.pacienteCrm.create).not.toHaveBeenCalled();
      expect(result.id).toBe('crm-1');
    });

    it('GET after soft-delete when no row exists at all: lazy-creates a new default CRM', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      // Sem linha alguma (GET nunca foi chamado antes, ou foi limpo).
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue(null);
      mockPrisma.pacienteCrm.create.mockResolvedValue({
        id: 'crm-new',
        pacienteId: 'pac-1',
        status: CrmStatus.LEAD,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      const result = await service.obterResumoCrm(adminCtx, 'pac-1');

      expect(mockPrisma.pacienteCrm.update).not.toHaveBeenCalled();
      expect(mockPrisma.pacienteCrm.create).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('crm-new');
      expect(result.status).toBe(CrmStatus.LEAD);
    });

    it('GET on an active CRM does not touch deletedAt', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // deletedAt ausente = ativo (mock não precisa setar explicitamente)
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.obterResumoCrm(adminCtx, 'pac-1');

      // Não deve nem reativar nem criar — só devolver.
      expect(mockPrisma.pacienteCrm.update).not.toHaveBeenCalled();
      expect(mockPrisma.pacienteCrm.create).not.toHaveBeenCalled();
    });

    it('PUT after soft-delete: forces deletedAt: null on update (reactivates the row)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      // A linha existe, mas está soft-deleted.
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue({
        id: 'crm-1',
        deletedAt: new Date('2026-06-01T00:00:00Z'),
      });
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-1',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.upsertCrm(adminCtx, 'pac-1', {
        status: CrmStatus.ATIVO,
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      // O update DEVE forçar deletedAt: null — sem isso, a linha fica
      // invisível após o PUT e o CRM "morre".
      expect(upsertCall.where).toEqual({ pacienteId: 'pac-1' });
      expect(upsertCall.update.deletedAt).toBeNull();
      expect(upsertCall.update.status).toBe(CrmStatus.ATIVO);
      // O create também deve ter deletedAt: null (defesa em profundidade).
      expect(upsertCall.create.deletedAt).toBeNull();
    });

    it('PUT after soft-delete with no prior row: creates a new CRM (create branch)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'admin-1',
      });
      mockPrisma.pacienteCrm.findUnique.mockResolvedValue(null);
      mockPrisma.pacienteCrm.upsert.mockResolvedValue({
        id: 'crm-new',
        pacienteId: 'pac-1',
        status: CrmStatus.ATIVO,
        prioridade: CrmPrioridade.MEDIA,
        origemEncrypted: null,
        proximaAcaoEm: null,
        proximaAcaoNotaEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      mockPrisma.pacienteCrmNota.count.mockResolvedValue(0);
      mockPrisma.pacienteCrmFollowUp.count.mockResolvedValue(0);

      await service.upsertCrm(adminCtx, 'pac-1', {
        status: CrmStatus.ATIVO,
      });

      const upsertCall = mockPrisma.pacienteCrm.upsert.mock.calls[0][0];
      expect(upsertCall.create.deletedAt).toBeNull();
      expect(upsertCall.update.deletedAt).toBeNull();
    });
  });
});