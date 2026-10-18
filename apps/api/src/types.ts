import type { PermissionKey, UserScope } from '@tqm/shared';

export type AuthContext = {
  userId: string;
  username: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  /** Refresh-token family (JWT `sid`). */
  sessionId: string;
  permissions: ReadonlySet<PermissionKey>;
  scopes: readonly UserScope[];
};

export type RequestContext = { requestId: string; auth: AuthContext | null };

declare module 'express-serve-static-core' {
  interface Request {
    ctx: RequestContext;
  }
}
