import {
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CriarConviteDto } from './dto/criar-convite.dto';
import { AceitarConviteDto } from './dto/aceitar-convite.dto';

@Injectable()
export class ConvitesService {
  private readonly logger = new Logger(ConvitesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Criar convite para um profissional.
   * Apenas ADMIN da clínica pode convidar.
   */
  async criarConvite(userId: string, clinicaId: string, dto: CriarConviteDto) {
    // Verify caller is ADMIN
    const membership = await this.prisma.membership.findFirst({
      where: { userId, clinicaId, papel: 'ADMIN', estaAtivo: true, deletedAt: null },
    });

    if (!membership) {
      throw new ForbiddenException('Apenas ADMIN pode enviar convites');
    }

    // Check if already invited (pending, not expired, not used)
    const existingConvite = await this.prisma.convite.findFirst({
      where: {
        clinicaId,
        emailDestino: dto.emailDestino.trim().toLowerCase(),
        foiUsado: false,
        expiraEm: { gt: new Date() },
      },
    });

    if (existingConvite) {
      throw new ConflictException('Já existe um convite pendente para este email');
    }

    // Check if user already has membership in this clinic
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.emailDestino.trim().toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.membership.findFirst({
        where: { userId: existingUser.id, clinicaId, deletedAt: null },
      });
      if (existingMembership) {
        throw new ConflictException('Usuário já é membro desta clínica');
      }
    }

    const expiraEm = new Date();
    expiraEm.setDate(expiraEm.getDate() + 7); // 7 days to accept

    const convite = await this.prisma.convite.create({
      data: {
        clinicaId,
        enviadoPorId: userId,
        emailDestino: dto.emailDestino.trim().toLowerCase(),
        papel: dto.papel,
        expiraEm,
      },
      select: {
        id: true,
        token: true,
        emailDestino: true,
        papel: true,
        expiraEm: true,
      },
    });

    this.logger.log(`Convite criado: ${convite.id} para ${convite.emailDestino}`);

    return convite;
  }

  /**
   * Listar convites de uma clínica.
   * Apenas ADMIN pode ver.
   */
  async listarConvites(userId: string, clinicaId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, clinicaId, papel: 'ADMIN', estaAtivo: true, deletedAt: null },
    });

    if (!membership) {
      throw new ForbiddenException('Apenas ADMIN pode ver convites');
    }

    return this.prisma.convite.findMany({
      where: { clinicaId },
      select: {
        id: true,
        emailDestino: true,
        papel: true,
        foiUsado: true,
        expiraEm: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Aceitar convite via token.
   * Usuário precisa estar logado (já tem conta).
   */
  async aceitarConvite(userId: string, dto: AceitarConviteDto) {
    const convite = await this.prisma.convite.findUnique({
      where: { token: dto.token },
      select: {
        id: true,
        clinicaId: true,
        emailDestino: true,
        papel: true,
        foiUsado: true,
        expiraEm: true,
      },
    });

    if (!convite) {
      throw new NotFoundException('Convite não encontrado');
    }

    if (convite.foiUsado) {
      throw new BadRequestException('Convite já foi utilizado');
    }

    if (convite.expiraEm < new Date()) {
      throw new BadRequestException('Convite expirado');
    }

    // Verify the user's email matches
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user || user.email !== convite.emailDestino) {
      throw new ForbiddenException('Este convite é para outro email');
    }

    // Check if already a member
    const existingMembership = await this.prisma.membership.findFirst({
      where: { userId, clinicaId: convite.clinicaId, deletedAt: null },
    });

    if (existingMembership) {
      throw new ConflictException('Você já é membro desta clínica');
    }

    // Transaction: create membership + mark convite as used
    const result = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.create({
        data: {
          userId,
          clinicaId: convite.clinicaId,
          papel: convite.papel,
          estaAtivo: true,
        },
        select: {
          id: true,
          papel: true,
          clinica: { select: { id: true, razaoSocial: true } },
        },
      });

      await tx.convite.update({
        where: { id: convite.id },
        data: { foiUsado: true },
      });

      return membership;
    });

    this.logger.log(`Convite aceito: user ${userId} → clinica ${convite.clinicaId}`);

    return {
      mensagem: 'Convite aceito com sucesso',
      membership: result,
    };
  }
}
