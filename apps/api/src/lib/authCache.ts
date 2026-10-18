import type { PermissionKey, UserScope } from '@tqm/shared';

// 30-second in-process cache of a user's permissions and scopes (SPEC §11). Invalidated explicitly when
// roles, role permissions or scopes change, so admins see effects immediately on this instance.
export type CachedSubject = {
  userId: string;
  username: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  permissions: ReadonlySet<PermissionKey>;
  scopes: readonly UserScope[];
  activeFamilies: Map<string, boolean>;
  loadedAt: number;
};

const TTL_MS = 30_000;
const cache = new Map<string, CachedSubject>();

export const authCache = {
  get(userId: string): CachedSubject | null {
    const hit = cache.get(userId);
    if (!hit || Date.now() - hit.loadedAt > TTL_MS) return null;
    return hit;
  },
  set(subject: CachedSubject): void {
    cache.set(subject.userId, subject);
  },
  invalidate(userId: string): void {
    cache.delete(userId);
  },
  /** Role permission changes affect many users at once. */
  clear(): void {
    cache.clear();
  },
};
