import { Controller, Get, Put, Body, Query, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { SessionUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto, UpdatePrefsDto } from './dto/notifications.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser, @Query() q: ListNotificationsDto) {
    if (q.orderId) {
      if (user.role !== 'PRINTORIA_ADMIN') {
        throw new ForbiddenException('Only Printoria admin can inspect another order’s feed.');
      }
      return this.notifications.listForOrder(q.orderId, Math.min(q.take ?? 50, 200));
    }
    return this.notifications.listMine(user, Math.min(q.take ?? 50, 200));
  }

  @Get('prefs')
  prefs(@CurrentUser() user: SessionUser) {
    if (!user.clientId) throw new ForbiddenException('Your account is not linked to a client.');
    return this.notifications.getPrefs(user.clientId);
  }

  @Permissions('profile.edit')
  @Put('prefs')
  updatePrefs(@CurrentUser() user: SessionUser, @Body() dto: UpdatePrefsDto) {
    return this.notifications.updatePrefs(user, dto);
  }
}
