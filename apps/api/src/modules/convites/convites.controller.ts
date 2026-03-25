import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConvitesService } from './convites.service';
import { CriarConviteDto } from './dto/criar-convite.dto';
import { AceitarConviteDto } from './dto/aceitar-convite.dto';

interface JwtUser {
  id: string;
  email: string;
}

@ApiTags('convites')
@Controller('convites')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ConvitesController {
  constructor(private readonly convitesService: ConvitesService) {}

  @Post()
  @ApiOperation({ summary: 'Criar convite (ADMIN only)' })
  @ApiQuery({ name: 'clinicaId', description: 'ID da clínica' })
  @ApiResponse({ status: 201, description: 'Convite criado' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN' })
  @ApiResponse({ status: 409, description: 'Convite duplicado' })
  async criar(
    @Req() req: { user: JwtUser },
    @Query('clinicaId') clinicaId: string,
    @Body() dto: CriarConviteDto,
  ) {
    return this.convitesService.criarConvite(req.user.id, clinicaId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar convites da clínica (ADMIN only)' })
  @ApiQuery({ name: 'clinicaId', description: 'ID da clínica' })
  @ApiResponse({ status: 200, description: 'Lista de convites' })
  async listar(
    @Req() req: { user: JwtUser },
    @Query('clinicaId') clinicaId: string,
  ) {
    return this.convitesService.listarConvites(req.user.id, clinicaId);
  }

  @Post('aceitar')
  @ApiOperation({ summary: 'Aceitar convite via token' })
  @ApiResponse({ status: 200, description: 'Convite aceito' })
  @ApiResponse({ status: 404, description: 'Convite não encontrado' })
  @ApiResponse({ status: 400, description: 'Convite expirado ou já usado' })
  async aceitar(@Req() req: { user: JwtUser }, @Body() dto: AceitarConviteDto) {
    return this.convitesService.aceitarConvite(req.user.id, dto);
  }
}
