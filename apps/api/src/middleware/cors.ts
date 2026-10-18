import type { RequestHandler } from 'express';

// Production is same-origin behind nginx, so no CORS headers at all. In development only the Vite origin
// is allowed (SPEC §11); Vite normally proxies /api, so this matters only when calling the API directly.
export function cors(devOrigin: string | null): RequestHandler {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (devOrigin && origin === devOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, Idempotent-Replay');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  };
}
