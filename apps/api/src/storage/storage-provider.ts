export interface StoragePutResult {
  key: string;
  size: number;
  checksum: string;
}

/**
 * S3-shaped storage contract. The dev driver writes to local disk; production
 * swaps in an R2/S3 implementation behind the same methods (keys are opaque
 * ids — callers must never derive paths from user input).
 */
export interface StorageProvider {
  put(buffer: Buffer, key: string): Promise<StoragePutResult>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
