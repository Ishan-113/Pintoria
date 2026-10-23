import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { RateLimiterService } from './rate-limiter.service';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    AuditModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: config.getOrThrow<string>('JWT_ACCESS_TTL') },
      }),
    }),
  ],
  providers: [AuthService, TokensService, RateLimiterService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
