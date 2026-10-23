import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from './whatsapp-provider.interface';
import { LogOnlyWhatsAppProvider } from './log-only.provider';
import { OffWhatsAppProvider } from './off.provider';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({
  providers: [
    LogOnlyWhatsAppProvider,
    OffWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: (config: ConfigService): WhatsAppProvider => {
        const name = config.get<string>('WHATSAPP_PROVIDER') ?? 'log';
        if (name === 'log') return new LogOnlyWhatsAppProvider();
        return new OffWhatsAppProvider();
      },
      inject: [ConfigService],
    },
    WhatsAppService,
  ],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
