import { ExecutionContext } from '@nestjs/common';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenancyGuard } from './tenancy.guard';
import { Papel } from '@zelo/contracts';
import { createMockPrismaService } from '../../test-utils';

describe('TenancyGuard', () => {
  let guard: TenancyGuard;
  let mockPrisma: any;

  beforeEach(() => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    guard = new TenancyGuard(mockPrisma);
  });

  function createMockContext(headers: Record<string, unknown>, user?: { id: string }): ExecutionContext {
    const request = {
      headers,
      user,
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

  describe('canActivate', () => {
    it('stamps tenantContext on valid membership', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ papel: 'ADMIN' });
      const ctx = createMockContext(
        { 'x-clinica-id': VALID_UUID },
        { id: 'user-1' },
      );

      const request = ctx.switchToHttp().getRequest();
      const result = await guard.canActivate(ctx);

      expect(result).toBe(true);
      expect(request.tenantContext).toEqual({
        userId: 'user-1',
        clinicaId: VALID_UUID,
        papelAtivo: Papel.ADMIN,
      });
    });

    it('throws BadRequestException when X-Clinica-ID is missing', async () => {
      const ctx = createMockContext({}, { id: 'user-1' });

      await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when X-Clinica-ID is not a string', async () => {
      const ctx = createMockContext(
        { 'x-clinica-id': ['array-not-string'] },
        { id: 'user-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when X-Clinica-ID is not a valid UUID', async () => {
      const ctx = createMockContext(
        { 'x-clinica-id': 'not-a-uuid' },
        { id: 'user-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when user is not authenticated', async () => {
      const ctx = createMockContext({ 'x-clinica-id': VALID_UUID });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user has no active membership', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);
      const ctx = createMockContext(
        { 'x-clinica-id': VALID_UUID },
        { id: 'user-1' },
      );

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('queries with estaAtivo=true and deletedAt=null', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ papel: 'PSICOLOGO' });
      const ctx = createMockContext(
        { 'x-clinica-id': VALID_UUID },
        { id: 'user-1' },
      );

      await guard.canActivate(ctx);

      const findCall = mockPrisma.membership.findFirst.mock.calls[0][0];
      expect(findCall.where.estaAtivo).toBe(true);
      expect(findCall.where.deletedAt).toBeNull();
      expect(findCall.where.userId).toBe('user-1');
      expect(findCall.where.clinicaId).toBe(VALID_UUID);
    });
  });
});
