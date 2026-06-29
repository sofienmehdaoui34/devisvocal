import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../services/supabase.js';
import { safeError } from '../utils/errors.js';

export interface AuthUser {
  id: string;
  email?: string;
}

// Requête authentifiée : `authUser` est renseigné par `requireAuth`.
export interface AuthedRequest extends Request {
  authUser?: AuthUser;
}

/**
 * Vérifie le JWT Supabase passé en `Authorization: Bearer <token>`.
 * On valide le token côté Supabase (`auth.getUser`) plutôt que de manipuler le
 * secret JWT — simple et robuste, réutilise le client service existant.
 * Renseigne `req.authUser` ou répond 401.
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'Session invalide ou expirée' });
      return;
    }
    req.authUser = { id: data.user.id, email: data.user.email ?? undefined };
    next();
  } catch (err) {
    console.error('[auth] vérification du token échouée:', safeError(err));
    res.status(401).json({ error: 'Session invalide' });
  }
}
