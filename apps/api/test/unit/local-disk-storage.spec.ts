import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEnv } from '../../src/config/env.validation';
import { LocalDiskStorageService } from '../../src/storage/local-disk-storage.service';

describe('LocalDiskStorageService', () => {
  let dir: string;
  let service: LocalDiskStorageService;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pintoria-storage-'));
    // unit scope: validate a minimal env and point storage at the temp dir
    validateEnv({
      DATABASE_URL: 'postgres://pintoria:pintoria@localhost:5432/pintoria_test',
      STORAGE_LOCAL_PATH: dir,
    });
    service = new LocalDiskStorageService();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and returns a sha256 checksum', async () => {
    const key = LocalDiskStorageService.newKey('pdf');
    expect(key).toMatch(/^[a-f0-9-]{36}\.pdf$/);

    const stored = await service.put(Buffer.from('hello pintoria'), key);
    expect(stored.size).toBe(14);
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);

    const bytes = await service.get(stored.key);
    expect(bytes.toString()).toBe('hello pintoria');
  });

  it('rejects malformed keys outright (path-traversal proof)', async () => {
    await expect(service.put(Buffer.alloc(4), '../escape.exe')).rejects.toBeTruthy();
    await expect(service.get('bad key with spaces and slashes/ohmy')).rejects.toBeTruthy();
  });

  it('remove is idempotent for missing files', async () => {
    await expect(service.remove('00000000-0000-4000-8000-000000000000.pdf')).resolves.toBeUndefined();
  });
});
