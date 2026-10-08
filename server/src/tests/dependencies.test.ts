import { describe, expect, it } from 'vitest';
import ImageKit from 'imagekit';
describe('ImageKit compatibility with patched UUID dependency', () => {
  it('constructs the existing SDK and generates authentication parameters locally', () => {
    const sdk = new ImageKit({ publicKey: 'test-public', privateKey: 'test-private', urlEndpoint: 'https://test.invalid' });
    const auth = sdk.getAuthenticationParameters();
    expect(auth.token).toMatch(/^[0-9a-f-]{36}$/); expect(auth.signature).toMatch(/^[0-9a-f]+$/);
    expect(auth.expire).toBeGreaterThan(Date.now()/1000);
  });
});
