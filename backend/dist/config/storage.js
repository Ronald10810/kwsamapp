import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';
export const storageConfig = env.storage;
export function assertLocalUploadStorageEnabled() {
    if (storageConfig.localUploadsEnabled) {
        return;
    }
    throw new Error('Local file uploads are disabled in this environment. Configure managed storage before using upload endpoints.');
}
export function resolveLocalUploadDir(subdir = '') {
    return subdir ? path.join(storageConfig.uploadsDir, subdir) : storageConfig.uploadsDir;
}
export async function ensureLocalUploadDirs(...subdirs) {
    if (!storageConfig.localUploadsEnabled) {
        return;
    }
    const dirs = subdirs.length > 0 ? subdirs : [''];
    await Promise.all(dirs.map((subdir) => fs.mkdir(resolveLocalUploadDir(subdir), { recursive: true })));
}
//# sourceMappingURL=storage.js.map