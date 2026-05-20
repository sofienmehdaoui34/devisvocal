import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const SECRET = process.env.JWT_SECRET!;

export function generateDevisToken(devisId: string): string {
  return jwt.sign(
    { devisId, jti: crypto.randomUUID() },
    SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyDevisToken(token: string): { devisId: string } | null {
  try {
    return jwt.verify(token, SECRET) as { devisId: string };
  } catch {
    return null;
  }
}
