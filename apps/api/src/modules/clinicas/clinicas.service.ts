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
import { CriarClinicaDto } from './dto/criar-clinica.dto';

@Injectable()
export class ClinicasService {
  private readonly logger = new Logger(ClinicasService.name);
  private readonly crypto: CryptoService;
  private readonly blindIndex: BlindIndexService;
  private readonly maxClinicasPorAdmin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.crypto = new CryptoService(this.config.getOrThrow<string>('ENCRYPTION_KEY'));
    this.blindIndex = new BlindIndexService(this.config.getOrThrow<string>('BLIND_INDEX_PEPPER'));
    this.maxClinicasPorAdmin = this.config.get<number>('MAX_CLINICAS_POR_ADMIN', 3);
  }

  /**
   * Criar uma nova clínica.
   * - Valida limite de clínicas por ADMIN
   * - Criptografa CNPJ/CPF
   * - Cria Membership como ADMIN
   * - Cria Carteira com saldo 0
   */
  async criarClinica(userId: string, dto: CriarClinicaDto) {
    // Check admin clinic limit
    const adminCount = await this.prisma.membership.count({
      where: { userId, papel: 'ADMIN', estaAtivo: true, deletedAt: null },
    });

    if (adminCount >= this.maxClinicasPorAdmin) {
      throw new ForbiddenException(
        `Limite de ${this.maxClinicasPorAdmin} clínicas como ADMIN atingido`,
      );
    }

    // Check CNPJ/CPF uniqueness
    const cnpjCpfDigits = dto.cnpjCpf.replace(/\D/g, '');
    const cnpjCpfHash = this.blindIndex.hashCnpjCpf(cnpjCpfDigits);

    const existing = await this.prisma.clinica.findUnique({
      where: { cnpjCpfHash },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('CNPJ/CPF já cadastrado');
    }

    const cnpjCpfEncrypted = this.crypto.encrypt(cnpjCpfDigits);

    // Transaction: create Clinica + Membership + Carteira
    const result = await this.prisma.$transaction(async (tx) => {
      const clinica = await tx.clinica.create({
        data: {
          razaoSocial: dto.razaoSocial,
          nomeFantasia: dto.nomeFantasia ?? null,
          cnpjCpfEncrypted,
          cnpjCpfHash,
        },
      });

      await tx.membership.create({
        data: {
          userId,
          clinicaId: clinica.id,
          papel: 'ADMIN',
          estaAtivo: true,
        },
      });

      await tx.carteira.create({
        data: {
          clinicaId: clinica.id,
          saldo: 0,
        },
      });

      return clinica;
    });

    this.logger.log(`Clinica created: ${result.id} by user ${userId}`);

    return {
      id: result.id,
      razaoSocial: result.razaoSocial,
      nomeFantasia: result.nomeFantasia,
      createdAt: result.createdAt,
    };
  }

  /**
   * Listar clínicas do usuário (todas as que tem membership ativo).
   */
  async listarMinhasClinicas(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, estaAtivo: true, deletedAt: null },
      select: {
        id: true,
        papel: true,
        clinica: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            createdAt: true,
          },
        },
      },
    });

    return memberships.map((m) => ({
      membershipId: m.id,
      papel: m.papel,
      clinica: m.clinica,
    }));
  }

  /**
   * Obter detalhes de uma clínica (requer membership ativo).
   */
  async obterClinica(userId: string, clinicaId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, clinicaId, estaAtivo: true, deletedAt: null },
      select: { papel: true },
    });

    if (!membership) {
      throw new ForbiddenException('Sem acesso a esta clínica');
    }

    const clinica = await this.prisma.clinica.findUnique({
      where: { id: clinicaId, deletedAt: null },
      select: {
        id: true,
        razaoSocial: true,
        nomeFantasia: true,
        createdAt: true,
        memberships: {
          where: { estaAtivo: true, deletedAt: null },
          select: {
            id: true,
            papel: true,
            user: { select: { id: true, email: true, nomeCompleto: true } },
          },
        },
        carteira: {
          select: { saldo: true },
        },
      },
    });

    if (!clinica) {
      throw new NotFoundException('Clínica não encontrada');
    }

    return {
      ...clinica,
      papelAtivo: membership.papel,
    };
  }
}
