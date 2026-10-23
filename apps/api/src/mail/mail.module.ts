import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER, EmailProvider } from './email-provider.interface';
import { LogOnlyEmailProvider } from './log-only.provider';
import { MailService } from './mail.service';
import { ResendEmailProvider } from './resend.provider';

@Global()
@Module({
  providers: [
    LogOnlyEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (config: ConfigService): EmailProvider => {
        const name = config.get<string>('EMAIL_PROVIDER') ?? 'log';
        if (name === 'resend') return new ResendEmailProvider(config);
        return new LogOnlyEmailProvider();
      },
      inject: [ConfigService],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
