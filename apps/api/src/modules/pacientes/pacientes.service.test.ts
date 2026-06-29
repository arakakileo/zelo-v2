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

  describe('buscarPorCpf', () => {
    it('finds patient by CPF using blind index', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        nomeEncrypted: crypto.encrypt('Test Name'),
        cpfEncrypted: crypto.encrypt('12345678900'),
        dataNascimento: null,
        createdAt: new Date(),
        psicologoResponsavel: { id: 'admin-1', nomeCompleto: 'Admin' },
      });

      const result = await service.buscarPorCpf(adminCtx, '12345678900');

      expect(result.id).toBe('pac-1');
      expect(result.nome).toBe('Test Name');
      const call = mockPrisma.paciente.findFirst.mock.calls[0][0];
      expect(call.where.cpfHash).toBeDefined();
    });

    it('throws NotFoundException when CPF not found', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.buscarPorCpf(adminCtx, '00000000000'),
      ).rejects.toThrow(NotFoundException);
    });

    it('restricts PSICOLOGO to own patients only', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.buscarPorCpf(psicologoCtx, '12345678900'),
      ).rejects.toThrow(NotFoundException);

      const call = mockPrisma.paciente.findFirst.mock.calls[0][0];
      expect(call.where.psicologoResponsavelId).toBe('psico-1');
    });
  });

  describe('adicionarContato', () => {
    it('adds a contact with encrypted value', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteContato.create.mockResolvedValue({
        id: 'cont-1',
        tipo: 'EMAIL',
        valorEncrypted: crypto.encrypt('test@email.com'),
      });

      const result = await service.adicionarContato(adminCtx, 'pac-1', {
        tipo: 'EMAIL',
        valor: 'test@email.com',
      });

      const createCall = mockPrisma.pacienteContato.create.mock.calls[0][0];
      expect(createCall.data.valorEncrypted).not.toBe('test@email.com');
      expect(createCall.data.valorHash).toBeDefined();
      expect(result.tipo).toBe('EMAIL');
      expect(result.valor).toBe('test@email.com');
    });

    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.adicionarContato(adminCtx, 'unknown', {
          tipo: 'EMAIL',
          valor: 'test@email.com',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removerContato', () => {
    it('soft deletes a contact', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteContato.findFirst.mockResolvedValue({ id: 'cont-1' });

      const result = await service.removerContato(adminCtx, 'pac-1', 'cont-1');

      expect(mockPrisma.pacienteContato.update).toHaveBeenCalledWith({
        where: { id: 'cont-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(result.mensagem).toContain('removido');
    });

    it('throws NotFoundException when contact does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteContato.findFirst.mockResolvedValue(null);

      await expect(
        service.removerContato(adminCtx, 'pac-1', 'unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('adicionarEndereco', () => {
    it('adds an address with encrypted sensitive fields', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteEndereco.create.mockResolvedValue({ id: 'end-1' });

      const result = await service.adicionarEndereco(adminCtx, 'pac-1', {
        logradouro: 'Rua das Flores',
        bairro: 'Centro',
        cep: '01001000',
        numero: '123',
        cidade: 'São Paulo',
        estado: 'SP',
      });

      const createCall = mockPrisma.pacienteEndereco.create.mock.calls[0][0];
      expect(createCall.data.logradouroEncrypted).not.toBe('Rua das Flores');
      expect(createCall.data.bairroEncrypted).not.toBe('Centro');
      expect(createCall.data.cep).toBe('01001000');
      expect(createCall.data.cidade).toBe('São Paulo');
      expect(result.id).toBe('end-1');
    });
  });

  describe('listarEnderecos', () => {
    it('returns decrypted enderecos', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteEndereco.findMany.mockResolvedValue([
        {
          id: 'end-1',
          logradouroEncrypted: crypto.encrypt('Rua das Flores'),
          bairroEncrypted: crypto.encrypt('Centro'),
          complementoEncrypted: null,
          cep: '01001000',
          numero: '123',
          cidade: 'São Paulo',
          estado: 'SP',
        },
      ]);

      const result = await service.listarEnderecos(adminCtx, 'pac-1');

      expect(result).toHaveLength(1);
      expect(result[0]!.cep).toBe('01001000');
      expect(result[0]!.logradouro).toBe('Rua das Flores');
      expect(result[0]!.complemento).toBeNull();
    });

    it('returns empty array when patient has no enderecos', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({ id: 'pac-1', psicologoResponsavelId: 'admin-1' });
      mockPrisma.pacienteEndereco.findMany.mockResolvedValue([]);

      const result = await service.listarEnderecos(adminCtx, 'pac-1');
      expect(result).toEqual([]);
    });
  });
});
