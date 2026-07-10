import { Module } from '@nestjs/common';
import { ConsumoService } from './consumo.service';
import { BillingContextService } from './billing-context.service';
import { PlanosController } from './planos.controller';
import { AssinaturasController } from './assinaturas.controller';
import { PagamentosController } from './pagamentos.controller';

@Module({
  controllers: [PlanosController, AssinaturasController, PagamentosController],
  providers: [ConsumoService, BillingContextService],
  exports: [ConsumoService, BillingContextService],
})
export class BillingModule {}
