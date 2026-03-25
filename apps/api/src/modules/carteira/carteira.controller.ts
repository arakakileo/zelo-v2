import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TenancyGuard } from '../../common/tenancy/tenancy.guard';
import { CarteiraService } from './carteira.service';
import { CargaCreditoDto } from './dto/carga-credito.dto';
import { TenantContext } from '@zelo/contracts';

interface TenantRequest {
  user: { id: string; email: string };
  tenantContext: TenantContext;
}

@ApiTags('carteira')
@ApiHeader({ name: 'X-Clinica-ID', description: 'UUID da clínica ativa', required: true })
@Controller('carteira')
@UseGuards(AuthGuard('jwt'), TenancyGuard)
@ApiBearerAuth()
export class CarteiraController {
  constructor(private readonly carteiraService: CarteiraService) {}

  @Get('saldo')
  @ApiOperation({ summary: 'Ver saldo da clínica (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Saldo atual' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN' })
  async saldo(@Req() req: TenantRequest) {
    return this.carteiraService.verSaldo(req.tenantContext);
  }

  @Get('transacoes')
  @ApiOperation({ summary: 'Listar transações (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Lista de transações' })
  async transacoes(@Req() req: TenantRequest) {
    return this.carteiraService.listarTransacoes(req.tenantContext);
  }

  @Post('carga')
  @ApiOperation({ summary: 'Carregar créditos (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Créditos carregados' })
  async carga(@Req() req: TenantRequest, @Body() dto: CargaCreditoDto) {
    return this.carteiraService.carregarCreditos(req.tenantContext, dto);
  }
}
