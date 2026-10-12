import { describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import {
  validateUrl,
  isPublicAddress,
  resolvePublicHost,
  effectiveExpiry,
} from '../src/utils/validate-url.js';
import { parseEnv } from '../src/config/env.js';
import { withTimeout } from '../src/utils/timeout.js';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
describe('outbound URL security', () => {
  it('allows a configured HTTP(S) hostname', () =>
    expect(
      validateUrl('https://media.example/video.mp4', ['media.example'])
        .hostname,
    ).toBe('media.example'));
  it.each([
    'http://127.0.0.1/a.mp4',
    'http://2130706433/a.mp4',
    'http://0x7f000001/a.mp4',
    'http://10.0.0.1/a.mp4',
    'http://169.254.169.254/a.mp4',
    'http://[::1]/a.mp4',
    'http://[::ffff:127.0.0.1]/a.mp4',
    'http://localhost/a.mp4',
    'file:///etc/passwd',
    'https://media.example.evil/video.mp4',
    'https://user:secret@media.example/video.mp4',
    'https://media.example:8080/video.mp4',
  ])('blocks %s', (url) => {
    expect(() =>
      validateUrl(url, [
        'media.example',
        '127.0.0.1',
        '10.0.0.1',
        '169.254.169.254',
        '[::1]',
        '[::ffff:7f00:1]',
        'localhost',
      ]),
    ).toThrow();
  });
  it.each([
    '127.0.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '169.254.1.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:10.0.0.1',
    '224.0.0.1',
  ])('rejects nonpublic IP %s', (ip) =>
    expect(isPublicAddress(ip)).toBe(false),
  );
  it('accepts a public IP', () =>
    expect(isPublicAddress('8.8.8.8')).toBe(true));
  it('blocks mixed public/private DNS answers', async () => {
    vi.mocked(lookup).mockImplementationOnce(
      async () =>
        [
          { address: '8.8.8.8', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ] as never,
    );
    await expect(
      resolvePublicHost(new URL('https://media.example')),
    ).rejects.toThrow('PRIVATE_DNS');
  });
  it('pins a public DNS record', async () => {
    vi.mocked(lookup).mockImplementationOnce(
      async () => [{ address: '8.8.8.8', family: 4 }] as never,
    );
    expect(await resolvePublicHost(new URL('https://media.example'))).toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });
  it('reads explicit expiry conservatively', () =>
    expect(
      effectiveExpiry(
        'https://media.example/a.mp4?Expires=1700000000',
        1800000000000,
      ),
    ).toBe(1700000000000));
  it('validates environment and local bind address', () => {
    expect(parseEnv({}).PORT).toBe(7000);
    expect(() => parseEnv({ HOST: '0.0.0.0' })).toThrow();
    expect(() => parseEnv({ PROVIDER_TIMEOUT_MS: -1 })).toThrow();
  });
  it('aborts hung work within its deadline', async () => {
    let signal: AbortSignal | undefined;
    await expect(
      withTimeout(async (s) => {
        signal = s;
        return new Promise(() => undefined);
      }, 20),
    ).rejects.toThrow('TIMEOUT');
    expect(signal?.aborted).toBe(true);
  });
});
