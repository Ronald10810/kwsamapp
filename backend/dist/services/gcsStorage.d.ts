export interface GcsUploadResult {
    publicUrl: string;
    objectName: string;
}
export interface GcsResumableUploadSession {
    uploadUrl: string;
    publicUrl: string;
    objectName: string;
}
export declare function getPublicUrlForObject(objectName: string): string;
export declare function createResumableUploadSession(originalFilename: string, prefix: string, mimeType: string): Promise<GcsResumableUploadSession>;
export declare function gcsObjectExists(objectName: string): Promise<boolean>;
/**
 * Uploads a buffer to GCS and returns the public URL.
 * Requires GCS_BUCKET_NAME and GOOGLE_CLOUD_PROJECT to be set.
 */
export declare function uploadToGcs(buffer: Buffer, originalFilename: string, prefix: string, mimeType: string): Promise<GcsUploadResult>;
//# sourceMappingURL=gcsStorage.d.ts.map