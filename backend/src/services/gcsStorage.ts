import crypto from 'crypto';
import path from 'path';
import { env } from '../config/env.js';

type StorageClient = import('@google-cloud/storage').Storage;

let storageClient: StorageClient | null = null;
let storageClientPromise: Promise<StorageClient> | null = null;

async function getStorageClient(): Promise<StorageClient> {
  if (storageClient) {
    return storageClient;
  }

  if (!storageClientPromise) {
    storageClientPromise = import('@google-cloud/storage').then(({ Storage }) => {
      storageClient = new Storage({ projectId: env.gcp.projectId ?? undefined });
      return storageClient;
    });
  }

  return storageClientPromise;
}

export interface GcsUploadResult {
  publicUrl: string;
  objectName: string;
}

export interface GcsResumableUploadSession {
  uploadUrl: string;
  publicUrl: string;
  objectName: string;
}

function resolveBucketName(): string {
  const bucketName = env.gcp.uploadsBucket;
  if (!bucketName) {
    throw new Error('GCS_BUCKET_NAME is not configured. Set the GCS_BUCKET_NAME environment variable.');
  }
  return bucketName;
}

function buildObjectName(originalFilename: string, prefix: string): string {
  const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const ext = path.extname(originalFilename);
  const baseName = prefix ? `${prefix}-${uniqueSuffix}${ext}` : `file-${uniqueSuffix}${ext}`;
  return prefix ? `${prefix}s/${baseName}` : baseName;
}

export function getPublicUrlForObject(objectName: string): string {
  const bucketName = resolveBucketName();
  return `https://storage.googleapis.com/${bucketName}/${objectName}`;
}

export async function createResumableUploadSession(
  originalFilename: string,
  prefix: string,
  mimeType: string
): Promise<GcsResumableUploadSession> {
  const bucketName = resolveBucketName();
  const objectName = buildObjectName(originalFilename, prefix);
  const storage = await getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  const [uploadUrl] = await file.createResumableUpload({
    metadata: { contentType: mimeType },
    // Browser upload must include an explicit content type.
    origin: env.corsOrigins[0] ?? undefined,
  });

  return {
    uploadUrl,
    publicUrl: getPublicUrlForObject(objectName),
    objectName,
  };
}

export async function gcsObjectExists(objectName: string): Promise<boolean> {
  const bucketName = resolveBucketName();
  const storage = await getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);
  const [exists] = await file.exists();
  return exists;
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
  const bucketName = resolveBucketName();
  const objectName = buildObjectName(originalFilename, prefix);

  const storage = await getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  await file.save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false,
  });

  const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;
  return { publicUrl, objectName };
}
