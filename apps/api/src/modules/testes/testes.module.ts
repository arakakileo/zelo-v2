import { Module } from '@nestjs/common';
import { TestesController } from './testes.controller';
import { SessoesController } from './sessoes.controller';
import { TestesService } from './testes.service';
import { SessoesService } from './sessoes.service';

@Module({
  controllers: [TestesController, SessoesController],
  providers: [TestesService, SessoesService],
  exports: [TestesService, SessoesService],
})
export class TestesModule {}
