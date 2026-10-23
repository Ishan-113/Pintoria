import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BossService } from './boss.service';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [SettingsModule],
  controllers: [RemindersController],
  providers: [RemindersService, BossService],
})
export class RemindersModule {}
