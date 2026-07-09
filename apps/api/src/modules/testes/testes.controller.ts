import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TestesService } from './testes.service';

@ApiTags('testes (catálogo)')
@Controller('testes')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class TestesController {
  constructor(private readonly testesService: TestesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar catálogo global de testes' })
  @ApiResponse({ status: 200, description: 'Catálogo de testes' })
  async listar() {
    return this.testesService.listarTestes();
  }

  @Get('catalogo-estruturado')
  @ApiOperation({ summary: 'Catálogo estruturado de testes clínicos (Project Gaia)' })
  @ApiResponse({ status: 200, description: 'Catálogo estruturado com definições, campos e ações guiadas' })
  catalogoEstruturado() {
    return this.testesService.getCatalogoEstruturado();
  }

  @Get(':testeId/aplicacao/:actionKey')
  @ApiOperation({ summary: 'Definição de aplicação guiada para uma ação de teste' })
  @ApiResponse({ status: 200, description: 'Definição da aplicação guiada' })
  aplicacao(
    @Param('testeId') testeId: string,
    @Param('actionKey') actionKey: string,
  ) {
    return this.testesService.getAplicacaoDefinicao(testeId, actionKey);
  }
}
