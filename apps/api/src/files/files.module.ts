import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule, SettingsModule, AuditModule, OrdersModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
