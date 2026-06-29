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
import { AdicionarContatoDto } from './dto/adicionar-contato.dto';
import { AdicionarEnderecoDto } from './dto/adicionar-endereco.dto';

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

  // ─────────────────────────────────────────────────────────────────────
  // Busca por CPF (blind index)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Buscar paciente por CPF usando blind index.
   * PSICOLOGO: apenas entre os seus. ADMIN: toda a clínica.
   */
  async buscarPorCpf(ctx: TenantContext, cpf: string) {
    const cpfDigits = cpf.replace(/\D/g, '');
    const cpfHash = this.blindIndex.hashCpf(cpfDigits);

    const where: Record<string, unknown> = {
      clinicaId: ctx.clinicaId,
      cpfHash,
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
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Contatos (CRUD)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Listar contatos de um paciente (descriptografados).
   */
  async listarContatos(ctx: TenantContext, pacienteId: string) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const contatos = await this.prisma.pacienteContato.findMany({
      where: { pacienteId: paciente.id, deletedAt: null },
      select: { id: true, tipo: true, valorEncrypted: true },
      orderBy: { createdAt: 'asc' },
    });

    return contatos.map((c) => ({
      id: c.id,
      tipo: c.tipo,
      valor: this.crypto.decrypt(c.valorEncrypted),
    }));
  }

  /**
   * Adicionar contato a um paciente. Valor é criptografado + blind index.
   */
  async adicionarContato(ctx: TenantContext, pacienteId: string, dto: AdicionarContatoDto) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const valorEncrypted = this.crypto.encrypt(dto.valor);
    let valorHash: string;
    if (dto.tipo === 'EMAIL') {
      valorHash = this.blindIndex.hashEmail(dto.valor);
    } else {
      valorHash = this.blindIndex.hashPhone(dto.valor);
    }

    const contato = await this.prisma.pacienteContato.create({
      data: {
        pacienteId: paciente.id,
        tipo: dto.tipo as 'EMAIL' | 'TELEFONE' | 'CELULAR' | 'WHATSAPP',
        valorEncrypted,
        valorHash,
      },
      select: { id: true, tipo: true, valorEncrypted: true },
    });

    this.logger.log(`Contato adicionado: ${contato.id} ao paciente ${pacienteId}`);
    return {
      id: contato.id,
      tipo: contato.tipo,
      valor: this.crypto.decrypt(contato.valorEncrypted),
    };
  }

  /**
   * Remover contato (soft delete).
   */
  async removerContato(ctx: TenantContext, pacienteId: string, contatoId: string) {
    await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const contato = await this.prisma.pacienteContato.findFirst({
      where: { id: contatoId, pacienteId, deletedAt: null },
      select: { id: true },
    });

    if (!contato) throw new NotFoundException('Contato não encontrado');

    await this.prisma.pacienteContato.update({
      where: { id: contatoId },
      data: { deletedAt: new Date() },
    });

    return { mensagem: 'Contato removido' };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Endereços (CRUD)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Listar endereços de um paciente (campos sensíveis descriptografados).
   */
  async listarEnderecos(ctx: TenantContext, pacienteId: string) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const enderecos = await this.prisma.pacienteEndereco.findMany({
      where: { pacienteId: paciente.id, deletedAt: null },
      select: {
        id: true,
        logradouroEncrypted: true,
        bairroEncrypted: true,
        complementoEncrypted: true,
        cep: true,
        numero: true,
        cidade: true,
        estado: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return enderecos.map((e) => ({
      id: e.id,
      logradouro: this.crypto.decrypt(e.logradouroEncrypted),
      bairro: this.crypto.decrypt(e.bairroEncrypted),
      complemento: e.complementoEncrypted ? this.crypto.decrypt(e.complementoEncrypted) : null,
      cep: e.cep,
      numero: e.numero,
      cidade: e.cidade,
      estado: e.estado,
    }));
  }

  /**
   * Adicionar endereço a um paciente.
   * Campos sensíveis (logradouro, bairro, complemento) são criptografados.
   */
  async adicionarEndereco(ctx: TenantContext, pacienteId: string, dto: AdicionarEnderecoDto) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const endereco = await this.prisma.pacienteEndereco.create({
      data: {
        pacienteId: paciente.id,
        logradouroEncrypted: this.crypto.encrypt(dto.logradouro),
        bairroEncrypted: this.crypto.encrypt(dto.bairro),
        complementoEncrypted: dto.complemento ? this.crypto.encrypt(dto.complemento) : null,
        cep: dto.cep,
        numero: dto.numero,
        cidade: dto.cidade,
        estado: dto.estado,
      },
      select: { id: true },
    });

    this.logger.log(`Endereço adicionado: ${endereco.id} ao paciente ${pacienteId}`);
    return {
      id: endereco.id,
      mensagem: 'Endereço adicionado com sucesso',
    };
  }

  /**
   * Remover endereço (soft delete).
   */
  async removerEndereco(ctx: TenantContext, pacienteId: string, enderecoId: string) {
    await this.buscarPacienteParaEdicao(ctx, pacienteId);

    const endereco = await this.prisma.pacienteEndereco.findFirst({
      where: { id: enderecoId, pacienteId, deletedAt: null },
      select: { id: true },
    });

    if (!endereco) throw new NotFoundException('Endereço não encontrado');

    await this.prisma.pacienteEndereco.update({
      where: { id: enderecoId },
      data: { deletedAt: new Date() },
    });

    return { mensagem: 'Endereço removido' };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Busca paciente verificando tenancy + permissão de edição.
   * PSICOLOGO só acessa seus pacientes. ADMIN acessa todos da clínica.
   * Retorna id e nomeEncrypted.
   */
  private async buscarPacienteParaEdicao(ctx: TenantContext, pacienteId: string) {
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
      select: { id: true, psicologoResponsavelId: true },
    });

    if (!paciente) throw new NotFoundException('Paciente não encontrado');
    return paciente;
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
