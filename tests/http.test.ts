import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from 'undici';
import { lookup } from 'node:dns/promises';
import { safeHttp } from '../src/utils/safe-http.js';
const tracking = vi.hoisted(() => ({
  agents: [] as {
    connect: {
      lookup: (
        hostname: string,
        options: object,
        callback: (error: null, address: string, family: number) => void,
      ) => void;
    };
    destroy: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('undici', () => ({
  request: vi.fn(),
  Agent: class {
    destroy = vi.fn(async () => undefined);
    constructor(
      readonly options: {
        connect: (typeof tracking.agents)[number]['connect'];
      },
    ) {
      tracking.agents.push({ connect: options.connect, destroy: this.destroy });
    }
  },
}));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const response = (
  statusCode = 200,
  headers = {},
  data = Buffer.from('ok'),
) => ({ statusCode, headers, body: Readable.from([data]) });
beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(lookup).mockReset();
  tracking.agents.length = 0;
  vi.mocked(lookup).mockImplementation(
    async () => [{ address: '8.8.8.8', family: 4 }] as never,
  );
});
describe('safe HTTP transport', () => {
  it('uses a pinned verified DNS address and releases its dispatcher', async () => {
    vi.mocked(request).mockResolvedValue(response() as never);
    await safeHttp('https://pinned.example/file.mp4', ['pinned.example'], {
      minIntervalMs: 0,
    });
    const callback = vi.fn();
    tracking.agents[0]!.connect.lookup('pinned.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(tracking.agents[0]!.destroy).toHaveBeenCalled();
  });
  it('rejects a redirect before contacting an unconfigured host', async () => {
    vi.mocked(request).mockResolvedValueOnce(
      response(302, { location: 'http://127.0.0.1/private' }) as never,
    );
    await expect(
      safeHttp('https://redirect.example/video.mp4', ['redirect.example'], {
        minIntervalMs: 0,
      }),
    ).rejects.toThrow('HOST_NOT_ALLOWED');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('revalidates an allowed redirect and DNS at each hop', async () => {
    vi.mocked(request)
      .mockResolvedValueOnce(
        response(302, { location: 'https://cdn.example/video.mp4' }) as never,
      )
      .mockResolvedValueOnce(response() as never);
    const result = await safeHttp(
      'https://source.example/video.mp4',
      ['source.example', 'cdn.example'],
      { minIntervalMs: 0 },
    );
    expect(result.url).toBe('https://cdn.example/video.mp4');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('rejects an oversized catalog body', async () => {
    vi.mocked(request).mockResolvedValueOnce(
      response(200, {}, Buffer.alloc(20)) as never,
    );
    await expect(
      safeHttp('https://size.example/catalog', ['size.example'], {
        maxBytes: 10,
        minIntervalMs: 0,
      }),
    ).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('bounds a range fallback when the server ignores Range', async () => {
    vi.mocked(request).mockResolvedValueOnce(
      response(200, {}, Buffer.alloc(10000)) as never,
    );
    expect(
      (
        await safeHttp('https://range.example/video.mp4', ['range.example'], {
          maxBytes: 512,
          truncate: true,
          range: 'bytes=0-511',
          minIntervalMs: 0,
        })
      ).body.length,
    ).toBe(512);
  });
  it('rejects private DNS before creating a socket', async () => {
    vi.mocked(lookup).mockImplementationOnce(
      async () => [{ address: '10.0.0.1', family: 4 }] as never,
    );
    await expect(
      safeHttp(
        'https://private-dns.example/video.mp4',
        ['private-dns.example'],
        { minIntervalMs: 0 },
      ),
    ).rejects.toThrow('PRIVATE_DNS');
    expect(request).not.toHaveBeenCalled();
  });
});
