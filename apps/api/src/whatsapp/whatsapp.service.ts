import { Inject, Injectable } from '@nestjs/common';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppMessage,
  type WhatsAppProvider,
} from './whatsapp-provider.interface';

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  /** 'off' providers never send — callers should keep their rows QUEUED. */
  get active(): boolean {
    return this.provider.name !== 'off';
  }

  send(message: WhatsAppMessage): Promise<{ id?: string }> {
    return this.provider.send(message);
  }
}
