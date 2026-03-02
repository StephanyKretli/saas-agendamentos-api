import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: 'http://localhost:3000',
    credentials: true,
  });

  const port = 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`API running on http://127.0.0.1:${port}`);
}
bootstrap();