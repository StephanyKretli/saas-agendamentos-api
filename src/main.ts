import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; // 👈 adicionar

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 👇 ADICIONE AQUI
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,      // remove campos extras
      transform: true,      // transforma tipos automaticamente
      forbidNonWhitelisted: true, // opcional (mais rígido)
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('SaaS Agendamentos API')
    .setDescription('Documentação e testes da API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'jwt',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(3001);
}
bootstrap();