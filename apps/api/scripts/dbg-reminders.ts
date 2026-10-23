/* eslint-disable no-console */
// Standalone check of the reminders service against a live DB (debug artifact).
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { RemindersService } from '../src/reminders/reminders.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const svc = app.get(RemindersService);
  const prisma = app.get(PrismaService);

  console.log('digestOnce:', await svc.digestOnce());
  console.log('overdueOnce:', await svc.overdueOnce());

  const logs = await prisma.notificationLog.findMany({
    select: { templateKey: true, status: true, toAddress: true, lastError: true },
  });
  for (const l of logs) console.log(l.templateKey, l.status, l.toAddress, l.lastError ?? '');
  await app.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
