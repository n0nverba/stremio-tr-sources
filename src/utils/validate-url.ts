import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast';
  } catch {
    return false;
  }
}
export function matchHost(pattern: string, hostname: string): boolean {
  const p = pattern.toLowerCase();
  const h = hostname.toLowerCase();
  if (p === '*' || p === h) return true;
  if (p.startsWith('*.')) {
    const domain = p.slice(2);
    return h === domain || h.endsWith('.' + domain);
  }
  return false;
}

export function validateUrl(raw: string, hosts: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INVALID_URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('INVALID_URL');
  if (url.port && !['80', '443'].includes(url.port))
    throw new Error('INVALID_PORT');
  const hostname = url.hostname.toLowerCase();
  if (!hosts.some((host) => matchHost(host, hostname)))
    throw new Error('HOST_NOT_ALLOWED');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.') ||
    hostname === 'metadata.google.internal'
  )
    throw new Error('PRIVATE_HOST');
  const literal = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(literal) && !isPublicAddress(literal))
    throw new Error('PRIVATE_ADDRESS');
  return url;
}
export async function resolvePublicHost(url: URL) {
  const records = await lookup(url.hostname.replace(/^\[|\]$/g, ''), {
    all: true,
    verbatim: true,
  });
  if (
    !records.length ||
    records.some((record) => !isPublicAddress(record.address))
  )
    throw new Error('PRIVATE_DNS_ADDRESS');
  return records[0]!;
}
export function effectiveExpiry(
  url: string,
  declared?: number,
): number | undefined {
  const parsed = new URL(url);
  const values: number[] = declared ? [declared] : [];
  // These are expiry hints only; no protected tokens are extracted or synthesized.
  for (const key of ['Expires', 'expires', 'exp']) {
    const raw = parsed.searchParams.get(key);
    if (raw && /^\d{9,13}$/.test(raw))
      values.push(Number(raw) * (raw.length <= 10 ? 1000 : 1));
  }
  const tokenParam = parsed.searchParams.get('token');
  if (tokenParam) {
    try {
      const decoded = JSON.parse(
        Buffer.from(tokenParam, 'base64').toString('utf8'),
      ) as { exp?: number; expires?: number };
      const tokenExp = decoded.exp ?? decoded.expires;
      if (typeof tokenExp === 'number') {
        values.push(tokenExp * (tokenExp < 1e11 ? 1000 : 1));
      }
    } catch {
      // Not a base64 JSON token
    }
  }
  const awsDate = parsed.searchParams.get('X-Amz-Date');
  const awsDuration = parsed.searchParams.get('X-Amz-Expires');
  if (
    awsDate &&
    awsDuration &&
    /^\d{8}T\d{6}Z$/.test(awsDate) &&
    /^\d+$/.test(awsDuration)
  ) {
    const date = Date.parse(
      awsDate.replace(
        /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
        '$1-$2-$3T$4:$5:$6Z',
      ),
    );
    if (Number.isFinite(date)) values.push(date + Number(awsDuration) * 1000);
  }
  const signed = [...parsed.searchParams.keys()].some((key) =>
    /token|signature|policy|key-pair-id/i.test(key),
  );
  // Unknown signed-link lifetime is rejected until the provider declares an expiry.
  return values.length ? Math.min(...values) : signed ? Date.now() : undefined;
}
