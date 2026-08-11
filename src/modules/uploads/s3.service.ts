import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    this.bucket = this.config.get<string>('aws.bucket')!;
    this.client = new S3Client({
      region: this.config.get<string>('aws.region'),
      credentials: {
        accessKeyId: this.config.get<string>('aws.accessKeyId')!,
        secretAccessKey: this.config.get<string>('aws.secretAccessKey')!,
      },
    });
  }

  /**
   * Returns a short-lived presigned PUT URL so the browser/admin panel can
   * upload the file directly to S3 without the file ever passing through
   * this API (matches the Upload -> S3 -> store URL flow from the spec).
   */
  async getPresignedUploadUrl(fileName: string, contentType: string, folder = 'uploads') {
    const key = `${folder}/${uuidv4()}-${fileName.replace(/\s+/g, '-')}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 300 });
    const publicUrl = `https://${this.bucket}.s3.${this.config.get('aws.region')}.amazonaws.com/${key}`;
    return { uploadUrl, key, publicUrl };
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      this.logger.error(`Failed to delete S3 object ${key}: ${(error as Error).message}`);
    }
  }
}
