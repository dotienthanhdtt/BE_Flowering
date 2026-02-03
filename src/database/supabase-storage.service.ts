import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseStorageService {
  private supabase: SupabaseClient;
  private readonly bucketName = 'audio-files';

  constructor(private configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('database.supabaseUrl');
    const supabaseServiceKey = this.configService.get<string>('database.supabaseServiceRoleKey');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase URL and Service Role Key are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async uploadAudio(
    file: Buffer,
    userId: string,
    fileName: string,
  ): Promise<{ path: string; publicUrl: string }> {
    const filePath = `${userId}/audio/${Date.now()}-${fileName}`;

    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .upload(filePath, file, {
        contentType: 'audio/mpeg',
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload audio: ${error.message}`);
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(this.bucketName).getPublicUrl(data.path);

    return { path: data.path, publicUrl };
  }

  async getSignedUrl(filePath: string, expiresIn = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .createSignedUrl(filePath, expiresIn);

    if (error) {
      throw new Error(`Failed to create signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async deleteFile(filePath: string): Promise<void> {
    const { error } = await this.supabase.storage.from(this.bucketName).remove([filePath]);

    if (error) {
      throw new Error(`Failed to delete file: ${error.message}`);
    }
  }

  async listUserFiles(userId: string): Promise<string[]> {
    const { data, error } = await this.supabase.storage
      .from(this.bucketName)
      .list(`${userId}/audio`);

    if (error) {
      throw new Error(`Failed to list files: ${error.message}`);
    }

    return data.map((file) => `${userId}/audio/${file.name}`);
  }
}
