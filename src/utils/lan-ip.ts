import os from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config/env.js';

export function getLanIp(): string {
  if (process.env.NODE_ENV === 'test') {
    return '127.0.0.1';
  }
  if (process.env.PUBLIC_HOST) {
    return process.env.PUBLIC_HOST;
  }
  const interfaces = os.networkInterfaces();
  // 1. Try to find physical Wi-Fi or Ethernet IPv4 address (192.168.x.x, 10.x.x.x)
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254') &&
        !net.address.startsWith('10.15.')
      ) {
        return net.address;
      }
    }
  }
  // 2. Fallback to any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (
        net.family === 'IPv4' &&
        !net.internal &&
        !net.address.startsWith('169.254')
      ) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

export function getLanHost(): string {
  return `${getLanIp()}:${env.PORT}`;
}

export function getProxyBaseUrl(): string {
  if (process.env.NODE_ENV === 'test') {
    return `http://${getLanHost()}`;
  }
  try {
    const tunnelPath = resolve(process.cwd(), 'data', 'tunnel-url.txt');
    if (existsSync(tunnelPath)) {
      const content = readFileSync(tunnelPath, 'utf8').trim();
      if (content.startsWith('https://')) {
        return content.replace(/\/manifest\.json$/, '');
      }
    }
  } catch {}
  return `http://${getLanHost()}`;
}

