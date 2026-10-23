import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email-provider.interface';

export interface CapturedEmail extends EmailMessage {
  sentAt: Date;
}

/** Development/test transport: logs the mail and keeps the recent ones in memory
 *  so tests can capture password-reset / invitation links. */
@Injectable()
export class LogOnlyEmailProvider implements EmailProvider {
  readonly name = 'log';
  private readonly logger = new Logger('mail');
  private readonly sent: CapturedEmail[] = [];

  async send(message: EmailMessage): Promise<{ id?: string }> {
    const captured = { ...message, sentAt: new Date() };
    this.sent.push(captured);
    if (this.sent.length > 100) this.sent.shift();
    this.logger.log(`to=${message.to} subject="${message.subject}" text="${message.text.slice(0, 120)}"`);
    return { id: `log-${Date.now()}` };
  }

  last(): CapturedEmail | undefined {
    return this.sent[this.sent.length - 1];
  }

  all(): CapturedEmail[] {
    return [...this.sent];
  }
}
