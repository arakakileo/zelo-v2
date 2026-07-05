import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ConsumoService } from './consumo.service';
import { PlanosController } from './planos.controller';
import { AssinaturasController } from './assinaturas.controller';
import { PagamentosController } from './pagamentos.controller';

@Module({
  controllers: [PlanosController, AssinaturasController, PagamentosController],
  providers: [ConsumoService],
  exports: [ConsumoService],
})
export class BillingModule {}
