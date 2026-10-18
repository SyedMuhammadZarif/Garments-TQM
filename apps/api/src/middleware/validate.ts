import type { RequestHandler } from 'express';
import type { Validator } from '@tqm/shared';
import { validationFailed } from '../lib/errors.js';

type Parts<B, Q, P> = { body?: Validator<B>; query?: Validator<Q>; params?: Validator<P> };

// Runs shared validators and replaces the request parts with the typed, stripped values (SPEC §9.4).
// Express 5 makes req.query a getter, so the parsed query is stored on res.locals.query instead.
export function validate<B = unknown, Q = unknown, P = unknown>(parts: Parts<B, Q, P>): RequestHandler {
  return (req, res, next) => {
    const issues = [];
    if (parts.params) {
      const r = parts.params(req.params);
      if (r.ok) req.params = r.value as typeof req.params;
      else issues.push(...r.issues);
    }
    if (parts.query) {
      const r = parts.query(req.query);
      if (r.ok) res.locals.query = r.value;
      else issues.push(...r.issues);
    }
    if (parts.body) {
      const r = parts.body(req.body ?? {});
      if (r.ok) req.body = r.value;
      else issues.push(...r.issues);
    }
    if (issues.length > 0) throw validationFailed(issues);
    next();
  };
}
