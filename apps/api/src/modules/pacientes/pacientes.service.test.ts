import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PacientesService } from './pacientes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';
import { CryptoService } from '@zelo/crypto';

describe('PacientesService', () => {
  let service: PacientesService;
  let mockPrisma: any;
  let resetPrismaMock: () => void;

  const adminCtx = { userId: 'admin-1' };
  const psicologoCtx = { userId: 'psico-1' };

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
      cpf: '52998224725',
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
      expect(createCall.data.cpfEncrypted).not.toBe('52998224725');
      expect(createCall.data.cpfHash).toBeDefined();
      expect(result.nome).toBe('João Silva');
    });

    it('throws BadRequestException for invalid CPF (too short)', async () => {
      await expect(
        service.criarPaciente(adminCtx, { nome: 'Test', cpf: '1234' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CPF with wrong check digits (11 digits but invalid)', async () => {
      await expect(
        service.criarPaciente(adminCtx, { nome: 'Test', cpf: '12345678900' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for CPF with all same digits (11111111111)', async () => {
      await expect(
        service.criarPaciente(adminCtx, { nome: 'Test', cpf: '11111111111' }),
      ).rejects.toThrow(BadRequestException);
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

    it('creates email + telefone primary contacts in the same transaction', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);
      mockPrisma.paciente.create.mockResolvedValue({
        id: 'pac-1',
        dataNascimento: null,
        createdAt: new Date(),
      });
      // syncContatoPrimario will lookup existing → null → create
      mockPrisma.pacienteContato.findFirst.mockResolvedValue(null);
      mockPrisma.pacienteContato.create.mockResolvedValue({});

      const result = await service.criarPaciente(adminCtx, {
        ...validDto,
        email: 'Joao@Email.com  ',
        telefone: '(11) 98765-4321',
      });

      // create wrapped in $transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      // Two contact creates (EMAIL + TELEFONE)
      expect(mockPrisma.pacienteContato.create).toHaveBeenCalledTimes(2);
      // normalized email + telefone reflected in response
      expect(result.email).toBe('joao@email.com');
      expect(result.telefone).toBe('(11) 98765-4321');
      // contato create payloads: EMAIL with trimmed/lowercased + TELEFONE canonical
      const emailCall = mockPrisma.pacienteContato.create.mock.calls.find(
        (c: any[]) => c[0].data.tipo === 'EMAIL',
      );
      const telCall = mockPrisma.pacienteContato.create.mock.calls.find(
        (c: any[]) => c[0].data.tipo === 'TELEFONE',
      );
      expect(emailCall[0].data.valorEncrypted).toBeDefined();
      expect(emailCall[0].data.valorHash).toBeDefined();
      expect(telCall[0].data.valorEncrypted).toBeDefined();
      expect(telCall[0].data.valorHash).toBeDefined();
    });

    it('rejects empty email after trim with BadRequestException', async () => {
          mockPrisma.paciente.findFirst.mockResolvedValue(null);
          mockPrisma.paciente.create.mockResolvedValue({
            id: 'pac-1',
            dataNascimento: null,
            createdAt: new Date(),
          });

          // Class-validator catches empty before service, but service-side normalize
          // also rejects. We bypass class-validator by passing whitespace via DTO
          // would still be caught at @IsEmail. Instead, ensure that internal
          // normalize throws when given empty post-trim.
          await expect(
            service.criarPaciente(adminCtx, { ...validDto, email: '   ' } as any),
          ).rejects.toThrow(BadRequestException);
        });

        it('rejects invalid phone format with BadRequestException', async () => {
          mockPrisma.paciente.findFirst.mockResolvedValue(null);
          mockPrisma.paciente.create.mockResolvedValue({
            id: 'pac-1',
            dataNascimento: null,
            createdAt: new Date(),
          });

          await expect(
            service.criarPaciente(adminCtx, { ...validDto, telefone: '12345' } as any),
          ).rejects.toThrow(BadRequestException);
        });
  });

  describe('listarPacientes', () => {
    it('ADMIN is still scoped to their own patients (single-user: always filtered by psicologoResponsavelId)', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findMany.mockResolvedValue([
        {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('João Silva'),
          cpfEncrypted: crypto.encrypt('12345678900'),
          dataNascimento: null,
          createdAt: new Date(),
          contatos: [],
        },
      ]);

      const result = await service.listarPacientes(adminCtx);

      const findCall = mockPrisma.paciente.findMany.mock.calls[0][0];
      // Single-user: sempre filtra por psicologoResponsavelId: ctx.userId
      expect(findCall.where.psicologoResponsavelId).toBe('admin-1');
      expect(findCall.where.clinicaId).toBeUndefined();
      expect(result).toHaveLength(1);
      // Sem contatos primários cadastrados → email/telefone nulos
      expect(result[0]!.email).toBeNull();
      expect(result[0]!.telefone).toBeNull();
    });

    it('PSICOLOGO is filtered to only their patients', async () => {
      mockPrisma.paciente.findMany.mockResolvedValue([]);

      await service.listarPacientes(psicologoCtx);

      const findCall = mockPrisma.paciente.findMany.mock.calls[0][0];
      expect(findCall.where.psicologoResponsavelId).toBe('psico-1');
    });

    it('decrypts patient name, CPF, email and telefone in results', async () => {
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
          contatos: [
            { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('joao@email.com') },
            { tipo: 'TELEFONE', valorEncrypted: crypto.encrypt('(11) 98765-4321') },
          ],
        },
      ]);

      const result = await service.listarPacientes(adminCtx);

      expect(result[0]!.nome).toBe('João Silva');
      expect(result[0]!.cpf).toBe('12345678900');
      expect(result[0]!.email).toBe('joao@email.com');
      expect(result[0]!.telefone).toBe('(11) 98765-4321');
      // Garante que NÃO vaza ciphertext/hash/CPF interno
      expect((result[0] as any).valorEncrypted).toBeUndefined();
      expect((result[0] as any).valorHash).toBeUndefined();
    });

    it('exposes email and telefone as null when contact rows are absent', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));
      mockPrisma.paciente.findMany.mockResolvedValue([
        {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('Sem Contato'),
          cpfEncrypted: crypto.encrypt('52998224725'),
          dataNascimento: null,
          createdAt: new Date(),
          contatos: [],
        },
      ]);

      const result = await service.listarPacientes(adminCtx);
      expect(result[0]!.email).toBeNull();
      expect(result[0]!.telefone).toBeNull();
    });

    it('does not N+1 — uses a single findMany with include on contatos', async () => {
      mockPrisma.paciente.findMany.mockResolvedValue([]);
      await service.listarPacientes(adminCtx);
      expect(mockPrisma.paciente.findMany).toHaveBeenCalledTimes(1);
      const select = mockPrisma.paciente.findMany.mock.calls[0][0].select;
      // contatos is part of the same select — no extra roundtrip
      expect(select.contatos).toBeDefined();
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

    it('decrypts email/telefone from primary contacts without leaking ciphertext', async () => {
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'p1',
        nomeEncrypted: crypto.encrypt('Maria'),
        cpfEncrypted: crypto.encrypt('52998224725'),
        dataNascimento: null,
        createdAt: new Date(),
        contatos: [
          { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('maria@x.com') },
          { tipo: 'TELEFONE', valorEncrypted: crypto.encrypt('(11) 91234-5678') },
        ],
      });

      const result = await service.obterPaciente(adminCtx, 'p1');
      expect(result.email).toBe('maria@x.com');
      expect(result.telefone).toBe('(11) 91234-5678');
      expect((result as any).valorEncrypted).toBeUndefined();
    });
  });

  describe('atualizarPaciente — primary contacts sync', () => {
      const crypto = new CryptoService(Buffer.alloc(32).toString('base64'));

    const pacienteExistente = {
      id: 'pac-1',
      nomeEncrypted: crypto.encrypt('Maria'),
      cpfEncrypted: crypto.encrypt('52998224725'),
      dataNascimento: null,
      createdAt: new Date(),
    };

    it('omitted email/telefone keeps current values (does not touch contatos)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(pacienteExistente);
      mockPrisma.paciente.update.mockResolvedValue({});
      mockPrisma.paciente.findUniqueOrThrow.mockResolvedValue({
        ...pacienteExistente,
        contatos: [
          { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('maria@x.com') },
          { tipo: 'TELEFONE', valorEncrypted: crypto.encrypt('(11) 91234-5678') },
        ],
      });

      await service.atualizarPaciente(adminCtx, 'pac-1', { nome: 'Maria S.' });

      // Apenas o paciente foi atualizado; nenhum sync de contato.
      expect(mockPrisma.pacienteContato.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.pacienteContato.create).not.toHaveBeenCalled();
      expect(mockPrisma.pacienteContato.updateMany).not.toHaveBeenCalled();
    });

    it('updates only email when only email is provided', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(pacienteExistente);
      mockPrisma.paciente.update.mockResolvedValue({});
      // No existing matching email → create
      mockPrisma.pacienteContato.findFirst.mockResolvedValue(null);
      mockPrisma.pacienteContato.create.mockResolvedValue({});
      mockPrisma.pacienteContato.findMany.mockResolvedValue([
        { id: 'old-email' },
      ]);
      mockPrisma.pacienteContato.updateMany.mockResolvedValue({});
      mockPrisma.paciente.findUniqueOrThrow.mockResolvedValue({
        ...pacienteExistente,
        contatos: [
          { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('novo@x.com') },
        ],
      });

      await service.atualizarPaciente(adminCtx, 'pac-1', {
        email: 'novo@x.com',
      });

      // Only EMAIL type was synced
      const calls = mockPrisma.pacienteContato.findFirst.mock.calls;
      expect(calls.every((c: any[]) => c[0].where.tipo === 'EMAIL')).toBe(true);
      expect(mockPrisma.pacienteContato.create).toHaveBeenCalledTimes(1);
    });

    it('null email soft-deletes primary email contato', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(pacienteExistente);
      mockPrisma.paciente.update.mockResolvedValue({});
      mockPrisma.pacienteContato.findMany.mockResolvedValue([{ id: 'old-email' }]);
      mockPrisma.pacienteContato.updateMany.mockResolvedValue({});
      mockPrisma.paciente.findUniqueOrThrow.mockResolvedValue({
        ...pacienteExistente,
        contatos: [
          { tipo: 'TELEFONE', valorEncrypted: crypto.encrypt('(11) 91234-5678') },
        ],
      });

      const result = await service.atualizarPaciente(adminCtx, 'pac-1', {
        email: null,
      });

      // Soft-delete via updateMany (deleteAt = Date)
      const updateCalls = mockPrisma.pacienteContato.updateMany.mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      expect(updateCalls[0][0].data.deletedAt).toBeDefined();
      // telefone mantido
      expect(result.telefone).toBe('(11) 91234-5678');
      expect(result.email).toBeNull();
    });

    it('repeated identical email does NOT create duplicate contato (idempotente)', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(pacienteExistente);
      mockPrisma.paciente.update.mockResolvedValue({});
      // Already exists with same hash → no-op
      mockPrisma.pacienteContato.findFirst.mockResolvedValue({ id: 'existing-email' });
      mockPrisma.paciente.findUniqueOrThrow.mockResolvedValue({
        ...pacienteExistente,
        contatos: [
          { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('maria@x.com') },
        ],
      });

      await service.atualizarPaciente(adminCtx, 'pac-1', {
        email: '  MARIA@x.com ',
      });

      // No novo create / updateMany porque já existe com mesmo hash
      expect(mockPrisma.pacienteContato.create).not.toHaveBeenCalled();
      expect(mockPrisma.pacienteContato.updateMany).not.toHaveBeenCalled();
    });

    it('changing email soft-deletes previous email contato and creates the new one', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(pacienteExistente);
      mockPrisma.paciente.update.mockResolvedValue({});
      // Existing with same hash → null (we want a different email)
      mockPrisma.pacienteContato.findFirst.mockResolvedValue(null);
      mockPrisma.pacienteContato.findMany.mockResolvedValue([{ id: 'old-email' }]);
      mockPrisma.pacienteContato.updateMany.mockResolvedValue({});
      mockPrisma.pacienteContato.create.mockResolvedValue({});
      mockPrisma.paciente.findUniqueOrThrow.mockResolvedValue({
        ...pacienteExistente,
        contatos: [
          { tipo: 'EMAIL', valorEncrypted: crypto.encrypt('novo2@x.com') },
        ],
      });

      await service.atualizarPaciente(adminCtx, 'pac-1', {
        email: 'novo2@x.com',
      });

      // Old soft-deleted via updateMany + new create
      expect(mockPrisma.pacienteContato.updateMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.pacienteContato.create).toHaveBeenCalledTimes(1);
    });

    it('throws NotFound when updating another psicólogos patient', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);
      await expect(
        service.atualizarPaciente(psicologoCtx, 'pac-other', { nome: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removerPaciente', () => {
    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.removerPaciente(adminCtx, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('PSICOLOGO querying another psicólogos patient to remove gets NotFound (filter excludes it)', async () => {
      // Single-user model: findFirst filters by psicologoResponsavelId: ctx.userId,
      // so another psicólogo's patient is invisible → NotFound.
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.removerPaciente(psicologoCtx, 'p1'),
      ).rejects.toThrow(NotFoundException);
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