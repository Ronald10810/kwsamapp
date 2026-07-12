import crypto from 'crypto';
import path from 'path';
import { env } from '../config/env.js';
let storageClient = null;
let storageClientPromise = null;
async function getStorageClient() {
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
function resolveBucketName() {
    const bucketName = env.gcp.uploadsBucket;
    if (!bucketName) {
        throw new Error('GCS_BUCKET_NAME is not configured. Set the GCS_BUCKET_NAME environment variable.');
    }
    return bucketName;
}
function buildObjectName(originalFilename, prefix) {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(originalFilename);
    const baseName = prefix ? `${prefix}-${uniqueSuffix}${ext}` : `file-${uniqueSuffix}${ext}`;
    return prefix ? `${prefix}s/${baseName}` : baseName;
}
export function getPublicUrlForObject(objectName) {
    const bucketName = resolveBucketName();
    return `https://storage.googleapis.com/${bucketName}/${objectName}`;
}
export async function createResumableUploadSession(originalFilename, prefix, mimeType) {
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
export async function gcsObjectExists(objectName) {
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
export async function uploadToGcs(buffer, originalFilename, prefix, mimeType) {
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
//# sourceMappingURL=gcsStorage.js.map