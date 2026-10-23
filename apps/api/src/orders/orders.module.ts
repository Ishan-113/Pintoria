import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderNumberingService } from './order-numbering.service';
import { OrderScopeService } from './order-scope.service';
import { OrderTransitionsService } from './order-transitions.service';
import { PoVerificationService } from './po-verification.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuditModule, SettingsModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderScopeService,
    OrderNumberingService,
    OrderTransitionsService,
    PoVerificationService,
  ],
  exports: [OrderScopeService],
})
export class OrdersModule {}
