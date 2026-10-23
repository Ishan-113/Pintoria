import { IsOptional, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ListNotificationsDto {
  @IsOptional() @Type(() => Number)
  take?: number;

  @IsOptional() @IsUUID()
  orderId?: string;
}

export class UpdatePrefsDto {
  @IsOptional() @IsBoolean()
  emailAlerts?: boolean;

  @IsOptional() @IsBoolean()
  whatsappAlerts?: boolean;

  @IsOptional() @IsBoolean()
  dailyPendingReminder?: boolean;
}
