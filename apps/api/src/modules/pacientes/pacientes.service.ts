import { Injectable, ForbiddenException, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService, BlindIndexService } from '@zelo/crypto';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';
import { AdicionarContatoDto } from './dto/adicionar-contato.dto';
import { AdicionarEnderecoDto } from './dto/adicionar-endereco.dto';

export interface AuthContext { userId: string }

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
   * O psicólogo logado vira o responsável.
   */
  async criarPaciente(ctx: AuthContext, dto: CriarPacienteDto) {
    const cpfDigits = dto.cpf.replace(/\D/g, '');
    this.validarCpf(cpfDigits);
    const cpfHash = this.blindIndex.hashCpf(cpfDigits);

    // Uniqueness por psicólogo
    const existing = await this.prisma.paciente.findFirst({
      where: { psicologoResponsavelId: ctx.userId, cpfHash, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('Paciente com este CPF já cadastrado para você');
    }

    const nomeEncrypted = this.crypto.encrypt(dto.nome);
    const cpfEncrypted = this.crypto.encrypt(cpfDigits);

    const paciente = await this.prisma.paciente.create({
      data: {
        psicologoResponsavelId: ctx.userId,
        nomeEncrypted,
        cpfEncrypted,
        cpfHash,
        dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : null,
        createdById: ctx.userId,
      },
    });

    this.logger.log(`Paciente created: ${paciente.id} por ${ctx.userId}`);
    return this.mapPaciente(paciente.id, dto.nome, cpfDigits, paciente.dataNascimento, paciente.createdAt);
  }

  /**
   * Listar pacientes do psicólogo.
   */
  async listarPacientes(ctx: AuthContext) {
    const pacientes = await this.prisma.paciente.findMany({
      where: { psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: {
        id: true,
        nomeEncrypted: true,
        cpfEncrypted: true,
        dataNascimento: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return pacientes.map((p) => ({
      id: p.id,
      nome: this.crypto.decrypt(p.nomeEncrypted),
      cpf: this.crypto.decrypt(p.cpfEncrypted),
      dataNascimento: p.dataNascimento,
      createdAt: p.createdAt,
    }));
  }

  async obterPaciente(ctx: AuthContext, pacienteId: string) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: {
        id: true,
        nomeEncrypted: true,
        cpfEncrypted: true,
        dataNascimento: true,
        createdAt: true,
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
      contatos: paciente.contatos.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        valor: this.crypto.decrypt(c.valorEncrypted),
      })),
    };
  }

  async atualizarPaciente(ctx: AuthContext, pacienteId: string, dto: AtualizarPacienteDto) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true, nomeEncrypted: true, cpfEncrypted: true, dataNascimento: true, createdAt: true },
    });
    if (!paciente) throw new NotFoundException('Paciente não encontrado');

    const updateData: Record<string, unknown> = { updatedById: ctx.userId };
    if (dto.nome) updateData['nomeEncrypted'] = this.crypto.encrypt(dto.nome);
    if (dto.dataNascimento) updateData['dataNascimento'] = new Date(dto.dataNascimento);

    await this.prisma.paciente.update({ where: { id: pacienteId }, data: updateData });

    const nome = dto.nome ?? this.crypto.decrypt(paciente.nomeEncrypted);
    return this.mapPaciente(paciente.id, nome, '', paciente.dataNascimento, paciente.createdAt);
  }

  async removerPaciente(ctx: AuthContext, pacienteId: string) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true },
    });
    if (!paciente) throw new NotFoundException('Paciente não encontrado');
    await this.prisma.paciente.update({
      where: { id: pacienteId },
      data: { deletedAt: new Date(), updatedById: ctx.userId },
    });
    return { mensagem: 'Paciente removido com sucesso' };
  }

  async buscarPorCpf(ctx: AuthContext, cpf: string) {
    const cpfDigits = cpf.replace(/\D/g, '');
    const cpfHash = this.blindIndex.hashCpf(cpfDigits);
    const paciente = await this.prisma.paciente.findFirst({
      where: { psicologoResponsavelId: ctx.userId, cpfHash, deletedAt: null },
      select: { id: true, nomeEncrypted: true, cpfEncrypted: true, dataNascimento: true, createdAt: true },
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
    };
  }

  async listarContatos(ctx: AuthContext, pacienteId: string) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);
    const contatos = await this.prisma.pacienteContato.findMany({
      where: { pacienteId: paciente.id, deletedAt: null },
      select: { id: true, tipo: true, valorEncrypted: true },
      orderBy: { createdAt: 'asc' },
    });
    return contatos.map((c) => ({
      id: c.id, tipo: c.tipo, valor: this.crypto.decrypt(c.valorEncrypted),
    }));
  }

  async adicionarContato(ctx: AuthContext, pacienteId: string, dto: AdicionarContatoDto) {
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
    return { id: contato.id, tipo: contato.tipo, valor: this.crypto.decrypt(contato.valorEncrypted) };
  }

  async removerContato(ctx: AuthContext, pacienteId: string, contatoId: string) {
    await this.buscarPacienteParaEdicao(ctx, pacienteId);
    const contato = await this.prisma.pacienteContato.findFirst({
      where: { id: contatoId, pacienteId, deletedAt: null }, select: { id: true },
    });
    if (!contato) throw new NotFoundException('Contato não encontrado');
    await this.prisma.pacienteContato.update({ where: { id: contatoId }, data: { deletedAt: new Date() } });
    return { mensagem: 'Contato removido' };
  }

  async listarEnderecos(ctx: AuthContext, pacienteId: string) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);
    const enderecos = await this.prisma.pacienteEndereco.findMany({
      where: { pacienteId: paciente.id, deletedAt: null },
      select: { id: true, logradouroEncrypted: true, bairroEncrypted: true, complementoEncrypted: true, cep: true, numero: true, cidade: true, estado: true },
      orderBy: { createdAt: 'asc' },
    });
    return enderecos.map((e) => ({
      id: e.id,
      logradouro: this.crypto.decrypt(e.logradouroEncrypted),
      bairro: this.crypto.decrypt(e.bairroEncrypted),
      complemento: e.complementoEncrypted ? this.crypto.decrypt(e.complementoEncrypted) : null,
      cep: e.cep, numero: e.numero, cidade: e.cidade, estado: e.estado,
    }));
  }

  async adicionarEndereco(ctx: AuthContext, pacienteId: string, dto: AdicionarEnderecoDto) {
    const paciente = await this.buscarPacienteParaEdicao(ctx, pacienteId);
    const logradouroEncrypted = this.crypto.encrypt(dto.logradouro);
    const bairroEncrypted = this.crypto.encrypt(dto.bairro);
    const complementoEncrypted = dto.complemento ? this.crypto.encrypt(dto.complemento) : null;
    const created = await this.prisma.pacienteEndereco.create({
      data: {
        pacienteId: paciente.id,
        logradouroEncrypted, bairroEncrypted, complementoEncrypted,
        cep: dto.cep, numero: dto.numero, cidade: dto.cidade, estado: dto.estado,
      },
      select: { id: true },
    });
    this.logger.log(`Endereço adicionado: ${created.id} ao paciente ${pacienteId}`);
    return { id: created.id, logradouro: dto.logradouro, bairro: dto.bairro, complemento: dto.complemento ?? null, cep: dto.cep, numero: dto.numero, cidade: dto.cidade, estado: dto.estado };
  }

  async removerEndereco(ctx: AuthContext, pacienteId: string, enderecoId: string) {
    await this.buscarPacienteParaEdicao(ctx, pacienteId);
    const e = await this.prisma.pacienteEndereco.findFirst({
      where: { id: enderecoId, pacienteId, deletedAt: null }, select: { id: true },
    });
    if (!e) throw new NotFoundException('Endereço não encontrado');
    await this.prisma.pacienteEndereco.update({ where: { id: enderecoId }, data: { deletedAt: new Date() } });
    return { mensagem: 'Endereço removido' };
  }

  private async buscarPacienteParaEdicao(ctx: AuthContext, pacienteId: string) {
    const p = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Paciente não encontrado');
    return p;
  }

  /**
   * Valida CPF: 11 dígitos, não-todos-iguais, e check digits (dígitos verificadores) corretos.
   * Lança BadRequestException com mensagem amigável se inválido.
   */
  private validarCpf(cpfDigits: string): void {
    if (cpfDigits.length !== 11) {
      throw new BadRequestException('CPF inválido. Confira os 11 dígitos e tente novamente.');
    }

    // Rejeita CPFs com todos os dígitos iguais (ex: 111.111.111-11)
    if (/^(\d)\1{10}$/.test(cpfDigits)) {
      throw new BadRequestException('CPF inválido. Confira os 11 dígitos e tente novamente.');
    }

    // Validação dos dígitos verificadores (DV1 e DV2)
    let soma1 = 0;
    for (let i = 0; i < 9; i++) {
      soma1 += parseInt(cpfDigits.charAt(i), 10) * (10 - i);
    }
    const dv1Calc = ((soma1 * 10) % 11) % 10;
    const dv1 = parseInt(cpfDigits.charAt(9), 10);
    if (dv1 !== dv1Calc) {
      throw new BadRequestException('CPF inválido. Confira os 11 dígitos e tente novamente.');
    }

    let soma2 = 0;
    for (let i = 0; i < 10; i++) {
      soma2 += parseInt(cpfDigits.charAt(i), 10) * (11 - i);
    }
    const dv2Calc = ((soma2 * 10) % 11) % 10;
    const dv2 = parseInt(cpfDigits.charAt(10), 10);
    if (dv2 !== dv2Calc) {
      throw new BadRequestException('CPF inválido. Confira os 11 dígitos e tente novamente.');
    }
  }

  private mapPaciente(id: string, nome: string, cpf: string, dataNascimento: Date | null, createdAt: Date) {
    return { id, nome, cpf, dataNascimento, createdAt };
  }
}
