import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { TestesController } from './testes.controller';
import { SessoesController } from './sessoes.controller';
import { TestesService } from './testes.service';
import { SessoesService } from './sessoes.service';

@Module({
  imports: [BillingModule],
  controllers: [TestesController, SessoesController],
  providers: [TestesService, SessoesService],
  exports: [TestesService, SessoesService],
})
export class TestesModule {}
