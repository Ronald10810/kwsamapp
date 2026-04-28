import { Storage } from '@google-cloud/storage';
import crypto from 'crypto';
import path from 'path';
import { env } from '../config/env.js';

let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage({ projectId: env.gcp.projectId ?? undefined });
  }
  return storageClient;
}

export interface GcsUploadResult {
  publicUrl: string;
  objectName: string;
}

/**
 * Uploads a buffer to GCS and returns the public URL.
 * Requires GCS_BUCKET_NAME and GOOGLE_CLOUD_PROJECT to be set.
 */
export async function uploadToGcs(
  buffer: Buffer,
  originalFilename: string,
  prefix: string,
  mimeType: string
): Promise<GcsUploadResult> {
  const bucketName = env.gcp.uploadsBucket;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured. Set the GCS_BUCKET_NAME environment variable.');
  }

  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const ext = path.extname(originalFilename);
  const baseName = prefix ? `${prefix}-${uniqueSuffix}${ext}` : `file-${uniqueSuffix}${ext}`;
  const objectName = prefix ? `${prefix}s/${baseName}` : baseName;

  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false,
  });

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { publicUrl, objectName };
}
