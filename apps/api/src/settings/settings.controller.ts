import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsObject, IsString } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { SessionUser } from '../auth/auth.types';
import { SettingsService } from './settings.service';

export class UpdateSettingDto {
  @IsString()
  key!: string;

  @IsObject()
  value!: Record<string, unknown>;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings/public')
  async publicSettings() {
    return this.settings.publicSettings();
  }

  @Permissions('admin.settings')
  @Get('admin/settings')
  async list() {
    return this.settings.all();
  }

  @Permissions('admin.settings')
  @Put('admin/settings')
  async update(@Body() dto: UpdateSettingDto, @CurrentUser() user: SessionUser) {
    await this.settings.update(dto.key, dto.value, user.id);
    return this.settings.all();
  }
}
