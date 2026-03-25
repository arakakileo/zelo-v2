import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
