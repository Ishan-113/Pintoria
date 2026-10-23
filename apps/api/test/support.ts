import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';

/** Boots the real Nest app for e2e tests (same prefix/pipe setup as main.ts). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false },
    }),
  );
  await app.init();
  return app;
}
