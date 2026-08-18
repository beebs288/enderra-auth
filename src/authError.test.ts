import { describe, it, expect } from 'vitest';
import { friendlyAuthError } from './authError';

describe('friendlyAuthError', () => {
  it('returns null for no error', () => {
    expect(friendlyAuthError(null)).toBeNull();
  });
  it('maps invalid credentials to friendly copy', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe(
      'That email or password is not right.',
    );
  });
  it('maps an already-registered signup to friendly copy', () => {
    expect(friendlyAuthError('User already registered')).toBe(
      'That email already has an Enderra account — try signing in.',
    );
  });
  it('passes through an unrecognized message unchanged', () => {
    expect(friendlyAuthError('Network request failed')).toBe('Network request failed');
  });
});
