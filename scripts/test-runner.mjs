import process from 'node:process';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const integration = args.includes('--integration');
const child = spawn(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    ...args.filter((arg) => arg !== '--integration'),
    ...(integration ? [] : ['--exclude', 'tests/integration.test.ts']),
  ],
  { stdio: 'inherit', windowsHide: true },
);
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
