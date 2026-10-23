import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { LogOnlyEmailProvider } from './log-only.provider';
import type { EmailMessage, EmailProvider } from './email-provider.interface';

@Injectable()
export class MailService {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  readonly dev: { lastMail(): (EmailMessage & { sentAt: Date }) | undefined } = {
    lastMail: () => (this.provider instanceof LogOnlyEmailProvider ? this.provider.last() : undefined),
  };

  send(message: EmailMessage): Promise<{ id?: string }> {
    return this.provider.send(message);
  }

  async sendPasswordReset(to: string, fullName: string, link: string): Promise<void> {
    const subject = 'Reset your Printoria password';
    const text = [
      `Hi ${fullName},`,
      '',
      'We received a request to reset your Printoria portal password.',
      'Open this link within 1 hour to choose a new password:',
      link,
      '',
      "If you didn't request this, you can safely ignore this email — your current password keeps working.",
      '',
      '— Printoria International Pvt Ltd',
    ].join('\n');
    const html = [
      `<p>Hi ${escapeHtml(fullName)},</p>`,
      '<p>We received a request to reset your Printoria portal password.</p>',
      `<p><a href="${link}">Choose a new password</a> (valid for 1 hour)</p>`,
      "<p>If you didn't request this, you can safely ignore this email.</p>",
      '<p>— Printoria International Pvt Ltd</p>',
    ].join('\n');
    await this.send({ to, subject, text, html });
  }

  async sendInvitation(to: string, fullName: string, clientName: string, link: string): Promise<void> {
    const subject = 'Set up your Printoria portal account';
    const text = [
      `Hi ${fullName},`,
      '',
      `You have been invited to the Printoria portal${clientName ? ` for ${clientName}` : ''}.`,
      'Open this link within the next 48 hours to set your password:',
      link,
      '',
      '— Printoria International Pvt Ltd',
    ].join('\n');
    const html = [
      `<p>Hi ${escapeHtml(fullName)},</p>`,
      `<p>You have been invited to the Printoria portal${clientName ? ` for <strong>${escapeHtml(clientName)}</strong>` : ''}.</p>`,
      `<p><a href="${link}">Set your password</a> (valid for 48 hours)</p>`,
      '<p>— Printoria International Pvt Ltd</p>',
    ].join('\n');
    await this.send({ to, subject, text, html });
  }

  async sendPasswordChanged(to: string, fullName: string): Promise<void> {
    await this.send({
      to,
      subject: 'Your Printoria password was changed',
      text: `Hi ${fullName},\n\nYour Printoria portal password was just changed. If this wasn't you, contact Printoria immediately.\n`,
      html: `<p>Hi ${escapeHtml(fullName)},</p><p>Your Printoria portal password was just changed. If this wasn't you, contact Printoria immediately.</p>`,
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
