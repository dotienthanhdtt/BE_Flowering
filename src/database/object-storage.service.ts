import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (Railway bucket). Bucket MUST be private — reads
 * go through short-lived presigned URLs. Degrades gracefully if not configured:
 * the app still boots, but storage operations throw ServiceUnavailable.
 */
@Injectable()
export class ObjectStorageService {
  private readonly logger = new Logger(ObjectStorageService.name);
  private readonly client?: S3Client;
  private readonly bucket?: string;

  constructor(configService: ConfigService) {
    const endpoint = configService.get<string>('storage.endpoint');
    const bucket = configService.get<string>('storage.bucket');
    const accessKeyId = configService.get<string>('storage.accessKeyId');
    const secretAccessKey = configService.get<string>('storage.secretAccessKey');
    const region = configService.get<string>('storage.region') || 'auto';

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'Object storage not configured (STORAGE_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY) — storage operations will fail until set',
      );
      return;
    }

    this.bucket = bucket;
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private ensureReady(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
    return { client: this.client, bucket: this.bucket };
  }

  async uploadAudio(
    file: Buffer,
    userId: string,
    fileName: string,
  ): Promise<{ path: string; signedUrl: string }> {
    const path = `${userId}/audio/${Date.now()}-${fileName}`;
    return this.uploadAudioAtPath(file, path);
  }

  // Upload to a caller-chosen key so the key can be returned/stored before the
  // upload promise resolves (e.g. when racing an upload against a timeout).
  async uploadAudioAtPath(
    file: Buffer,
    path: string,
    contentType = 'audio/mpeg',
  ): Promise<{ path: string; signedUrl: string }> {
    const { client, bucket } = this.ensureReady();
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: path, Body: file, ContentType: contentType }),
    );
    const signedUrl = await this.getSignedUrl(path, 3600);
    return { path, signedUrl };
  }

  async getObject(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
    cacheControl?: string;
  }> {
    const { client, bucket } = this.ensureReady();
    const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return {
      body: r.Body as Readable,
      contentType: r.ContentType,
      contentLength: r.ContentLength,
      cacheControl: r.CacheControl,
    };
  }

  async getSignedUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const { client, bucket } = this.ensureReady();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: filePath }), {
      expiresIn,
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    const { client, bucket } = this.ensureReady();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filePath }));
  }

  async listUserFiles(userId: string): Promise<string[]> {
    const { client, bucket } = this.ensureReady();
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: `${userId}/audio` }),
    );
    return (result.Contents ?? []).map((obj) => obj.Key ?? '').filter(Boolean);
  }
}
