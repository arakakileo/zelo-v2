import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { SessoesService } from './sessoes.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Papel, StatusSessao, type TenantContext } from '@zelo/contracts';
import {
  createMockPrismaService,
  createMockConfigService,
} from '../../test-utils';

describe('SessoesService', () => {
  let service: SessoesService;
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
        SessoesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get(SessoesService);
    resetPrismaMock();
  });

  describe('iniciarSessao', () => {
    const validDto = {
      pacienteId: '550e8400-e29b-41d4-a716-446655440000',
      testeId: '550e8400-e29b-41d4-a716-446655440001',
    };

    it('throws NotFoundException when patient does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(adminCtx, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when PSICOLOGO tries patient from another psychologist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'other-psico',
      });

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when test does not exist', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when clinic has no carteira', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 5,
      });
      // Inside $transaction, carteira.findUnique returns null
      mockPrisma.carteira.findUnique.mockResolvedValue(null);

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when saldo is insufficient', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 10,
      });
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(5), // less than 10
      });

      await expect(
        service.iniciarSessao(psicologoCtx, validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('debits credits and creates sessao on success', async () => {
      mockPrisma.paciente.findFirst.mockResolvedValue({
        id: 'pac-1',
        psicologoResponsavelId: 'psico-1',
      });
      mockPrisma.teste.findUnique.mockResolvedValue({
        id: 'teste-1',
        precoCreditos: 10,
      });
      mockPrisma.carteira.findUnique.mockResolvedValue({
        id: 'cart-1',
        saldo: new Decimal(100),
      });
      const createdSessao = {
        id: 'sessao-1',
        pacienteId: 'pac-1',
        clinicaId: 'c1',
        status: StatusSessao.ABERTO,
      };
      mockPrisma.sessaoTeste.create.mockResolvedValue(createdSessao);

      const result = await service.iniciarSessao(psicologoCtx, validDto);

      expect(result.id).toBe('sessao-1');
      // Verify transaction was used
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      // Verify carteira was debited
      const carteiraCall = mockPrisma.carteira.update.mock.calls[0][0];
      expect(carteiraCall.data.saldo).toEqual({ decrement: 10 });
    });
  });

  describe('finalizarSessao', () => {
    it('throws NotFoundException when sessao does not exist', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.finalizarSessao(adminCtx, 'nonexistent', {
          dadosRespostas: {},
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sessao is not ABERTO', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        psicologoId: 'psico-1',
        status: StatusSessao.FINALIZADO,
      });

      await expect(
        service.finalizarSessao(adminCtx, 's1', {
          dadosRespostas: {},
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when PSICOLOGO tries to finalize others sessao', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        psicologoId: 'other-psico',
        status: StatusSessao.ABERTO,
      });

      await expect(
        service.finalizarSessao(psicologoCtx, 's1', {
          dadosRespostas: {},
          conclusaoPsicologo: 'text',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('saves encrypted results and marks as FINALIZADO', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        psicologoId: 'psico-1',
        status: StatusSessao.ABERTO,
      });
      mockPrisma.sessaoTeste.update.mockResolvedValue({});

      const result = await service.finalizarSessao(psicologoCtx, 's1', {
        dadosRespostas: { q1: 'A', q2: 'B' },
        conclusaoPsicologo: 'Paciente apresentou ansiedade',
      });

      expect(result.mensagem).toContain('finalizada');
      const updateCall = mockPrisma.sessaoTeste.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe(StatusSessao.FINALIZADO);
      // Encrypted fields should not contain plaintext
      expect(updateCall.data.resultadoCalculadoEncrypted).not.toContain('respostas avaliadas');
      expect(updateCall.data.conclusaoPsicologoEncrypted).not.toBe('Paciente apresentou ansiedade');
    });
  });

  describe('listarSessoes', () => {
    it('PSICOLOGO sees only their sessoes', async () => {
      mockPrisma.sessaoTeste.findMany.mockResolvedValue([]);

      await service.listarSessoes(psicologoCtx);

      const findCall = mockPrisma.sessaoTeste.findMany.mock.calls[0][0];
      expect(findCall.where.psicologoId).toBe('psico-1');
    });

    it('ADMIN sees all sessoes in clinic', async () => {
      mockPrisma.sessaoTeste.findMany.mockResolvedValue([]);

      await service.listarSessoes(adminCtx);

      const findCall = mockPrisma.sessaoTeste.findMany.mock.calls[0][0];
      expect(findCall.where.psicologoId).toBeUndefined();
      expect(findCall.where.clinicaId).toBe('c1');
    });
  });

  describe('relatorioFinal', () => {
    it('throws NotFoundException when sessao does not exist', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue(null);

      await expect(
        service.relatorioFinal(adminCtx, 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    it('PSICOLOGO is blocked from other psychologists reports', async () => {
      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        psicologoId: 'other-psico',
        status: StatusSessao.FINALIZADO,
      });

      // Service queries without psicologoId filter, then checks ownership
      await expect(
        service.relatorioFinal(psicologoCtx, 's1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns decrypted report data', async () => {
      // Use a real CryptoService to produce valid encrypted envelopes
      const { CryptoService } = await import('@zelo/crypto');
      const crypto = new CryptoService(
        Buffer.alloc(32).toString('base64'),
      );

      mockPrisma.sessaoTeste.findFirst.mockResolvedValue({
        id: 's1',
        status: StatusSessao.FINALIZADO,
        psicologoId: 'psico-1',
        dadosRespostas: { q1: 'A' },
        resultadoCalculadoEncrypted: crypto.encrypt('Resultado processado'),
        conclusaoPsicologoEncrypted: crypto.encrypt('Conclusão do psicólogo'),
        finalizadoEm: new Date(),
        paciente: {
          id: 'p1',
          nomeEncrypted: crypto.encrypt('Maria das Graças'),
          cpfEncrypted: crypto.encrypt('12345678900'),
        },
        teste: { sigla: 'BDI', nome: 'Beck Depression Inventory' },
        psicologo: {
          nomeCompleto: 'Dr. Silva',
          memberships: [{ registroProfissional: 'CRP 06/12345' }],
        },
      });

      const result = await service.relatorioFinal(psicologoCtx, 's1');

      // Decrypted values should be the real plaintext
      expect(result.paciente.nome).toBe('Maria das Graças');
      expect(result.resultadoCalculado).toBe('Resultado processado');
      expect(result.conclusaoPsicologo).toBe('Conclusão do psicólogo');
      expect(result.psicologo.registro).toBe('CRP 06/12345');
    });
  });
});
