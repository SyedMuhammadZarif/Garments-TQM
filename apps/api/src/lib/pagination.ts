import { AppError } from './errors.js';

// Cursor = base64url("<sortValue>|<uuid>") (SPEC §9.5). Lists fetch limit + 1 rows to know if more exist.
export function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { sortValue: string; id: string } {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = raw.lastIndexOf('|');
  const id = raw.slice(sep + 1);
  if (sep < 0 || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  return { sortValue: raw.slice(0, sep), id };
}

export function pageOf<T>(rows: T[], limit: number, cursorOf: (row: T) => string): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: cursorOf(items[items.length - 1]!) };
}
