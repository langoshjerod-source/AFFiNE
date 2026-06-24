import { Module } from '@nestjs/common';

import { DocStorageModule } from '../../core/doc';
import { PermissionModule } from '../../core/permission';
import { WllSyncController } from './controller';

@Module({
  imports: [DocStorageModule, PermissionModule],
  controllers: [WllSyncController],
})
export class WllSyncModule {}
