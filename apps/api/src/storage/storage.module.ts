import { Module, Provider } from '@nestjs/common';
import { getValidatedEnv } from '../config/env.validation';
import { LocalDiskStorageService, R2StorageService } from './local-disk-storage.service';
import { STORAGE_PROVIDER } from './storage-provider';

const driverProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: (local: LocalDiskStorageService, r2: R2StorageService) => {
    const env = getValidatedEnv();
    return env.STORAGE_DRIVER === 'r2' ? r2 : local;
  },
  inject: [LocalDiskStorageService, R2StorageService],
};

@Module({
  providers: [LocalDiskStorageService, R2StorageService, driverProvider],
  exports: [STORAGE_PROVIDER, LocalDiskStorageService],
})
export class StorageModule {}

