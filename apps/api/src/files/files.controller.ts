import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import type { SessionUser } from '../auth/auth.types';
import { FilesService } from './files.service';
import type { FileEntityType, FileKind } from './dto/files.dto';

/**
 * Artifacts: upload once, then every download re-checks tenancy and the
 * regional "no PO paperwork" rule server-side.
 */
@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Multipart upload; entity routing fields arrive as form fields. */
  @Permissions('order.view')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { files: 1, fields: 100 },
    }),
  )
  upload(
    @CurrentUser() user: SessionUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, string | undefined>,
  ) {
    return this.files.upload(user, file, {
      entityType: (body.entityType ?? '') as FileEntityType,
      entityId: body.entityId,
      kind: (body.kind ?? '') as FileKind,
      description: body.description,
    });
  }

  @Permissions('order.view')
  @Get('orders/:orderId')
  listForOrder(@CurrentUser() user: SessionUser, @Param('orderId') orderId: string) {
    return this.files.listForOrder(user, orderId);
  }

  @Permissions('order.view')
  @Get(':id/download')
  async download(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { file, bytes } = await this.files.download(user, id);
    res.setHeader('Content-Type', file.mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.originalName.replace(/["\\]/g, '_')}"`,
    );
    res.send(bytes);
  }
}
