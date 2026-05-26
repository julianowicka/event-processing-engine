import './env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN;

  app.enableShutdownHooks();
  app.setGlobalPrefix('api', {
    exclude: [
      'events',
      'events/:eventId',
      'api/events',
      'api/events/:eventId',
      'orders/:id',
      'api/orders/:id',
      'stats',
      'api/stats',
      'health',
      'api/health',
    ],
  });
  app.enableCors({
    origin: corsOrigin
      ? corsOrigin.split(',').map((origin) => origin.trim())
      : true,
  });

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
