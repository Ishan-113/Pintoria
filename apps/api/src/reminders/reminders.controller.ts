import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RemindersService } from './reminders.service';

@ApiTags('reminders')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  /** Manual trigger for admins / cron callers / the web dashboard button. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('notification.manage')
  @HttpCode(HttpStatus.OK)
  @Post('reminders/run')
  async runNow() {
    const [digests, reminders] = await Promise.all([
      this.reminders.digestOnce(),
      this.reminders.overdueOnce(),
    ]);
    return { digestsSent: digests, remindersSent: reminders };
  }
}
