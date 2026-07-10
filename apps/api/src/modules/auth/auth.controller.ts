import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { BillingContextService } from '../../billing/billing-context.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

interface JwtUser {
  id: string;
  email: string;
}

/**
 * Extracts the raw Bearer token from the Authorization header.
 * Used by refresh and logout endpoints that receive a refresh token.
 */
function extractBearerToken(req: Request): string {
  const authHeader = req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') {
    return '';
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]! : '';
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly billingContext: BillingContextService,
  ) {}

  @Post('registro')
  @ApiOperation({ summary: 'Registrar novo usuário' })
  @ApiResponse({ status: 201, description: 'Usuário criado com sucesso' })
  @ApiResponse({ status: 409, description: 'Email ou CPF já cadastrado' })
  async register(@Body() dto: RegisterDto) {
    const tokens = await this.authService.register(dto);
    return {
      mensagem: 'Usuário registrado com sucesso',
      ...tokens,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login com email e senha' })
  @ApiResponse({ status: 200, description: 'Login bem-sucedido' })
  @ApiResponse({ status: 401, description: 'Credenciais inválidas' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token usando refresh token' })
  @ApiResponse({ status: 200, description: 'Tokens renovados (rotação)' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido ou revogado' })
  async refresh(@Req() req: Request) {
    const refreshToken = extractBearerToken(req);
    return this.authService.refreshTokens(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revogar refresh token (logout)' })
  @ApiResponse({ status: 200, description: 'Logout realizado' })
  async logout(@Req() req: Request) {
    const refreshToken = extractBearerToken(req);
    return this.authService.logout(refreshToken);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obter perfil do usuário autenticado' })
  @ApiResponse({ status: 200, description: 'Dados do perfil + cobrança' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async me(@Req() req: { user: JwtUser }) {
    const [profile, cobranca] = await Promise.all([
      this.authService.getProfile(req.user.id),
      this.billingContext.resumo(req.user.id),
    ]);
    return {
      ...profile,
      // Campos de cobrança prontos para a UI consumir (layout, header, dashboard).
      planoAtual: cobranca?.plano ?? null,
      cicloAtual: cobranca?.assinatura
        ? {
            inicio: cobranca.assinatura.cicloInicio,
            fim: cobranca.assinatura.cicloFim,
            status: cobranca.assinatura.status,
          }
        : null,
      saldo: cobranca?.saldo ?? 0,
      cotaUsada: cobranca?.cotaUsada ?? 0,
      cotaTotal: cobranca?.cotaTotal ?? 0,
      paygUsado: cobranca?.paygUsado ?? 0,
      motivoSemPlano: cobranca?.motivoSemPlano ?? null,
    };
  }
}
