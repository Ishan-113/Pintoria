export interface WhatsAppMessage {
  to: string;
  text: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(message: WhatsAppMessage): Promise<{ id?: string }>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
