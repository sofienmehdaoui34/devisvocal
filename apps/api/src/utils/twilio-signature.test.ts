import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { validateTwilioSignature } from './twilio-signature.js';

function sign(token: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

describe('validateTwilioSignature', () => {
  const token = 'auth-token-secret';
  const url = 'https://api.example.com/webhook/whatsapp';
  const params = { Body: 'Bonjour', From: 'whatsapp:+41790000000' };

  it('valide une signature correcte', () => {
    const signature = sign(token, url, params);
    expect(validateTwilioSignature(token, signature, url, params)).toBe(true);
  });

  it('rejette une signature incorrecte', () => {
    expect(validateTwilioSignature(token, 'signature-bidon', url, params)).toBe(false);
  });

  it('rejette une signature absente', () => {
    expect(validateTwilioSignature(token, undefined, url, params)).toBe(false);
  });

  it('rejette si un paramètre a été altéré', () => {
    const signature = sign(token, url, params);
    expect(validateTwilioSignature(token, signature, url, { ...params, Body: 'Modifié' })).toBe(false);
  });
});
