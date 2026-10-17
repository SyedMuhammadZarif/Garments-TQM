import en from './en.json';

// English only for now (SPEC 1.1). All UI text still goes through translate()/t() so another
// language can be added later as a new catalog. Milestone 1 adds useT() with interpolation and plurals.
export type MessageKey = keyof typeof en;

export function translate(key: MessageKey): string {
  return en[key];
}
