import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorResponse {
  statusCode: number;
  codigo: string;
  mensagem: string;
  timestamp: string;
  path: string;
}

/**
 * Global exception filter — translates all errors into a standardized JSON format.
 *
 * Maps:
 *  - Prisma P2002 (unique constraint) → 409 CONFLITO
 *  - Prisma P2025 (not found) → 404 NAO_ENCONTRADO
 *  - NestJS HttpExceptions → their status code
 *  - Validation errors → 400 VALIDACAO_INVALIDA
 *  - Generic errors → 500 ERRO_INTERNO
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, codigo, mensagem } = this.resolveError(exception);

    if (statusCode >= 500) {
      this.logger.error(`[${request.method}] ${request.url} → ${statusCode}`, exception instanceof Error ? exception.stack : String(exception));
    }

    const body: ErrorResponse = {
      statusCode,
      codigo,
      mensagem,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): { statusCode: number; codigo: string; mensagem: string } {
    // Prisma known errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { statusCode: HttpStatus.CONFLICT, codigo: 'CONFLITO', mensagem: 'Recurso já existe' };
        case 'P2025':
          return { statusCode: HttpStatus.NOT_FOUND, codigo: 'NAO_ENCONTRADO', mensagem: 'Recurso não encontrado' };
        case 'P2003':
          return { statusCode: HttpStatus.BAD_REQUEST, codigo: 'REFERENCIA_INVALIDA', mensagem: 'Referência inválida' };
        default:
          return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, codigo: 'ERRO_BANCO', mensagem: 'Erro de banco de dados' };
      }
    }

    // NestJS HttpExceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const mensagem = typeof res === 'string' ? res : (res as { message?: string }).message ?? exception.message;
      const codigo = this.statusToCodigo(status);
      return { statusCode: status, codigo, mensagem: Array.isArray(mensagem) ? mensagem.join(', ') : mensagem };
    }

    // Generic errors
    if (exception instanceof Error) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        codigo: 'ERRO_INTERNO',
        mensagem: 'Erro interno do servidor',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      codigo: 'ERRO_DESCONHECIDO',
      mensagem: 'Erro desconhecido',
    };
  }

  private statusToCodigo(status: number): string {
    const map: Record<number, string> = {
      400: 'REQUISICAO_INVALIDA',
      401: 'NAO_AUTENTICADO',
      402: 'SALDO_INSUFICIENTE',
      403: 'ACESSO_NEGADO',
      404: 'NAO_ENCONTRADO',
      409: 'CONFLITO',
      422: 'ENTIDADE_INVALIDA',
    };
    return map[status] ?? 'ERRO_HTTP';
  }
}
