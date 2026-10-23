import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMessage, EmailProvider } from './email-provider.interface';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly apiKey: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('RESEND_API_KEY');
    this.from = config.getOrThrow<string>('EMAIL_FROM');
  }

  async send(message: EmailMessage): Promise<{ id?: string }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const parsed = (await res.json()) as { id?: string };
    return { id: parsed.id };
  }
}
