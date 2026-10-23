import type { S3Client } from '@aws-sdk/client-s3';
import { R2StorageService } from '../../src/storage/r2-storage.service';

interface Captured {
  command: { input: Record<string, unknown> };
}

function fakeClient(result: { body?: Uint8Array }) {
  const captured: Captured[] = [];
  const sdk = {
    send: jest.fn(async (command: { input: Record<string, unknown> }) => {
      captured.push({ command });
      if (result.body !== undefined) {
        return {
          Body: { transformToByteArray: async () => result.body as Uint8Array },
        };
      }
      return {};
    }),
  } as unknown as S3Client;
  return { sdk, captured };
}

describe('R2 storage driver (S3 API)', () => {
  it('put uploads to the bucket and returns a sha256 checksum', async () => {
    const { sdk, captured } = fakeClient({});
    const r2 = new R2StorageService().withTestClient(sdk);
    const out = await r2.put(Buffer.from('printoria po pdf'), 'abc.pdf');

    expect(out.key).toBe('abc.pdf');
    expect(out.size).toBe(16); // "printoria po pdf".length
    expect(out.checksum).toHaveLength(64);
    expect(sdk.send).toHaveBeenCalledTimes(1);
    const input = captured[0].command.input;
    expect(input.Bucket).toBe('test-bucket');
    expect(input.Key).toBe('abc.pdf');
  });

  it('get downloads the object body into a Buffer', async () => {
    const payload = new TextEncoder().encode('file bytes 123');
    const { sdk } = fakeClient({ body: payload });
    const r2 = new R2StorageService().withTestClient(sdk);

    const buf = await r2.get('abc.pdf');
    expect(buf.toString()).toBe('file bytes 123');
  });

  it('get surfaces a readable failure when the object is missing', async () => {
    const { sdk } = fakeClient({});
    (sdk.send as unknown as jest.Mock).mockRejectedValueOnce(new Error('NoSuchKey'));
    const r2 = new R2StorageService().withTestClient(sdk);
    await expect(r2.get('missing.pdf')).rejects.toThrow();
  });

  it('remove deletes the key and is idempotent on failure-skips', async () => {
    const { sdk, captured } = fakeClient({});
    const r2 = new R2StorageService().withTestClient(sdk);
    await r2.remove('abc.pdf');
    expect(captured[0].command.input.Key).toBe('abc.pdf');
  });
});
