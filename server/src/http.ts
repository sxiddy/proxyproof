import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export type Role = 'student' | 'organiser' | 'admin';
export interface AuthUser { id: string; role: Role; name: string }

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status: number, code: string, message: string): never => {
  throw new HttpError(status, code, message);
};

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.');
    fail(400, 'invalid_input', field ? `${field}: ${issue.message}` : (issue?.message ?? 'Invalid input'));
  }
  return result.data!;
}

export function signToken(secret: string, user: AuthUser) {
  return jwt.sign({ sub: user.id, role: user.role, name: user.name }, secret, { expiresIn: '30d' });
}

export function readToken(secret: string, token: string): AuthUser | null {
  try {
    const p = jwt.verify(token, secret) as jwt.JwtPayload;
    return { id: String(p.sub), role: p.role, name: p.name };
  } catch {
    return null;
  }
}

export function requireAuth(secret: string, ...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const user = header.startsWith('Bearer ') ? readToken(secret, header.slice(7)) : null;
    if (!user) return next(new HttpError(401, 'unauthenticated', 'Please log in again.'));
    if (roles.length && !roles.includes(user.role)) {
      return next(new HttpError(403, 'forbidden', "Your account can't do that."));
    }
    req.user = user;
    next();
  };
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something broke on our side. Try again in a bit.' } });
}

export function csvCell(value: unknown) {
  const s = value == null ? '' : String(value);
  // Quote anything with separators, and defuse spreadsheet formula injection.
  const safe = typeof value !== 'number' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: unknown[][]) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
