import { Module } from '@nestjs/common';
import { ConvitesController } from './convites.controller';
import { ConvitesService } from './convites.service';

@Module({
  controllers: [ConvitesController],
  providers: [ConvitesService],
  exports: [ConvitesService],
})
export class ConvitesModule {}
