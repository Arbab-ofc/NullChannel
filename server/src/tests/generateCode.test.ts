import { describe, expect, it } from 'vitest';
import { generateCode } from '../utils/generateCode.js';

describe('generateCode', () => {
  it('returns 8-char uppercase code', () => {
    const code = generateCode();
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
  });
});
