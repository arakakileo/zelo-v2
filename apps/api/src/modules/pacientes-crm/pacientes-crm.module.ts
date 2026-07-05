import { Module } from '@nestjs/common';
import { PacientesCrmController } from './pacientes-crm.controller';
import { PacientesCrmService } from './pacientes-crm.service';

@Module({
  controllers: [PacientesCrmController],
  providers: [PacientesCrmService],
  exports: [PacientesCrmService],
})
export class PacientesCrmModule {}