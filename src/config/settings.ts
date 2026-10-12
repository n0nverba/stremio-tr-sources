import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { env } from './env.js';
export const settingsSchema = z
  .object({
    providers: z.record(z.string().max(80), z.boolean()),
    language: z.enum([
      'all',
      'prefer-dub',
      'prefer-sub',
      'only-dub',
      'only-sub',
    ]),
    quality: z.enum(['highest', 'lowest']),
    providerTimeoutMs: z.number().int().min(100).max(30000),
    matchThreshold: z.number().min(0.8).max(1),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export class SettingsStore {
  private value: Settings = {
    providers: {},
    language: 'all',
    quality: 'highest',
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
    matchThreshold: env.MATCH_THRESHOLD,
  };
  private saving = Promise.resolve();
  constructor(private readonly file = 'data/settings.json') {}
  get(): Settings {
    return structuredClone(this.value);
  }
  async load() {
    try {
      this.value = settingsSchema.parse(
        JSON.parse(await readFile(this.file, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Invalid settings file');
    }
  }
  async save(input: unknown) {
    const next = settingsSchema.parse(input);
    const operation = this.saving.then(async () => {
      await mkdir('data', { recursive: true });
      await writeFile(
        `${this.file}.tmp`,
        JSON.stringify(next, null, 2),
        'utf8',
      );
      await rename(`${this.file}.tmp`, this.file);
      this.value = next;
    });
    this.saving = operation.catch(() => undefined);
    await operation;
  }
}
