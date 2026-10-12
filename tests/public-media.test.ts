import { describe, it, expect } from 'vitest';
import {
  publicMediaReferences,
  publicPageSnapshot,
  auditPlayerHtml,
} from '../src/utils/public-media.js';

describe('plain public media inspection', () => {
  it('inspects script structure and iframe parameter names without secret values', () => {
    const report = auditPlayerHtml(
      '<script>eval(atob("SECRET")); fetch("/api");</script><iframe src="/player?v=VIDEO_ID&amp;token=SECRET"></iframe>',
      'https://site.example/',
    );
    expect(report).toMatchObject({
      usesEval: true,
      usesBase64: true,
      usesFetch: true,
      iframeStructure: [{ queryKeys: ['v', 'token'] }],
    });
    expect(JSON.stringify(report)).not.toContain('SECRET');
    expect(JSON.stringify(report)).not.toContain('VIDEO_ID');
  });
  it('distinguishes playable files from iframe documents', () => {
    expect(
      publicMediaReferences(
        '<video src="https://cdn.example/a.mp4"></video><source src="/video.m3u8"><iframe src="https://embed.example/e/123"></iframe>',
        'https://site.example/episode',
        ['site.example', 'cdn.example', 'embed.example'],
      ),
    ).toEqual({
      media: [
        { url: 'https://cdn.example/a.mp4', format: 'MP4' },
        { url: 'https://site.example/video.m3u8', format: 'HLS' },
      ],
      embeds: ['https://embed.example/e/123'],
    });
  });
  it('does not extract script, signed, private or unconfigured addresses', () => {
    const html =
      '<script>const file="https://cdn.example/a.mp4";</script><video src="https://cdn.example/a.mp4?token=secret"><iframe src="http://127.0.0.1/e"><source src="https://unknown.example/a.mp4">';
    expect(
      publicMediaReferences(html, 'https://site.example/', [
        'site.example',
        'cdn.example',
      ]),
    ).toEqual({ media: [], embeds: [] });
  });
  it('removes scripts, forms, event handlers and query credentials from snapshots', () => {
    const html =
      '<script>secret</script><form><input value="secret"></form><a onclick="secret" href="/public">Title</a><iframe src="/e?token=secret"></iframe>';
    const snapshot = publicPageSnapshot(html);
    expect(snapshot).not.toContain('secret');
    expect(snapshot).toContain('href="/public"');
  });
});
