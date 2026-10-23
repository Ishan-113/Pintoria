import 'reflect-metadata';
import helmet from 'helmet';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { getValidatedEnv } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const env = getValidatedEnv();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // server-to-server / curl
      return callback(null, env.webOrigins.includes(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false },
    }),
  );

  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });

  const docConfig = new DocumentBuilder()
    .setTitle('Printoria Portal API')
    .setDescription('B2B order workflow portal for Printoria International Pvt Ltd')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, docConfig));

  app.enableShutdownHooks();
  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(
    `API listening on http://localhost:${env.PORT} · OpenAPI at /api/docs · env=${env.NODE_ENV}`,
  );
}

void bootstrap();
