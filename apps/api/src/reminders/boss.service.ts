import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { getValidatedEnv } from '../config/env.validation';
import { RemindersService } from './reminders.service';

/**
 * Bridges pg-boss (queue tables live in the same Postgres, schema "pgboss")
 * with the reminders service. Schedules are DEV/PROD friendly:
 * - pending-digest  21:30 UTC ≈ 03:00 IST every day
 * - stage-overdue   every 2 hours
 * Admins can also trigger both instantly via POST /notifications/reminders/run,
 * which is what tests and the web dashboard use.
 */
@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('boss');
  private boss?: PgBoss;

  constructor(private readonly reminders: RemindersService) {}

  async onModuleInit(): Promise<void> {
    if (getValidatedEnv().RUN_SCHEDULER === 'off') {
      this.logger.log('scheduler disabled by RUN_SCHEDULER=off (tests)');
      return;
    }
    try {
      const boss = new PgBoss({ connectionString: getValidatedEnv().DATABASE_URL });
      await boss.start();
      await boss.work('pending-digest', async () => {
        await this.reminders.digestOnce();
      });
      await boss.work('stage-overdue', async () => {
        await this.reminders.overdueOnce();
      });
      await boss.schedule('pending-digest', '30 21 * * *');
      await boss.schedule('stage-overdue', '0 */2 * * *');
      this.boss = boss;
      this.logger.log('pg-boss started (digest 21:30 UTC daily, overdue every 2h)');
    } catch (err) {
      // never take the API down because the queue is unhappy
      this.logger.error(`pg-boss failed to start: ${String(err).slice(0, 300)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.boss?.stop();
    } catch {
      // shutting down regardless
    }
  }
}
