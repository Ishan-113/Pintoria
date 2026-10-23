import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getValidatedEnv } from '../config/env.validation';
import type { StorageProvider, StoragePutResult } from './storage-provider';

/**
 * Dev/post-local driver: files land under apps/api/data/uploads (git-ignored).
 * Keys are `<uuid>.<ext>` — never user-shaped — so the resolved path can never
 * escape the storage root.
 */
@Injectable()
export class LocalDiskStorageService implements StorageProvider {
  private root?: string;

  private async ensureRoot(): Promise<string> {
    if (!this.root) {
      const env = getValidatedEnv();
      this.root = resolve(env.STORAGE_LOCAL_PATH ?? join(process.cwd(), 'data', 'uploads'));
      await mkdir(this.root, { recursive: true });
    }
    return this.root;
  }

  private safePath(key: string): Promise<string> {
    return this.ensureRoot().then((root) => {
      if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,8})?$/i.test(key)) {
        throw new ServiceUnavailableException('Malformed storage key.');
      }
      return join(root, key);
    });
  }

  async put(buffer: Buffer, key: string): Promise<StoragePutResult> {
    const path = await this.safePath(key);
    await writeFile(path, buffer);
    return {
      key,
      size: buffer.byteLength,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  static newKey(extension: string): string {
    const ext = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8);
    return `${randomUUID()}${ext ? `.${ext}` : ''}`;
  }

  async get(key: string): Promise<Buffer> {
    const path = await this.safePath(key);
    try {
      return await readFile(path);
    } catch {
      throw new ServiceUnavailableException('Stored file is missing on disk.');
    }
  }

  async remove(key: string): Promise<void> {
    const path = await this.safePath(key);
    try {
      await unlink(path);
    } catch {
      // already gone — removal stays idempotent
    }
  }
}

