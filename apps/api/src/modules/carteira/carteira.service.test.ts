import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { CarteiraService } from './carteira.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Papel, type TenantContext } from '@zelo/contracts';
import {
  createMockPrismaService,
} from '../../test-utils';

describe('CarteiraService', () => {
  let service: CarteiraService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;

  const adminCtx: TenantContext = {
    userId: 'admin-1',
    clinicaId: 'c1',
    papelAtivo: Papel.ADMIN,
  };

  const psicologoCtx: TenantContext = {
    userId: 'psico-1',
    clinicaId: 'c1',
    papelAtivo: Papel.PSICOLOGO,
  };

  beforeEach(async () => {
    const prismaMock = createMockPrismaService();
    mockPrisma = prismaMock.mockPrismaService;
    resetPrismaMock = prismaMock.resetPrismaMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CarteiraService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(CarteiraService);
    resetPrismaMock();
  });

  describe('verSaldo', () => {
    it('throws ForbiddenException for PSICOLOGO', async () => {
      await expect(service.verSaldo(psicologoCtx)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns saldo for ADMIN', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        saldo: new Decimal(100),
        updatedAt: new Date(),
      });

      const result = await service.verSaldo(adminCtx);
      expect(result.saldo).toBeDefined();
      expect(result.atualizadoEm).toBeDefined();
    });

    it('throws NotFoundException when carteira does not exist', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(service.verSaldo(adminCtx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listarTransacoes', () => {
    it('throws ForbiddenException for PSICOLOGO', async () => {
      await expect(service.listarTransacoes(psicologoCtx)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns transactions for ADMIN', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({ id: 'cart-1' });
      mockPrisma.transacao.findMany.mockResolvedValue([
        {
          id: 't1',
          tipo: 'CREDITO',
          valor: new Decimal(50),
          descricao: 'Carga',
          createdAt: new Date(),
          user: { id: 'admin-1', nomeCompleto: 'Admin' },
        },
      ]);

      const result = await service.listarTransacoes(adminCtx);
      expect(result).toHaveLength(1);
      expect(result[0]!.tipo).toBe('CREDITO');
    });

    it('throws NotFoundException when carteira does not exist', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(service.listarTransacoes(adminCtx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('carregarCreditos', () => {
    it('throws ForbiddenException for PSICOLOGO', async () => {
      await expect(
        service.carregarCreditos(psicologoCtx, { valor: 100 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('loads credits without cupom', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });

      const result = await service.carregarCreditos(adminCtx, { valor: 100 });

      expect(result.mensagem).toContain('sucesso');
      // Verify transaction updated saldo with increment
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when carteira does not exist', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(
        service.carregarCreditos(adminCtx, { valor: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when cupom does not exist', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });
      mockPrisma.cupom.findUnique.mockResolvedValue(null);

      await expect(
        service.carregarCreditos(adminCtx, { valor: 100, codigoCupom: 'INVALID' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cupom is inactive', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });
      mockPrisma.cupom.findUnique.mockResolvedValue({
        codigo: 'OLD',
        ativo: false,
        valor: 10,
        tipo: 'FIXO',
      });

      await expect(
        service.carregarCreditos(adminCtx, { valor: 100, codigoCupom: 'OLD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when cupom is expired', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });
      mockPrisma.cupom.findUnique.mockResolvedValue({
        codigo: 'EXPIRED',
        ativo: true,
        valor: 10,
        tipo: 'FIXO',
        validade: new Date('2020-01-01'),
      });

      await expect(
        service.carregarCreditos(adminCtx, { valor: 100, codigoCupom: 'EXPIRED' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies FIXO cupom bonus correctly', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });
      mockPrisma.cupom.findUnique.mockResolvedValue({
        codigo: 'BONUS50',
        ativo: true,
        valor: 50,
        tipo: 'FIXO',
      });

      const result = await service.carregarCreditos(adminCtx, {
        valor: 100,
        codigoCupom: 'BONUS50',
      });

      expect(result.valorCarregado).toEqual(new Decimal(150));
    });

    it('applies PERCENTUAL_BONUS cupom correctly', async () => {
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(0),
      });
      mockPrisma.cupom.findUnique.mockResolvedValue({
        codigo: 'PCT50',
        ativo: true,
        valor: 50,
        tipo: 'PERCENTUAL_BONUS',
      });

      const result = await service.carregarCreditos(adminCtx, {
        valor: 100,
        codigoCupom: 'PCT50',
      });

      // 100 + 50% of 100 = 150
      expect(result.valorCarregado.toNumber()).toBe(150);
    });
  });
});
