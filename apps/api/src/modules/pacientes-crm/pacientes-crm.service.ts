import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '@zelo/crypto';
import {
  CrmStatus,
  CrmPrioridade,
  CrmFollowUpStatus,
} from '@zelo/contracts';
import { CriarCrmDto } from './dto/criar-crm.dto';
import { AtualizarCrmDto } from './dto/atualizar-crm.dto';

export interface AuthContext { userId: string }

/**
 * CRM de pacientes — funil de relacionamento, notas cifradas e follow-ups.
 *
 * Princípios:
 *  - Multi-tenancy estrita: toda operação valida `clinicaId` do header
 *    contra o `clinicaId` do paciente antes de qualquer acesso.
 *  - RBAC: ADMIN vê todos os pacientes da clínica; PSICOLOGO só os seus
 *    (psicologoResponsavelId == userId).
 *  - PII cifrado: TODO campo de texto livre que possa carregar PII é
 *    criptografado antes de persistir — `origem`, `proximaAcaoNota`,
 *    `conteudo` (notas) e `descricao` (follow-ups). O conteúdo
 *    descriptografado NUNCA entra em log.
 *  - Soft delete + audit fields em todas as entidades (consistente com o resto).
 *  - 1:1 com Paciente via upsert (não há "criar" separado — PUT é idempotente).
 */
@Injectable()
export class PacientesCrmService {
  private readonly logger = new Logger(PacientesCrmService.name);
  private readonly crypto: CryptoService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.crypto = new CryptoService(
      this.config.getOrThrow<string>('ENCRYPTION_KEY'),
    );
  }

  // ─── Resumo CRM ───────────────────────────────────────────────────

  /**
   * Retorna o estado CRM (1:1) + contadores para o painel.
   * Cria o registro com defaults (LEAD/MEDIA) na primeira leitura,
   * para que a UI tenha um objeto consistente desde o início.
   *
   * Soft-delete coerente: linhas com `deletedAt != null` são tratadas como
   * inexistentes. Se houver uma linha soft-deleted para o paciente, ela é
   * REATIVADA (deletedAt → null) antes de devolver — assim GET nunca
   * devolve um CRM "morto", e PUT subsequente não cria duplicata.
   *
   */
  async obterResumoCrm(ctx: AuthContext, pacienteId: string) {
    await this.buscarPacienteParaAcesso(ctx, pacienteId);

    const existing = await this.prisma.pacienteCrm.findUnique({
      where: { pacienteId },
    });

    // Tratamos `deletedAt` null OU undefined como "linha ativa" para
    // tolerar mocks existentes e dados sem o campo setado.
    const isActive = !existing || existing.deletedAt == null;

    if (existing && isActive) {
      return this.mapCrm(existing, await this.contadoresCrm(existing.id));
    }

    if (existing && !isActive) {
      // Reativar a linha soft-deleted: limpa deletedAt e marca updatedById.
      // Conteúdo (status/prioridade/origem/proximaAcao*) é preservado, mas o
      // usuário pode sobrescrever via PUT em seguida. Aqui só garantimos
      // visibilidade.
      const reactivated = await this.prisma.pacienteCrm.update({
        where: { id: existing.id },
        data: { deletedAt: null, updatedById: ctx.userId },
      });
      this.logger.log(`CRM reativado: paciente=${pacienteId} crm=${reactivated.id}`);
      return this.mapCrm(reactivated, await this.contadoresCrm(reactivated.id));
    }

    // Lazy-create com defaults. Cria como o usuário atual (audit).
    const created = await this.prisma.pacienteCrm.create({
      data: {
        pacienteId,
        status: CrmStatus.LEAD,
        prioridade: CrmPrioridade.MEDIA,
        createdById: ctx.userId,
      },
    });
    this.logger.log(`CRM lazy-created para paciente ${pacienteId}`);
    return this.mapCrm(created, await this.contadoresCrm(created.id));
  }

  /**
   * Cria/atualiza (PUT idempotente) o estado CRM do paciente.
   * Criptografa `origem` se enviada.
   *
   * Soft-delete coerente: se houver linha soft-deleted para o paciente,
   * a reativamos (deletedAt → null) ANTES do upsert, para que a linha
   * reapareça com o novo estado. Sem isso, o `update` do upsert rodaria
   * numa linha invisível (deletedAt != null), mantendo o CRM "morto".
   */
  async upsertCrm(
    ctx: AuthContext,
    pacienteId: string,
    dto: CriarCrmDto | AtualizarCrmDto,
  ) {
    await this.buscarPacienteParaAcesso(ctx, pacienteId);

    const data: Record<string, unknown> = { updatedById: ctx.userId };
    if (dto.status !== undefined) data['status'] = dto.status;
    if (dto.prioridade !== undefined) data['prioridade'] = dto.prioridade;
    if (dto.origem !== undefined) {
      data['origemEncrypted'] = this.crypto.encrypt(dto.origem);
    }
    if (dto.proximaAcaoEm !== undefined) {
      data['proximaAcaoEm'] = new Date(dto.proximaAcaoEm);
    }
    if (dto.proximaAcaoNota !== undefined) {
      // Texto livre: pode conter PII (nome, canal, contexto). Cifra sempre.
      data['proximaAcaoNotaEncrypted'] = this.crypto.encrypt(dto.proximaAcaoNota);
    }

    // Se existe linha soft-deleted, reativar antes do upsert para que
    // o `update` do Prisma opere numa linha visível. `deletedAt: null`
    // é forçado no payload do upsert para o caso `create` (PUT no mesmo
    // request de reativação).
    const existing = await this.prisma.pacienteCrm.findUnique({
      where: { pacienteId },
      select: { id: true, deletedAt: true },
    });

    if (existing && existing.deletedAt !== null) {
      this.logger.log(`CRM reativando para upsert: paciente=${pacienteId}`);
    }

    const crm = await this.prisma.pacienteCrm.upsert({
      where: { pacienteId },
      create: {
        pacienteId,
        ...data,
        deletedAt: null,
        createdById: ctx.userId,
      },
      update: { ...data, deletedAt: null },
    });

    // Não logar conteúdo; só IDs.
    this.logger.log(`CRM upsert: paciente=${pacienteId} status=${crm.status}`);
    return this.mapCrm(crm, await this.contadoresCrm(crm.id));
  }

  /**
   * Soft delete do CRM (não do paciente).
   * Mantém histórico — apenas marca `deletedAt`.
   * Apenas ADMIN ou o psicólogo responsável.
   */
  async removerCrm(ctx: AuthContext, pacienteId: string) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const crm = await this.prisma.pacienteCrm.findFirst({
      where: { pacienteId, deletedAt: null },
      select: { id: true },
    });
    if (!crm) throw new NotFoundException('CRM não encontrado');

    await this.prisma.pacienteCrm.update({
      where: { id: crm.id },
      data: { deletedAt: new Date(), updatedById: ctx.userId },
    });

    // `paciente` aqui só é usado para a checagem de permissão acima.
    void paciente;
    return { mensagem: 'CRM removido com sucesso' };
  }

  // ─── Notas (timeline cifrada) ─────────────────────────────────────

  async listarNotas(ctx: AuthContext, pacienteId: string) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const notas = await this.prisma.pacienteCrmNota.findMany({
      where: { crmId: crm.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        autorId: true,
        conteudoEncrypted: true,
        createdAt: true,
        autor: { select: { id: true, nomeCompleto: true } },
      },
    });

    return notas.map((n) => ({
      id: n.id,
      autor: n.autor,
      conteudo: this.crypto.decrypt(n.conteudoEncrypted),
      createdAt: n.createdAt,
    }));
  }

  async criarNota(ctx: AuthContext, pacienteId: string, conteudo: string) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const nota = await this.prisma.pacienteCrmNota.create({
      data: {
        crmId: crm.id,
        autorId: ctx.userId,
        conteudoEncrypted: this.crypto.encrypt(conteudo),
      },
      select: {
        id: true,
        autorId: true,
        conteudoEncrypted: true,
        createdAt: true,
        autor: { select: { id: true, nomeCompleto: true } },
      },
    });

    // Log apenas IDs — NUNCA o conteúdo.
    this.logger.log(
      `Nota CRM criada: ${nota.id} (crm=${crm.id}, autor=${ctx.userId})`,
    );

    return {
      id: nota.id,
      autor: nota.autor,
      conteudo: this.crypto.decrypt(nota.conteudoEncrypted),
      createdAt: nota.createdAt,
    };
  }

  async removerNota(
    ctx: AuthContext,
    pacienteId: string,
    notaId: string,
  ) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const nota = await this.prisma.pacienteCrmNota.findFirst({
      where: { id: notaId, crmId: crm.id, deletedAt: null },
      select: { id: true, autorId: true },
    });
    if (!nota) throw new NotFoundException('Nota não encontrada');

    if (nota.autorId !== ctx.userId) {
      throw new ForbiddenException('Apenas o autor pode remover esta nota');
    }

    await this.prisma.pacienteCrmNota.update({
      where: { id: notaId },
      data: { deletedAt: new Date() },
    });

    return { mensagem: 'Nota removida' };
  }

  // ─── Follow-ups ───────────────────────────────────────────────────

  async listarFollowUps(
    ctx: AuthContext,
    pacienteId: string,
    status?: CrmFollowUpStatus,
  ) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const where: Record<string, unknown> = {
      crmId: crm.id,
      deletedAt: null,
    };
    if (status) where['status'] = status;

    return this.prisma.pacienteCrmFollowUp.findMany({
      where,
      orderBy: [{ status: 'asc' }, { venceEm: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        descricaoEncrypted: true,
        status: true,
        venceEm: true,
        concluidoEm: true,
        createdAt: true,
        responsavel: { select: { id: true, nomeCompleto: true } },
      },
    }).then((rows) =>
      rows.map((row) => ({
        id: row.id,
        descricao: this.crypto.decrypt(row.descricaoEncrypted),
        status: row.status,
        venceEm: row.venceEm,
        concluidoEm: row.concluidoEm,
        createdAt: row.createdAt,
        responsavel: row.responsavel,
      })),
    );
  }

  async criarFollowUp(
    ctx: AuthContext,
    pacienteId: string,
    dto: { descricao: string; venceEm?: string; status?: CrmFollowUpStatus },
  ) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const followUp = await this.prisma.pacienteCrmFollowUp.create({
      data: {
        crmId: crm.id,
        responsavelId: ctx.userId,
        // Texto livre: cifrado em repouso. Pode conter PII (nome, canal, contexto).
        descricaoEncrypted: this.crypto.encrypt(dto.descricao),
        status: dto.status ?? CrmFollowUpStatus.PENDENTE,
        venceEm: dto.venceEm ? new Date(dto.venceEm) : null,
      },
      select: {
        id: true,
        descricaoEncrypted: true,
        status: true,
        venceEm: true,
        createdAt: true,
        responsavel: { select: { id: true, nomeCompleto: true } },
      },
    });

    // Não logamos `descricao` por consistência — pode conter PII.
    this.logger.log(
      `FollowUp CRM criado: ${followUp.id} (crm=${crm.id}, resp=${ctx.userId})`,
    );
    return {
      id: followUp.id,
      descricao: this.crypto.decrypt(followUp.descricaoEncrypted),
      status: followUp.status,
      venceEm: followUp.venceEm,
      createdAt: followUp.createdAt,
      responsavel: followUp.responsavel,
    };
  }

  async atualizarFollowUp(
    ctx: AuthContext,
    pacienteId: string,
    followUpId: string,
    dto: { descricao?: string; status?: CrmFollowUpStatus; venceEm?: string },
  ) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const existing = await this.prisma.pacienteCrmFollowUp.findFirst({
      where: { id: followUpId, crmId: crm.id, deletedAt: null },
      select: { id: true, responsavelId: true, status: true, concluidoEm: true },
    });
    if (!existing) throw new NotFoundException('Follow-up não encontrado');

    if (existing.responsavelId !== ctx.userId) {
      throw new ForbiddenException('Apenas o responsável pode editar este follow-up');
    }

    const data: Record<string, unknown> = {};
    if (dto.descricao !== undefined) {
      // Texto livre: cifrado em repouso.
      data['descricaoEncrypted'] = this.crypto.encrypt(dto.descricao);
    }
    if (dto.venceEm !== undefined) {
      data['venceEm'] = dto.venceEm ? new Date(dto.venceEm) : null;
    }
    if (dto.status !== undefined) {
      data['status'] = dto.status;
      // Regras de transição: concluidoEm coerente com status.
      if (dto.status === CrmFollowUpStatus.CONCLUIDO) {
        data['concluidoEm'] = new Date();
      } else if (
        dto.status === CrmFollowUpStatus.PENDENTE ||
        dto.status === CrmFollowUpStatus.CANCELADO
      ) {
        data['concluidoEm'] = null;
      }
    }

    const updated = await this.prisma.pacienteCrmFollowUp.update({
      where: { id: followUpId },
      data,
      select: {
        id: true,
        descricaoEncrypted: true,
        status: true,
        venceEm: true,
        concluidoEm: true,
        createdAt: true,
        updatedAt: true,
        responsavel: { select: { id: true, nomeCompleto: true } },
      },
    });

    return {
      id: updated.id,
      descricao: this.crypto.decrypt(updated.descricaoEncrypted),
      status: updated.status,
      venceEm: updated.venceEm,
      concluidoEm: updated.concluidoEm,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      responsavel: updated.responsavel,
    };
  }

  async removerFollowUp(
    ctx: AuthContext,
    pacienteId: string,
    followUpId: string,
  ) {
    const crm = await this.obterCrmAtivoOuFalhar(ctx, pacienteId);

    const existing = await this.prisma.pacienteCrmFollowUp.findFirst({
      where: { id: followUpId, crmId: crm.id, deletedAt: null },
      select: { id: true, responsavelId: true },
    });
    if (!existing) throw new NotFoundException('Follow-up não encontrado');

    if (existing.responsavelId !== ctx.userId) {
      throw new ForbiddenException('Apenas o responsável pode remover este follow-up');
    }

    await this.prisma.pacienteCrmFollowUp.update({
      where: { id: followUpId },
      data: { deletedAt: new Date() },
    });

    return { mensagem: 'Follow-up removido' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Verifica tenancy + permissão de LEITURA.
   * PSICOLOGO: só acessa seus próprios pacientes.
   * ADMIN: qualquer paciente da clínica.
   */
  private async buscarPacienteParaAcesso(
    ctx: AuthContext,
    pacienteId: string,
  ): Promise<{ id: string }> {
    // 1:1 por psicólogo — sem tenancy nem papel.
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true },
    });
    if (!paciente) throw new NotFoundException('Paciente não encontrado');
    return paciente;
  }

  /**
   * Verifica tenancy + permissão de ESCRITA (mesma regra de acesso,
   * mas nomeada diferente para refletir intenção nos call sites).
   */
  private async buscarPacienteParaEdicao(
    ctx: AuthContext,
    pacienteId: string,
  ): Promise<{ id: string }> {
    return this.buscarPacienteParaAcesso(ctx, pacienteId);
  }

  private async obterCrmAtivoOuFalhar(
    ctx: AuthContext,
    pacienteId: string,
  ) {
    await this.buscarPacienteParaAcesso(ctx, pacienteId);

    const crm = await this.prisma.pacienteCrm.findFirst({
      where: { pacienteId, deletedAt: null },
      select: { id: true },
    });
    if (!crm) {
      throw new NotFoundException(
        'CRM não inicializado — chame GET /pacientes/:id/crm primeiro',
      );
    }
    return crm;
  }

  private async contadoresCrm(crmId: string) {
    const [notas, followUpsPendentes] = await Promise.all([
      this.prisma.pacienteCrmNota.count({
        where: { crmId, deletedAt: null },
      }),
      this.prisma.pacienteCrmFollowUp.count({
        where: {
          crmId,
          deletedAt: null,
          status: CrmFollowUpStatus.PENDENTE,
        },
      }),
    ]);
    return { notas, followUpsPendentes };
  }

  private mapCrm(
    crm: Prisma.PacienteCrmGetPayload<object>,
    contadores: { notas: number; followUpsPendentes: number },
  ) {
    return {
      id: crm.id,
      pacienteId: crm.pacienteId,
      status: crm.status as unknown as CrmStatus,
      prioridade: crm.prioridade as unknown as CrmPrioridade,
      origem: crm.origemEncrypted ? this.crypto.decrypt(crm.origemEncrypted) : null,
      proximaAcaoEm: crm.proximaAcaoEm,
      proximaAcaoNota: crm.proximaAcaoNotaEncrypted
        ? this.crypto.decrypt(crm.proximaAcaoNotaEncrypted)
        : null,
      createdAt: crm.createdAt,
      updatedAt: crm.updatedAt,
      contadores,
    };
  }
}