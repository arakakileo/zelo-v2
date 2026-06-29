import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConvitesService } from './convites.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { createMockPrismaService } from '../../test-utils';

describe('ConvitesService', () => {
  let service: ConvitesService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConvitesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(ConvitesService);
    resetPrismaMock();
  });

  describe('listarConvites', () => {
    it('throws ForbiddenException for non-ADMIN', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.listarConvites('user-1', 'c1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('filters by pendente by default', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.convite.findMany.mockResolvedValue([]);

      await service.listarConvites('user-1', 'c1');

      const call = mockPrisma.convite.findMany.mock.calls[0][0];
      expect(call.where.foiUsado).toBe(false);
      expect(call.where.expiraEm).toEqual({ gt: expect.any(Date) });
    });

    it('filters by usado when status=usado', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.convite.findMany.mockResolvedValue([]);

      await service.listarConvites('user-1', 'c1', 'usado');

      const call = mockPrisma.convite.findMany.mock.calls[0][0];
      expect(call.where.foiUsado).toBe(true);
    });

    it('filters by expirado when status=expirado', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.convite.findMany.mockResolvedValue([]);

      await service.listarConvites('user-1', 'c1', 'expirado');

      const call = mockPrisma.convite.findMany.mock.calls[0][0];
      expect(call.where.foiUsado).toBe(false);
      expect(call.where.expiraEm).toEqual({ lt: expect.any(Date) });
    });

    it('returns all when status=todos', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });
      mockPrisma.convite.findMany.mockResolvedValue([]);

      await service.listarConvites('user-1', 'c1', 'todos');

      const call = mockPrisma.convite.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ clinicaId: 'c1' });
    });
  });

  describe('revogarConvite', () => {
    it('throws NotFoundException for unknown convite', async () => {
      mockPrisma.convite.findUnique.mockResolvedValue(null);

      await expect(
        service.revogarConvite('user-1', 'unknown-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-ADMIN', async () => {
      mockPrisma.convite.findUnique.mockResolvedValue({
        id: 'c1',
        clinicaId: 'cli-1',
        foiUsado: false,
      });
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.revogarConvite('user-1', 'c1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for already-used convite', async () => {
      mockPrisma.convite.findUnique.mockResolvedValue({
        id: 'c1',
        clinicaId: 'cli-1',
        foiUsado: true,
      });
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });

      await expect(
        service.revogarConvite('user-1', 'c1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('revokes by setting expiraEm to now', async () => {
      mockPrisma.convite.findUnique.mockResolvedValue({
        id: 'conv-1',
        clinicaId: 'cli-1',
        foiUsado: false,
      });
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm1' });

      const result = await service.revogarConvite('user-1', 'conv-1');

      expect(mockPrisma.convite.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { expiraEm: expect.any(Date) },
      });
      expect(result.mensagem).toContain('revogado');
    });
  });
});
