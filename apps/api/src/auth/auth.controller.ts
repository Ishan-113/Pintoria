import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  InviteUserDto,
  LoginDto,
  RefreshDto,
  SetPasswordDto,
} from './dto/auth.dto';
import { TokensService } from './tokens.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  private static userAgent(req: unknown): string {
    const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};
    const ua = headers['user-agent'];
    return Array.isArray(ua) ? ua[0] : (ua ?? 'unknown');
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Req() req: unknown) {
    return this.auth.login(dto, ip, AuthController.userAgent(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Ip() ip: string, @Req() req: unknown) {
    return this.tokens.rotate(dto.refreshToken, ip, AuthController.userAgent(req));
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.tokens.revoke(dto.refreshToken);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    return this.auth.me(user);
  }

  @Public()
  @HttpCode(202)
  @Post('forgot-password')
  async forgot(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    await this.auth.forgotPassword(dto.email, ip);
    return { accepted: true };
  }

  @Public()
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body() dto: SetPasswordDto, @Ip() ip: string) {
    await this.auth.resetPassword(dto.token, dto.password, ip);
    return { ok: true };
  }

  @Public()
  @Get('invite/:token')
  async inviteInfo(@Param('token') token: string) {
    return this.auth.getInviteInfo(token);
  }

  @Public()
  @HttpCode(200)
  @Post('accept-invite')
  async acceptInvite(@Body() dto: SetPasswordDto, @Ip() ip: string) {
    await this.auth.acceptInvite(dto, ip);
    return { ok: true };
  }

  @ApiBearerAuth()
  @Permissions('admin.users')
  @HttpCode(200)
  @Post('invitations')
  async createInvitation(@Body() dto: InviteUserDto, @CurrentUser() user: SessionUser) {
    return this.auth.createInvitation(dto.userId, user.id);
  }
}
