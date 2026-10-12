import ts from 'typescript';
import process from 'node:process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { spawn } from 'node:child_process';
// Transpile for local development only; strict verification remains npm run typecheck.
const output = resolve('.cache/runtime');
async function compile(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await compile(file);
      continue;
    }
    if (!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
    const target = join(
      output,
      relative(process.cwd(), file).replace(/\.ts$/, '.js'),
    );
    const compiled = ts.transpileModule(await readFile(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2023,
        sourceMap: true,
        inlineSources: true,
      },
    });
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, compiled.outputText);
    if (compiled.sourceMapText)
      await writeFile(`${target}.map`, compiled.sourceMapText);
  }
}
await compile(resolve('src'));
await compile(resolve('scripts'));
const [entry, ...args] = process.argv.slice(2);
if (!entry || entry.includes('..'))
  throw new Error('Use a workspace TypeScript entry point');
const child = spawn(
  process.execPath,
  [join(output, entry.replace(/\.ts$/, '.js')), ...args],
  { stdio: 'inherit', env: process.env },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
