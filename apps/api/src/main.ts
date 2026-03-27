import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'https://zelo.arakakileo.com',
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    credentials: true,
  });

  // Global validation pipe — strips unknown fields, transforms types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // API prefix
  app.setGlobalPrefix('api');

  // Swagger docs (disabled in production)
  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Zelo V2 API')
      .setDescription('SaaS para gestão de consultórios de psicologia')
      .setVersion('2.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Clinica-ID', in: 'header' }, 'X-Clinica-ID')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`🚀 Zelo API running on http://localhost:${port}/api`);
  console.log(`📖 Docs available at http://localhost:${port}/docs`);
}

bootstrap();
