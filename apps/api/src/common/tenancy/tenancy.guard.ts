import {
  CanActivate,
  ExecutionContext,
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext, Papel } from '@zelo/contracts';
import { Papel as PrismaPapel } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * TenancyGuard — validates clinic context from X-Clinica-ID header.
 *
 * After validation, stamps `request.tenantContext` with userId, clinicaId, and papelAtivo.
 * All protected routes must apply this guard (or a route-level equivalent).
 *
 * Returns:
 *  400 — if X-Clinica-ID header is missing or not a valid UUID
 *  403 — if the authenticated user has no active membership in the clinic
 */
@Injectable()
export class TenancyGuard implements CanActivate {
  private readonly logger = new Logger(TenancyGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { id: string }; tenantContext?: TenantContext }>();

    const clinicaId = request.headers['x-clinica-id'];

    if (!clinicaId || typeof clinicaId !== 'string') {
      throw new BadRequestException('Header X-Clinica-ID é obrigatório');
    }

    if (!UUID_REGEX.test(clinicaId)) {
      throw new BadRequestException('Header X-Clinica-ID deve ser um UUID válido');
    }

    const userId = request.user?.id;
    if (!userId) {
      throw new ForbiddenException('Usuário não autenticado');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        clinicaId,
        estaAtivo: true,
        deletedAt: null,
      },
      select: { papel: true },
    });

    if (!membership) {
      throw new ForbiddenException('Usuário não tem acesso a esta clínica');
    }

    request.tenantContext = {
      userId,
      clinicaId,
      papelAtivo: membership.papel as unknown as Papel,
    };

    return true;
  }
}
