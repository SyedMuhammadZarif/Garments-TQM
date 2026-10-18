// Hand-written validators (SPEC §9.4). Small composable helpers; the same validators run in the API
// (validate middleware) and in web forms. Unknown object keys are stripped.

export type Issue = { path: string; code: string; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export type Validator<T> = {
  (input: unknown, path?: string): Result<T>;
  /** Marks validators whose key may be absent from an object. */
  readonly optional?: boolean;
};

export type Infer<V> = V extends Validator<infer T> ? T : never;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (path: string, code: string, message: string): Result<never> => ({
  ok: false,
  issues: [{ path, code, message }],
});

export function str(opts: { min?: number; max?: number; trim?: boolean; pattern?: RegExp } = {}): Validator<string> {
  const { min = 0, max = 10_000, trim = true, pattern } = opts;
  return (input, path = '') => {
    if (typeof input !== 'string') return fail(path, 'type', 'Must be text');
    const value = trim ? input.trim() : input;
    if (value.length < min) return fail(path, 'too_short', min === 1 ? 'Required' : `At least ${min} characters`);
    if (value.length > max) return fail(path, 'too_long', `At most ${max} characters`);
    if (pattern && !pattern.test(value)) return fail(path, 'pattern', 'Invalid format');
    return ok(value);
  };
}

export function num(opts: { min?: number; max?: number } = {}): Validator<number> {
  return (input, path = '') => {
    const value = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'type', 'Must be a number');
    if (opts.min !== undefined && value < opts.min) return fail(path, 'too_small', `Must be at least ${opts.min}`);
    if (opts.max !== undefined && value > opts.max) return fail(path, 'too_big', `Must be at most ${opts.max}`);
    return ok(value);
  };
}

export function int(opts: { min?: number; max?: number } = {}): Validator<number> {
  const base = num(opts);
  return (input, path = '') => {
    const r = base(input, path);
    if (r.ok && !Number.isInteger(r.value)) return fail(path, 'type', 'Must be a whole number');
    return r;
  };
}

export function bool(): Validator<boolean> {
  return (input, path = '') => {
    if (typeof input === 'boolean') return ok(input);
    if (input === 'true') return ok(true);
    if (input === 'false') return ok(false);
    return fail(path, 'type', 'Must be true or false');
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuid(): Validator<string> {
  return (input, path = '') =>
    typeof input === 'string' && UUID_RE.test(input) ? ok(input.toLowerCase()) : fail(path, 'uuid', 'Invalid id');
}

/** Calendar date `YYYY-MM-DD`. */
export function isoDate(): Validator<string> {
  return (input, path = '') => {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return fail(path, 'date', 'Invalid date');
    const d = new Date(`${input}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(input) ? ok(input) : fail(path, 'date', 'Invalid date');
  };
}

/** Full timestamp with timezone, normalised to ISO UTC. */
export function isoDateTime(): Validator<string> {
  return (input, path = '') => {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(input)) return fail(path, 'datetime', 'Invalid time');
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? fail(path, 'datetime', 'Invalid time') : ok(d.toISOString());
  };
}

/** Time of day `HH:MM` (24 h). */
export function timeOfDay(): Validator<string> {
  return (input, path = '') =>
    typeof input === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input) ? ok(input) : fail(path, 'time', 'Use HH:MM');
}

export function oneOf<const T extends readonly (string | number)[]>(values: T): Validator<T[number]> {
  return (input, path = '') =>
    (values as readonly unknown[]).includes(input)
      ? ok(input as T[number])
      : fail(path, 'one_of', `Must be one of: ${values.join(', ')}`);
}

export function arrayOf<T>(item: Validator<T>, opts: { min?: number; max?: number } = {}): Validator<T[]> {
  const { min = 0, max = 1000 } = opts;
  return (input, path = '') => {
    if (!Array.isArray(input)) return fail(path, 'type', 'Must be a list');
    if (input.length < min) return fail(path, 'too_short', `At least ${min} item(s)`);
    if (input.length > max) return fail(path, 'too_long', `At most ${max} items`);
    const out: T[] = [];
    const issues: Issue[] = [];
    input.forEach((v, i) => {
      const r = item(v, path ? `${path}.${i}` : String(i));
      if (r.ok) out.push(r.value);
      else issues.push(...r.issues);
    });
    return issues.length ? { ok: false, issues } : ok(out);
  };
}

export function optional<T>(v: Validator<T>): Validator<T | undefined> {
  const wrapped = ((input: unknown, path = '') =>
    input === undefined ? ok(undefined) : v(input, path)) as Validator<T | undefined>;
  return Object.assign(wrapped, { optional: true });
}

export function nullable<T>(v: Validator<T>): Validator<T | null> {
  return (input, path = '') => (input === null ? ok(null) : v(input, path));
}

type Shape = Record<string, Validator<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends { readonly optional: true } ? K : undefined extends Infer<S[K]> ? K : never;
}[keyof S];
type ObjectOf<S extends Shape> = {
  [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>;
} & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> };
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export function object<S extends Shape>(shape: S): Validator<Simplify<ObjectOf<S>>> {
  return (input, path = '') => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail(path, 'type', 'Must be an object');
    }
    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const issues: Issue[] = [];
    for (const [key, v] of Object.entries(shape)) {
      const r = v(source[key], path ? `${path}.${key}` : key);
      if (!r.ok) {
        // A missing required key reads better as "Required" than as a type error.
        if (source[key] === undefined) issues.push({ path: path ? `${path}.${key}` : key, code: 'required', message: 'Required' });
        else issues.push(...r.issues);
      } else if (r.value !== undefined) {
        out[key] = r.value;
      }
    }
    return issues.length ? { ok: false, issues } : ok(out as Simplify<ObjectOf<S>>);
  };
}

/** Adds a cross-field rule after the base validator passes. */
export function refine<T>(v: Validator<T>, check: (value: T) => Issue | null): Validator<T> {
  return (input, path = '') => {
    const r = v(input, path);
    if (!r.ok) return r;
    const issue = check(r.value);
    return issue ? { ok: false, issues: [issue] } : r;
  };
}

/** Validates or throws; for trusted internal data where failure is a bug. */
export function parse<T>(v: Validator<T>, input: unknown): T {
  const r = v(input);
  if (!r.ok) throw new Error(`Validation failed: ${r.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
  return r.value;
}
