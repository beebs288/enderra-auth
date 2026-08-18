// auth/authError.ts — turn raw Supabase auth messages into field-friendly copy.
// Unknown messages pass through so we never swallow a real signal.
export function friendlyAuthError(raw: string | null): string | null {
  if (!raw) return null;
  const map: Record<string, string> = {
    'Invalid login credentials': 'That email or password is not right.',
    'User already registered':
      'That email already has an Enderra account — try signing in.',
    'Email not confirmed': 'Check your email to confirm the account first.',
  };
  return map[raw] ?? raw;
}
