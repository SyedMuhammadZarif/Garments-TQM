import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_ID = /^[A-Za-z0-9_.:-]{8,100}$/;

// Accepts an upstream id (nginx) when it looks safe, otherwise generates one. Echoed on every response.
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.ctx = { requestId: id, auth: null };
  res.setHeader('X-Request-Id', id);
  next();
};
