// SPEC §11: min 8 chars, at least 1 letter + 1 digit, max well above 64.
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters`;
  if (password.length > PASSWORD_MAX) return `At most ${PASSWORD_MAX} characters`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one digit';
  return null;
}
