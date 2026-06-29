import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClinicasService } from './clinicas.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';

describe('ClinicasService', () => {
  let service: ClinicasService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;
  let mockConfig: ReturnType<typeof createMockConfigService>;

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;
    mockConfig = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClinicasService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(ClinicasService);
    resetPrismaMock();
  });

  describe('criarClinica', () => {
    const validDto = {
      razaoSocial: 'Clinica Teste LTDA',
      nomeFantasia: 'Clinica Teste',
      cnpjCpf: '12345678000190',
    };

    it('creates a clinica with membership and carteira in a transaction', async () => {
      mockPrisma.membership.count.mockResolvedValue(0);
      mockPrisma.clinica.findUnique.mockResolvedValue(null);
      mockPrisma.clinica.create.mockResolvedValue({
        id: 'clinica-1',
        razaoSocial: 'Clinica Teste LTDA',
        nomeFantasia: 'Clinica Teste',
        createdAt: new Date(),
      });
      mockPrisma.membership.create.mockResolvedValue({ id: 'm1' });
      mockPrisma.carteira.create.mockResolvedValue({ id: 'cart-1' });

      const result = await service.criarClinica('user-1', validDto);

      // Verify $transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Verify clinica.create was called with encrypted CNPJ
      const createCall = mockPrisma.clinica.create.mock.calls[0][0];
      expect(createCall.data.razaoSocial).toBe('Clinica Teste LTDA');
      expect(createCall.data.cnpjCpfEncrypted).not.toBe('12345678000190');
      expect(result.id).toBe('clinica-1');
      expect(result.razaoSocial).toBe('Clinica Teste LTDA');
    });

    it('throws ForbiddenException when admin clinic limit is reached', async () => {
      mockPrisma.membership.count.mockResolvedValue(3); // max is 3

      await expect(service.criarClinica('user-1', validDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ConflictException when CNPJ/CPF is already registered', async () => {
      mockPrisma.membership.count.mockResolvedValue(0);
      mockPrisma.clinica.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.criarClinica('user-1', validDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('strips non-digit characters from cnpjCpf before hashing', async () => {
      mockPrisma.membership.count.mockResolvedValue(0);
      mockPrisma.clinica.findUnique.mockResolvedValue(null);
      mockPrisma.clinica.create.mockResolvedValue({
        id: 'clinica-1',
        razaoSocial: 'Clinica Teste LTDA',
        nomeFantasia: 'Clinica Teste',
        createdAt: new Date(),
      });

      await service.criarClinica('user-1', {
        ...validDto,
        cnpjCpf: '12.345.678/0001-90',
      });

      // The findUnique should search by the hash of digits-only: '12345678000190'
      const findCall = mockPrisma.clinica.findUnique.mock.calls[0][0];
      expect(findCall.where.cnpjCpfHash).toBeDefined();
      expect(findCall.where.cnpjCpfHash).not.toContain('.');
    });
  });

  describe('listarMinhasClinicas', () => {
    it('returns memberships with clinica details', async () => {
      mockPrisma.membership.findMany.mockResolvedValue([
        {
          id: 'm1',
          papel: 'ADMIN',
          clinica: { id: 'c1', razaoSocial: 'Clinica A', nomeFantasia: 'A', createdAt: new Date() },
        },
        {
          id: 'm2',
          papel: 'PSICOLOGO',
          clinica: { id: 'c2', razaoSocial: 'Clinica B', nomeFantasia: null, createdAt: new Date() },
        },
      ]);

      const result = await service.listarMinhasClinicas('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.papel).toBe('ADMIN');
      expect(result[1]!.clinica.id).toBe('c2');
    });

    it('returns empty array when user has no memberships', async () => {
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const result = await service.listarMinhasClinicas('user-1');
      expect(result).toEqual([]);
    });
  });

  describe('obterClinica', () => {
    it('throws ForbiddenException when user has no membership', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.obterClinica('user-1', 'c1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when clinica does not exist', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ papel: 'ADMIN' });
      mockPrisma.clinica.findUnique.mockResolvedValue(null);

      await expect(
        service.obterClinica('user-1', 'c1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns clinica details with papelAtivo', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ papel: 'ADMIN' });
      const mockClinica = {
        id: 'c1',
        razaoSocial: 'Clinica A',
        nomeFantasia: 'A',
        createdAt: new Date(),
        memberships: [],
        carteira: { saldo: 100 },
      };
      mockPrisma.clinica.findUnique.mockResolvedValue(mockClinica);

      const result = await service.obterClinica('user-1', 'c1');

      expect(result.id).toBe('c1');
      expect(result.papelAtivo).toBe('ADMIN');
      expect(result.carteira!.saldo).toBe(100);
    });
  });

  describe('listarEquipe', () => {
    it('throws ForbiddenException when user has no membership', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      await expect(
        service.listarEquipe('user-1', 'c1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns active memberships without PII', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm-caller' });
      mockPrisma.membership.findMany.mockResolvedValue([
        {
          id: 'm1',
          papel: 'ADMIN',
          registroProfissional: null,
          estaAtivo: true,
          user: { id: 'u1', nomeCompleto: 'Admin User', email: 'admin@zelo.dev' },
        },
        {
          id: 'm2',
          papel: 'PSICOLOGO',
          registroProfissional: 'CRP 06/12345',
          estaAtivo: true,
          user: { id: 'u2', nomeCompleto: 'Psy User', email: 'psy@zelo.dev' },
        },
      ]);

      const result = await service.listarEquipe('user-1', 'c1');

      expect(result).toHaveLength(2);
      expect(result[0]!.user.id).toBe('u1');
      // CPF must NOT be in the response (no leak)
      const adminUser = result[0]!.user as Record<string, unknown>;
      expect(adminUser['cpfEncrypted']).toBeUndefined();
      expect(adminUser['cpf']).toBeUndefined();
    });

    it('returns empty array when clinica has only inactive memberships', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue({ id: 'm-caller' });
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const result = await service.listarEquipe('user-1', 'c1');
      expect(result).toEqual([]);
    });
  });
});
