import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SessionUser } from '../auth/auth.types';
import { AdminService } from './admin.service';
import {
  CreateClientDto,
  CreateRegionDto,
  CreateUserDto,
  ListClientsDto,
  ListRegionsDto,
  ListUsersDto,
  UpdateClientDto,
  UpdateRegionDto,
  UpdateUserDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // ---------- clients ----------
  @Permissions('admin.clients')
  @Get('clients')
  listClients(@Query() q: ListClientsDto) {
    return this.admin.listClients(q);
  }

  @Permissions('admin.clients')
  @Post('clients')
  createClient(@Body() dto: CreateClientDto, @CurrentUser() user: SessionUser) {
    return this.admin.createClient(dto, user.id);
  }

  @Permissions('admin.clients')
  @Put('clients/:id')
  updateClient(
    @Param('id') id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.admin.updateClient(id, dto, user.id);
  }

  @Permissions('admin.clients')
  @HttpCode(HttpStatus.OK)
  @Delete('clients/:id')
  deleteClient(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.admin.deleteClient(id, user.id);
  }

  // ---------- regions ----------
  @Permissions('admin.regions')
  @Get('regions')
  listRegions(@Query() q: ListRegionsDto) {
    return this.admin.listRegions(q.clientId);
  }

  @Permissions('admin.regions')
  @Post('regions')
  createRegion(@Body() dto: CreateRegionDto, @CurrentUser() user: SessionUser) {
    return this.admin.createRegion(dto, user.id);
  }

  @Permissions('admin.regions')
  @Put('regions/:id')
  updateRegion(
    @Param('id') id: string,
    @Body() dto: UpdateRegionDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.admin.updateRegion(id, dto, user.id);
  }

  @Permissions('admin.regions')
  @HttpCode(HttpStatus.OK)
  @Delete('regions/:id')
  deleteRegion(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.admin.deleteRegion(id, user.id);
  }

  // ---------- users ----------
  @Permissions('admin.users')
  @Get('users')
  listUsers(@Query() q: ListUsersDto) {
    return this.admin.listUsers(q);
  }

  @Permissions('admin.users')
  @Post('users')
  createUser(@Body() dto: CreateUserDto, @CurrentUser() user: SessionUser) {
    return this.admin.createUser(dto, user.id);
  }

  @Permissions('admin.users')
  @Put('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: SessionUser) {
    return this.admin.updateUser(id, dto, user.id);
  }

  @Permissions('admin.users')
  @HttpCode(HttpStatus.OK)
  @Post('users/:id/resend-invite')
  resendInvite(@Param('id') id: string, @CurrentUser() user: SessionUser) {
    return this.admin.resendInvite(id, user.id);
  }
}
