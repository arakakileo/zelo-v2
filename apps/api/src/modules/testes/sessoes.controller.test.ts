import { Test, TestingModule } from '@nestjs/testing';
import { SessoesController } from './sessoes.controller';
import { SessoesService } from './sessoes.service';

describe('SessoesController', () => {
  let controller: SessoesController;
  let mockService: any;

  beforeEach(async () => {
    mockService = {
      iniciarSessao: jest.fn(),
      listarSessoes: jest.fn(),
      finalizarSessao: jest.fn(),
      cancelarSessao: jest.fn(),
      relatorioFinal: jest.fn(),
      gerarPdfLaudo: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessoesController],
      providers: [{ provide: SessoesService, useValue: mockService }],
    }).compile();

    controller = module.get(SessoesController);
  });

  describe('relatorioPdf', () => {
    function createMockResponse() {
      const headers: Record<string, string> = {};
      let ended = false;
      let endBuffer: Buffer | null = null;
      const res: any = {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        end: (data: Buffer) => {
          ended = true;
          endBuffer = data;
        },
      };
      return { res, headers, getEnded: () => ended, getEndBuffer: () => endBuffer };
    }

    it('sets correct Content-Type, Content-Disposition, Content-Length and body bytes', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 mock content here for testing');
      mockService.gerarPdfLaudo.mockResolvedValue({
        buffer: pdfBuffer,
        filename: 'laudo-BDI-II-Maria-Garcas.pdf',
      });

      const { res, headers, getEnded, getEndBuffer } = createMockResponse();

      await controller.relatorioPdf(
        { user: { id: 'psico-1', email: 'test@test.com' } },
        'sessao-1',
        res,
      );

      expect(mockService.gerarPdfLaudo).toHaveBeenCalledWith(
        { userId: 'psico-1' },
        'sessao-1',
      );

      // Content-Type é application/pdf
      expect(headers['Content-Type']).toBe('application/pdf');

      // Content-Disposition tem attachment + filename sanitizado
      expect(headers['Content-Disposition']).toContain('attachment');
      expect(headers['Content-Disposition']).toContain('filename=');
      expect(headers['Content-Disposition']).toContain('laudo-BDI-II-Maria-Garcas.pdf');
      // Aspas duplas no filename
      expect(headers['Content-Disposition']).toContain('"laudo-BDI-II-Maria-Garcas.pdf"');

      // Content-Length é o tamanho real do buffer
      expect(headers['Content-Length']).toBe(String(pdfBuffer.length));

      // Body: res.end foi chamado com os bytes do PDF
      expect(getEnded()).toBe(true);
      expect(getEndBuffer()).toBe(pdfBuffer);
    });

    it('sanitizes Content-Disposition against header injection (CR/LF removed)', async () => {
      // Filename malicioso com CR/LF — não deve aparecer no header
      const maliciousFilename = 'laudo\r\nX-Injected: evil\n\r.pdf';
      const pdfBuffer = Buffer.from('%PDF-1.4 test');
      mockService.gerarPdfLaudo.mockResolvedValue({
        buffer: pdfBuffer,
        filename: maliciousFilename,
      });

      const { res, headers } = createMockResponse();

      await controller.relatorioPdf(
        { user: { id: 'psico-1', email: 'test@test.com' } },
        'sessao-1',
        res,
      );

      const cd = headers['Content-Disposition'] ?? '';
      // Não deve conter CR nem LF (previne header splitting)
      expect(cd).not.toContain('\r');
      expect(cd).not.toContain('\n');
      // O regex remove aspas, CR e LF — sem CR/LF não há header injection
      expect(cd.startsWith('attachment; filename="')).toBe(true);
    });

    it('propagates BadRequestException from service (sessão ABERTA)', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      mockService.gerarPdfLaudo.mockRejectedValue(
        new BadRequestException('Não é possível gerar laudo de sessão ABERTO'),
      );

      const { res } = createMockResponse();

      await expect(
        controller.relatorioPdf(
          { user: { id: 'psico-1', email: 'test@test.com' } },
          's-aberta',
          res,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException from service (ownership)', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockService.gerarPdfLaudo.mockRejectedValue(
        new NotFoundException('Sessão não encontrada'),
      );

      const { res } = createMockResponse();

      await expect(
        controller.relatorioPdf(
          { user: { id: 'psico-1', email: 'test@test.com' } },
          's-other',
          res,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
