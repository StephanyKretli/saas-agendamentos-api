import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; 
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

async function bootstrap() {
  // 1. Inicialização do Sentry
  Sentry.init({
    dsn: 'https://32dd4ef87b23f8c5eae472459ebb6e05@o4511197891067904.ingest.us.sentry.io/4511197892640768', 
    integrations: [
      nodeProfilingIntegration(),
    ],
    // Captura 100% dos erros e da performance
    tracesSampleRate: 1.0, 
    profilesSampleRate: 1.0,
  });

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['https://meusyncro.com.br', 'http://localhost:3000'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true, 
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalInterceptors(new TransformInterceptor());

  // 🛡️ 2. Ativamos APENAS o seu filtro padrão (que agora tem o Sentry embutido nele!)
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger somente fora de produção
  if (process.env.NODE_ENV !== 'production') {
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
  }

  await app.listen(process.env.PORT || 3333, '0.0.0.0');
}
bootstrap();