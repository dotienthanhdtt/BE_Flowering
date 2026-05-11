import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from './common';
import { ObjectStorageService } from './database/object-storage.service';

/**
 * Public passthrough for static assets stored in the (private) object-storage
 * bucket — e.g. language flags and scenario images. Streams the object so the
 * bucket itself can stay private.
 */
@ApiExcludeController()
@Controller('assets')
export class AssetsController {
  constructor(private readonly storage: ObjectStorageService) {}

  @Get('*path')
  @Public()
  async serve(@Param('path') path: string | string[], @Res() res: Response): Promise<void> {
    const raw = Array.isArray(path) ? path.join('/') : path;
    const key = decodeURIComponent(raw || '').replace(/^\/+/, '');
    if (!key || key.includes('..')) {
      throw new NotFoundException('Asset not found');
    }

    let obj: Awaited<ReturnType<ObjectStorageService['getObject']>>;
    try {
      obj = await this.storage.getObject(key);
    } catch {
      throw new NotFoundException('Asset not found');
    }

    res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
    if (obj.contentLength) res.setHeader('Content-Length', obj.contentLength);
    res.setHeader('Cache-Control', obj.cacheControl || 'public, max-age=86400');
    obj.body.on('error', () => {
      if (!res.headersSent) res.status(404).end();
      else res.destroy();
    });
    obj.body.pipe(res);
  }
}
