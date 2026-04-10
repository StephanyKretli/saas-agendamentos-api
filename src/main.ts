import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Catch, ArgumentsHost } from '@nestjs/common'; 
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { BaseExceptionFilter } from '@nestjs/core';

// 🛡️ 1. O nosso Escudo Customizado que envia os erros para o Sentry
@Catch()
export class SentryFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    Sentry.captureException(exception);
    super.catch(exception, host);
  }
}

async function bootstrap() {
  // 2. Inicialização do Sentry
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

  // 🛡️ 3. Ativamos os dois filtros: O do Sentry e o seu filtro padrão
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(
    new SentryFilter(httpAdapter), 
    new AllExceptionsFilter()
  );

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