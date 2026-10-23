import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppMessage, WhatsAppProvider } from './whatsapp-provider.interface';

/** The gateway is switched off — messages queue back in the feed
 *  (QUEUED + explanatory lastError) instead of being sent. */
@Injectable()
export class OffWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'off';
  private readonly logger = new Logger('whatsapp');

  async send(_message: WhatsAppMessage): Promise<{ id?: string }> {
    this.logger.log('provider is off — not sending');
    throw new Error('whatsapp channel not configured yet');
  }
}
