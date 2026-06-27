import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PacientesService } from './pacientes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Papel, type TenantContext } from '@zelo/contracts';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';

describe('PacientesService', () => {
  let service: PacientesService;
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
    const mockConfig = createMockConfigService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PacientesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(PacientesService);
    resetPrismaMock();
  });

  describe('criarPaciente', () => {
    const validDto = {
      nome: 'João Silva',
      cpf: '12345678900',
    };

    it('creates a patient with encrypted PII', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);
      mockPrisma.paciente.create.mockResolvedValue({
        id: 'pac-1',
        dataNascimento: null,
        createdAt: new Date(),
      });

      const result = await service.criarPaciente(adminCtx, validDto);

      const createCall = mockPrisma.paciente.create.mock.calls[0][0];
      // PII must be encrypted, not plaintext
      expect(createCall.data.nomeEncrypted).not.toBe('João Silva');
      expect(createCall.data.cpfEncrypted).not.toBe('12345678900');
      expect(createCall.data.cpfHash).toBeDefined();
      expect(result.nome).toBe('João Silva');
    });

    it('throws ConflictException on duplicate CPF within clinic', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.criarPaciente(adminCtx, validDto),
      ).rejects.toThrow(ConflictException);
    });

    it('sets psicologoResponsavelId to the acting user', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);
      mockPrisma.paciente.create.mockResolvedValue({
        id: 'pac-1',
        dataNascimento: null,
        createdAt: new Date(),
      });

      await service.criarPaciente(psicologoCtx, validDto);

      const createCall = mockPrisma.paciente.create.mock.calls[0][0];
      expect(createCall.data.psicologoResponsavelId).toBe('psico-1');
    });
  });

  describe('listarPacientes', () => {
    it('ADMIN sees all patients in the clinic', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findMany.mockResolvedValue([
        {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('João Silva'),
          cpfEncrypted: crypto.encrypt('12345678900'),
          dataNascimento: null,
          createdAt: new Date(),
          psicologoResponsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
        },
      ]);

      const result = await service.listarPacientes(adminCtx);

      const findCall = mockPrisma.paciente.findMany.mock.calls[0][0];
      expect(findCall.where.clinicaId).toBe('c1');
      // ADMIN should NOT be filtered by psicologoResponsavelId
      expect(findCall.where.psicologoResponsavelId).toBeUndefined();
      expect(result).toHaveLength(1);
    });

    it('PSICOLOGO is filtered to only their patients', async () => {
      mockPrisma.paciente.findMany.mockResolvedValue([]);

      await service.listarPacientes(psicologoCtx);

      const findCall = mockPrisma.paciente.findMany.mock.calls[0][0];
      expect(findCall.where.psicologoResponsavelId).toBe('psico-1');
    });

    it('decrypts patient name and CPF in results', async () => {
      // Use real CryptoService to produce valid encrypted envelopes
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findMany.mockResolvedValue([
        {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('João Silva'),
          cpfEncrypted: crypto.encrypt('12345678900'),
          dataNascimento: null,
          createdAt: new Date(),
          psicologoResponsavel: { id: 'psico-1', nomeCompleto: 'Dr. Silva' },
        },
      ]);

      const result = await service.listarPacientes(adminCtx);

      expect(result[0]!.nome).toBe('João Silva');
      expect(result[0]!.cpf).toBe('12345678900');
    });
  });

  describe('obterPaciente', () => {
    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.obterPaciente(adminCtx, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('PSICOLOGO is filtered to their patients only (not found for others)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      // PSICOLOGO queries with psicologoResponsavelId filter — returns null for others
      await expect(
        service.obterPaciente(psicologoCtx, 'pac-other'),
      ).rejects.toThrow(NotFoundException);

      const findCall = mockPrisma.paciente.findFirst.mock.calls[0][0];
      expect(findCall.where.psicologoResponsavelId).toBe('psico-1');
    });
  });

  describe('removerPaciente', () => {
    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.removerPaciente(adminCtx, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when PSICOLOGO tries to remove others patient', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'p1',
        psicologoResponsavelId: 'other-psico',
      });

      await expect(
        service.removerPaciente(psicologoCtx, 'p1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('ADMIN can soft-delete any patient', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'p1',
        psicologoResponsavelId: 'other-psico',
      });
      mockPrisma.paciente.update.mockResolvedValue({});

      const result = await service.removerPaciente(adminCtx, 'p1');

      expect(result.mensagem).toContain('removido');
      const updateCall = mockPrisma.paciente.update.mock.calls[0][0];
      expect(updateCall.data.deletedAt).toBeDefined();
    });
  });
});
