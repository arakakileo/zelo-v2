import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TipoContato } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService, BlindIndexService } from '@zelo/crypto';
import { CriarPacienteDto } from './dto/criar-paciente.dto';
import { AtualizarPacienteDto } from './dto/atualizar-paciente.dto';
import { AdicionarContatoDto } from './dto/adicionar-contato.dto';
import { AdicionarEnderecoDto } from './dto/adicionar-endereco.dto';

export interface AuthContext { userId: string }

export interface PacienteContatoPrimario {
  email: string | null;
  telefone: string | null;
}

/**
 * Payload de contatos primários a sincronizar.
 * `undefined` = manter (não tocar); `null` = remover (soft-delete); `string` = upsert.
 */
interface ContatosPrimariosInput {
  email?: string | null;
  telefone?: string | null;
}

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
   * Contatos primários (email/telefone) são sincronizados em `PacienteContato`
   * na MESMA transação, no máximo 1 EMAIL + 1 TELEFONE.
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

    // Preparar contatos primários (validação/normalização centralizadas).
    const emailNorm = dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;
    const telefoneNorm = dto.telefone !== undefined ? this.normalizeTelefone(dto.telefone) : undefined;

    // $transaction: criação do paciente + contatos primários atômicos.
    const paciente = await this.prisma.$transaction(async (tx) => {
      const created = await tx.paciente.create({
        data: {
          psicologoResponsavelId: ctx.userId,
          nomeEncrypted,
          cpfEncrypted,
          cpfHash,
          dataNascimento: dto.dataNascimento ? new Date(dto.dataNascimento) : null,
          createdById: ctx.userId,
        },
      });

      if (emailNorm !== undefined) {
        await this.criarContatoPrimario(tx, created.id, TipoContato.EMAIL, emailNorm, ctx.userId);
      }
      if (telefoneNorm !== undefined) {
        await this.criarContatoPrimario(tx, created.id, TipoContato.TELEFONE, telefoneNorm, ctx.userId);
      }

      return created;
    });

    this.logger.log(`Paciente created: ${paciente.id} por ${ctx.userId}`);
    return this.mapPaciente({
      id: paciente.id,
      nome: dto.nome,
      cpf: cpfDigits,
      dataNascimento: paciente.dataNascimento,
      createdAt: paciente.createdAt,
      contatosPrimarios: {
        email: emailNorm ?? null,
        telefone: telefoneNorm ?? null,
      },
    });
  }

  /**
   * Listar pacientes do psicólogo.
   * Inclui os contatos primários (EMAIL + TELEFONE) sem N+1 via `include` agregado.
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
        contatos: {
          where: { deletedAt: null, tipo: { in: [TipoContato.EMAIL, TipoContato.TELEFONE] } },
          select: { tipo: true, valorEncrypted: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return pacientes.map((p) => {
      const primarios = this.contatosPrimariosFromRows(p.contatos);
      return this.mapPaciente({
        id: p.id,
        nome: this.crypto.decrypt(p.nomeEncrypted),
        cpf: this.crypto.decrypt(p.cpfEncrypted),
        dataNascimento: p.dataNascimento,
        createdAt: p.createdAt,
        contatosPrimarios: primarios,
      });
    });
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
          where: { deletedAt: null, tipo: { in: [TipoContato.EMAIL, TipoContato.TELEFONE] } },
          select: { tipo: true, valorEncrypted: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!paciente) {
      throw new NotFoundException('Paciente não encontrado');
    }
    const primarios = this.contatosPrimariosFromRows(paciente.contatos);
    return this.mapPaciente({
      id: paciente.id,
      nome: this.crypto.decrypt(paciente.nomeEncrypted),
      cpf: this.crypto.decrypt(paciente.cpfEncrypted),
      dataNascimento: paciente.dataNascimento,
      createdAt: paciente.createdAt,
      contatosPrimarios: primarios,
    });
  }

  async atualizarPaciente(ctx: AuthContext, pacienteId: string, dto: AtualizarPacienteDto) {
    const paciente = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true, nomeEncrypted: true, cpfEncrypted: true, dataNascimento: true, createdAt: true },
    });
    if (!paciente) throw new NotFoundException('Paciente não encontrado');

    const updateData: Record<string, unknown> = { updatedById: ctx.userId };
    if (dto.nome !== undefined) updateData['nomeEncrypted'] = this.crypto.encrypt(dto.nome);
    if (dto.dataNascimento !== undefined) {
      updateData['dataNascimento'] = new Date(dto.dataNascimento);
    }

    // Normaliza ANTES de abrir a transação (validação falha-fast).
    const contatosInput: ContatosPrimariosInput = {};
    if (dto.email !== undefined) {
      contatosInput.email = dto.email === null ? null : this.normalizeEmail(dto.email);
    }
    if (dto.telefone !== undefined) {
      contatosInput.telefone = dto.telefone === null ? null : this.normalizeTelefone(dto.telefone);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(updateData).length > 1 || dto.nome !== undefined || dto.dataNascimento !== undefined) {
        await tx.paciente.update({ where: { id: pacienteId }, data: updateData });
      }

      // Sincroniza contatos primários se algum foi enviado.
      if (dto.email !== undefined) {
        await this.syncContatoPrimario(tx, pacienteId, TipoContato.EMAIL, contatosInput.email!, ctx.userId);
      }
      if (dto.telefone !== undefined) {
        await this.syncContatoPrimario(tx, pacienteId, TipoContato.TELEFONE, contatosInput.telefone!, ctx.userId);
      }

      // Releitura após sync para devolver dados atualizados.
      return tx.paciente.findUniqueOrThrow({
        where: { id: pacienteId },
        select: {
          id: true,
          nomeEncrypted: true,
          cpfEncrypted: true,
          dataNascimento: true,
          createdAt: true,
          contatos: {
            where: { deletedAt: null, tipo: { in: [TipoContato.EMAIL, TipoContato.TELEFONE] } },
            select: { tipo: true, valorEncrypted: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });

    const primarios = this.contatosPrimariosFromRows(result.contatos);
    return this.mapPaciente({
      id: result.id,
      nome: this.crypto.decrypt(result.nomeEncrypted),
      cpf: this.crypto.decrypt(result.cpfEncrypted),
      dataNascimento: result.dataNascimento,
      createdAt: result.createdAt,
      contatosPrimarios: primarios,
    });
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

  // ─── Helpers internos ──────────────────────────────────────────────

  private async buscarPacienteParaEdicao(ctx: AuthContext, pacienteId: string) {
    const p = await this.prisma.paciente.findFirst({
      where: { id: pacienteId, psicologoResponsavelId: ctx.userId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Paciente não encontrado');
    return p;
  }

  /**
   * Cria um contato primário (1 EMAIL ou 1 TELEFONE) para o paciente.
   * Assume que não existe outro contato ativo do mesmo tipo (uso em `criarPaciente`).
   * Idempotência a nível de domínio: se já houver contato ativo do mesmo
   * tipo com o mesmo valor (mesmo hash), é no-op (sem duplicação).
   */
  private async criarContatoPrimario(
    tx: Prisma.TransactionClient,
    pacienteId: string,
    tipo: TipoContato,
    valorNormalizado: string,
    userId: string,
  ): Promise<void> {
    const valorHash = this.hashForTipo(tipo, valorNormalizado);
    const valorEncrypted = this.crypto.encrypt(valorNormalizado);

    // Se já existe contato ativo do mesmo tipo com mesmo hash, é no-op.
    const existing = await tx.pacienteContato.findFirst({
      where: { pacienteId, tipo, valorHash, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;

    await tx.pacienteContato.create({
      data: { pacienteId, tipo, valorEncrypted, valorHash },
    });
    void userId;
  }

  /**
   * Sincroniza o contato primário de um tipo (EMAIL ou TELEFONE) conforme input:
   *  - `string` (não-null): upsert — se já houver contato ativo com mesmo hash, no-op;
   *    senão, soft-deleta o anterior e cria o novo.
   *  - `null`: soft-deleta qualquer contato ativo do tipo.
   *
   * Garante no máximo 1 contato ativo do tipo (regra de "primário").
   */
  private async syncContatoPrimario(
    tx: Prisma.TransactionClient,
    pacienteId: string,
    tipo: TipoContato,
    valor: string | null,
    userId: string,
  ): Promise<void> {
    if (valor === null) {
      // Soft-delete de todos os contatos ativos do tipo.
      const ativos = await tx.pacienteContato.findMany({
        where: { pacienteId, tipo, deletedAt: null },
        select: { id: true },
      });
      if (ativos.length === 0) return;
      await tx.pacienteContato.updateMany({
        where: { id: { in: ativos.map((a) => a.id) } },
        data: { deletedAt: new Date() },
      });
      this.logger.log(
        `Contato primário removido (soft-delete): paciente=${pacienteId} tipo=${tipo} qtd=${ativos.length} user=${userId}`,
      );
      return;
    }

    const valorHash = this.hashForTipo(tipo, valor);
    const valorEncrypted = this.crypto.encrypt(valor);

    // Se já existe ativo com mesmo hash, no-op (sem duplicação).
    const existenteIgual = await tx.pacienteContato.findFirst({
      where: { pacienteId, tipo, valorHash, deletedAt: null },
      select: { id: true },
    });
    if (existenteIgual) return;

    // Soft-deleta qualquer outro contato ativo do mesmo tipo (regra do primário: 1 por tipo).
    const outrosAtivos = await tx.pacienteContato.findMany({
      where: { pacienteId, tipo, deletedAt: null },
      select: { id: true },
    });
    if (outrosAtivos.length > 0) {
      await tx.pacienteContato.updateMany({
        where: { id: { in: outrosAtivos.map((o) => o.id) } },
        data: { deletedAt: new Date() },
      });
    }

    await tx.pacienteContato.create({
      data: { pacienteId, tipo, valorEncrypted, valorHash },
    });
    this.logger.log(
      `Contato primário upsert: paciente=${pacienteId} tipo=${tipo} user=${userId}`,
    );
  }

  /**
   * Normaliza email: trim + lowercase. Valida formato (delegado ao class-validator no DTO;
   * aqui só reforçamos que há @ e não é vazio).
   */
  private normalizeEmail(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) {
      throw new BadRequestException('Email não pode ser vazio');
    }
    if (!trimmed.includes('@')) {
      throw new BadRequestException('Email inválido');
    }
    return trimmed;
  }

  /**
   * Normaliza telefone: aceita formato humano, retorna forma "humana canônica"
   * preservando DDD. Hash é gerado sobre os dígitos.
   * Para o campo `valor` exposto ao usuário, mantemos formato humano
   * (re-aplicado a partir dos dígitos para evitar drift de formatação).
   */
  private normalizeTelefone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      throw new BadRequestException(
        'Telefone inválido: esperado 10 ou 11 dígitos (DDD + número)',
      );
    }
    // Reaplica formato humano canônico (BR): (DD) NNNN-NNNN ou (DD) 9NNNN-NNNN.
    const ddd = digits.slice(0, 2);
    if (digits.length === 11) {
      const n1 = digits.slice(2, 7);
      const n2 = digits.slice(7, 11);
      return `(${ddd}) ${n1}-${n2}`;
    }
    const n1 = digits.slice(2, 6);
    const n2 = digits.slice(6, 10);
    return `(${ddd}) ${n1}-${n2}`;
  }

  private hashForTipo(tipo: TipoContato, valor: string): string {
    if (tipo === TipoContato.EMAIL) {
      return this.blindIndex.hashEmail(valor);
    }
    return this.blindIndex.hashPhone(valor);
  }

  private contatosPrimariosFromRows(
    rows: Array<{ tipo: TipoContato; valorEncrypted: string }>,
  ): PacienteContatoPrimario {
    let email: string | null = null;
    let telefone: string | null = null;
    for (const r of rows) {
      const v = this.crypto.decrypt(r.valorEncrypted);
      if (r.tipo === TipoContato.EMAIL && email === null) email = v;
      else if (r.tipo === TipoContato.TELEFONE && telefone === null) telefone = v;
    }
    return { email, telefone };
  }

  private mapPaciente(args: {
    id: string;
    nome: string;
    cpf: string;
    dataNascimento: Date | null;
    createdAt: Date;
    contatosPrimarios: PacienteContatoPrimario;
  }) {
    const { contatosPrimarios, ...rest } = args;
    return {
      ...rest,
      email: contatosPrimarios.email,
      telefone: contatosPrimarios.telefone,
    };
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
}