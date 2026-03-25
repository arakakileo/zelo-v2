import { Module } from '@nestjs/common';
import { ClinicasController } from './clinicas.controller';
import { ClinicasService } from './clinicas.service';

@Module({
  controllers: [ClinicasController],
  providers: [ClinicasService],
  exports: [ClinicasService],
})
export class ClinicasModule {}
