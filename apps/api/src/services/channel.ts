// ─── Interface canal d'envoi (Telegram / WhatsApp / ...) ─────────────────────

export interface Channel {
  sendText(to: string, text: string): Promise<void>;
  sendDocument(to: string, url: string, filename: string, caption?: string): Promise<void>;
  getMediaUrl(fileIdOrUrl: string): Promise<string>;
}
