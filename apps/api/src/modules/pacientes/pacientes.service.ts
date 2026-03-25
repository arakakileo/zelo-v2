import {
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService, BlindIndexService } from '@zelo/crypto';
import { TenantContext, Papel } from '@zelo/contracts';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';

@Injectable()
export class PacientesService {
  private readonly logger = new Logger(PacientesService.name);
  private readonly crypto: CryptoService;
  private readonly blindIndex: BlindIndexService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    this.blindIndex = new BlindIndexService(this.config.getOrThrow<string>('BLIND_INDEX_PEPPER'));
  }

  /**
   * Criar paciente com PII criptografado.
   * PSICOLOGO: fica como responsável.
   * ADMIN: pode criar sem ser responsável direto (fica como responsável).
   */
  async criarPaciente(ctx: TenantContext, dto: CriarPacienteDto) {
    const cpfDigits = dto.cpf.replace(/\D/g, '');
    const cpfHash = this.blindIndex.hashCpf(cpfDigits);

    // Check CPF uniqueness within clinic
    const existing = await this.prisma.paciente.findFirst({
      where: { clinicaId: ctx.clinicaId, cpfHash, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Paciente com este CPF já cadastrado nesta clínica');
    }

    const nomeEncrypted = this.crypto.encrypt(dto.nome);
    const cpfEncrypted = this.crypto.encrypt(cpfDigits);

    const paciente = await this.prisma.paciente.create({
      data: {
        clinicaId: ctx.clinicaId,
        psicologoResponsavelId: ctx.userId,
        nomeEncrypted,
        cpfEncrypted,
        cpfHash,
        dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : null,
        createdById: ctx.userId,
      },
    });

    this.logger.log(`Paciente created: ${paciente.id} in clinica ${ctx.clinicaId}`);
    return this.mapPaciente(paciente.id, dto.nome, cpfDigits, paciente.dataNascimento, paciente.createdAt);
  }

  /**
   * Listar pacientes.
   * PSICOLOGO: apenas os seus.
   * ADMIN: todos da clínica.
   */
  async listarPacientes(ctx: TenantContext) {
    const where: Record<string, unknown> = {
      clinicaId: ctx.clinicaId,
      deletedAt: null,
    };

    if (ctx.papelAtivo === Papel.PSICOLOGO) {
      where['psicologoResponsavelId'] = ctx.userId;
    }

    const pacientes = await this.prisma.paciente.findMany({
      where,
      select: {
        id: true,
        nomeEncrypted: true,
        cpfEncrypted: true,
        dataNascimento: true,
        createdAt: true,
        psicologoResponsavel: { select: { id: true, nomeCompleto: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pacientes.map((p) => ({
      id: p.id,
      nome: this.crypto.decrypt(p.nomeEncrypted),
      cpf: this.crypto.decrypt(p.cpfEncrypted),
      dataNascimento: p.dataNascimento,
      createdAt: p.createdAt,
      psicologoResponsavel: p.psicologoResponsavel,
    }));
  }

  /**
   * Obter paciente por ID.
   * PSICOLOGO: apenas os seus.
   * ADMIN: qualquer um da clínica.
   */
  async obterPaciente(ctx: TenantContext, pacienteId: string) {
    const where: Record<string, unknown> = {
      id: pacienteId,
      clinicaId: ctx.clinicaId,
      deletedAt: null,
    };

    if (ctx.papelAtivo === Papel.PSICOLOGO) {
      where['psicologoResponsavelId'] = ctx.userId;
    }

    const paciente = await this.prisma.paciente.findFirst({
      where,
      select: {
        id: true,
        nomeEncrypted: true,
        cpfEncrypted: true,
        dataNascimento: true,
        createdAt: true,
        psicologoResponsavel: { select: { id: true, nomeCompleto: true } },
        contatos: {
          where: { deletedAt: null },
          select: { id: true, tipo: true, valorEncrypted: true },
        },
      },
    });

    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }

    return {
      id: paciente.id,
      nome: this.crypto.decrypt(paciente.nomeEncrypted),
      cpf: this.crypto.decrypt(paciente.cpfEncrypted),
      dataNascimento: paciente.dataNascimento,
      createdAt: paciente.createdAt,
      psicologoResponsavel: paciente.psicologoResponsavel,
      contatos: paciente.contatos.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        valor: this.crypto.decrypt(c.valorEncrypted),
      })),
    };
  }

  /**
   * Atualizar paciente.
   * Apenas o psicólogo responsável ou ADMIN.
   */
  async atualizarPaciente(ctx: TenantContext, pacienteId: string, dto: AtualizarPacienteDto) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: { id: true, psicologoResponsavelId: true, nomeEncrypted: true, cpfEncrypted: true, dataNascimento: true, createdAt: true },
    });

    if (!paciente) throw new NotFoundException('Paciente não encontrado');

    if (ctx.papelAtivo === Papel.PSICOLOGO && paciente.psicologoResponsavelId !== ctx.userId) {
      throw new ForbiddenException('Sem permissão para editar este paciente');
    }

    const updateData: Record<string, unknown> = { updatedById: ctx.userId };
    if (dto.nome) updateData['nomeEncrypted'] = this.crypto.encrypt(dto.nome);
    if (dto.dataNascimento) updateData['dataNascimento'] = new Date(dto.dataNascimento);

    await this.prisma.paciente.update({ where: { id: pacienteId }, data: updateData });

    const nome = dto.nome ?? this.crypto.decrypt(paciente.nomeEncrypted);
    return this.mapPaciente(paciente.id, nome, '', paciente.dataNascimento, paciente.createdAt);
  }

  /**
   * Soft delete de paciente.
   * Apenas o psicólogo responsável ou ADMIN.
   */
  async removerPaciente(ctx: TenantContext, pacienteId: string) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, clinicaId: ctx.clinicaId, deletedAt: null },
      select: { id: true, psicologoResponsavelId: true },
    });

    if (!paciente) throw new NotFoundException('Paciente não encontrado');

    if (ctx.papelAtivo === Papel.PSICOLOGO && paciente.psicologoResponsavelId !== ctx.userId) {
      throw new ForbiddenException('Sem permissão para remover este paciente');
    }

    await this.prisma.paciente.update({
      where: { id: pacienteId },
      data: { deletedAt: new Date(), updatedById: ctx.userId },
    });

    return { mensagem: 'Paciente removido com sucesso' };
  }

  private mapPaciente(
    id: string,
    nome: string,
    cpf: string,
    dataNascimento: Date | null,
    createdAt: Date,
  ) {
    return { id, nome, cpf, dataNascimento, createdAt };
  }
}
