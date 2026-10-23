import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppMessage, WhatsAppProvider } from './whatsapp-provider.interface';

/** Mock gateway (checkpoint 2c): logs the message instead of calling a real
 *  WhatsApp Business API. The feed shows SENT so the whole flow is testable
 *  end-to-end; swapping in a real provider is a new file + env value. */
@Injectable()
export class LogOnlyWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'log';
  private readonly logger = new Logger('whatsapp');

  async send(message: WhatsAppMessage): Promise<{ id?: string }> {
    this.logger.log(`to=${message.to} text="${message.text.slice(0, 140)}"`);
    return { id: `mock-${Date.now()}` };
  }
}
