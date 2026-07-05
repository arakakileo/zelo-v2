import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { PacientesModule } from './modules/pacientes/pacientes.module';
import { PacientesCrmModule } from './modules/pacientes-crm/pacientes-crm.module';
import { TestesModule } from './modules/testes/testes.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    PacientesModule,
    PacientesCrmModule,
    TestesModule,
    BillingModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
