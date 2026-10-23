import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { getValidatedEnv } from '../config/env.validation';
import type { StorageProvider, StoragePutResult } from './storage-provider';

/**
 * Cloudflare R2 driver (S3-compatible API). Used when STORAGE_DRIVER=r2 —
 * staging/production file storage. The test story uses a fake client; the
 * 4 R2 env vars are validated at boot by env.validation.
 */
@Injectable()
export class R2StorageService implements StorageProvider {
  private cached?: S3Client;
  private bucket?: string;
  private testClient?: S3Client;

  /** Unit tests swap in a fake SDK client — not a Nest DI dependency. */
  withTestClient(sdk: S3Client): this {
    this.testClient = sdk;
    return this;
  }

  private async client(): Promise<{ sdk: S3Client; bucket: string }> {
    if (this.testClient) {
      return { sdk: this.testClient, bucket: (this.bucket ??= 'test-bucket') };
    }
    if (!this.cached) {
      const env = getValidatedEnv();
      this.cached = new S3Client({
        region: 'auto',
        endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID as string,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY as string,
        },
      });
      this.bucket = env.R2_BUCKET as string;
    }
    return { sdk: this.cached, bucket: this.bucket as string };
  }

  async put(buffer: Buffer, key: string): Promise<StoragePutResult> {
    const { sdk, bucket } = await this.client();
    try {
      await sdk.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer }));
    } catch (err) {
      throw new ServiceUnavailableException(`Cloud storage put failed: ${String(err).slice(0, 120)}`);
    }
    return {
      key,
      size: buffer.byteLength,
      checksum: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    const { sdk, bucket } = await this.client();
    try {
      const res = await sdk.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await res.Body!.transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      throw new ServiceUnavailableException('Stored file is missing in cloud storage.');
    }
  }

  async remove(key: string): Promise<void> {
    const { sdk, bucket } = await this.client();
    try {
      await sdk.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      // already gone — removal stays idempotent
    }
  }
}
