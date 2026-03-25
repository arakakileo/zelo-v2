import { Module } from '@nestjs/common';
import { CarteiraController } from './carteira.controller';
import { CarteiraService } from './carteira.service';

@Module({
  controllers: [CarteiraController],
  providers: [CarteiraService],
  exports: [CarteiraService],
})
export class CarteiraModule {}
