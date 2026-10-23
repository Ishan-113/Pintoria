import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.validation';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { AuditModule } from './audit/audit.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OrdersModule } from './orders/orders.module';
import { FilesModule } from './files/files.module';
import { StorageModule } from './storage/storage.module';
import { RemindersModule } from './reminders/reminders.module';

import { AppController } from './app.controller';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { PricingRedactionInterceptor } from './common/interceptors/pricing-redaction.interceptor';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Phase 1 foundation module. Order, quotation, PO, fulfilment and dashboard
 * modules mount here in checkpoints 1b–2; web arrives at 1d.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    MailModule,
    WhatsAppModule,
    AuditModule,
    SettingsModule,
    NotificationsModule,
    OrdersModule,
    StorageModule,
    FilesModule,
    RemindersModule,
    AdminModule,
    DashboardModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PricingRedactionInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
