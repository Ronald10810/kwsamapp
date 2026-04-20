# Google Cloud Storage (GCS) Structure & Implementation

Guide for managing files in Google Cloud Storage for kwsa-cloud-console.

---

## Table of Contents

1. [Overview](#overview)
2. [Bucket Structure](#bucket-structure)
3. [File Naming Conventions](#file-naming-conventions)
4. [Access Control](#access-control)
5. [Implementation](#implementation)
6. [File Upload Workflow](#file-upload-workflow)
7. [File Download Workflow](#file-download-workflow)
8. [Signed URLs](#signed-urls)
9. [Cleanup & Lifecycle](#cleanup--lifecycle)
10. [Monitoring & Logging](#monitoring--logging)

---

## Overview

Google Cloud Storage (GCS) is used for all file uploads in kwsa-cloud-console, replacing the legacy Azure Blob Storage.

**Bucket Name**: `kwsa-cloud-storage` (created in GCP console)

**Advantages**:
- ✅ Scalable, reliable storage
- ✅ Fine-grained access control (IAM)
- ✅ Automatic backups
- ✅ Global availability
- ✅ Signed URLs for temporary access
- ✅ Versioning support (optional)

---

## Bucket Structure

### Directory Layout

```
gs://kwsa-cloud-storage/

├── listings/
│   ├── {listingId}/
│   │   ├── images/
│   │   │   ├── {uuid}-1.jpg       # Photo 1 (ordered)
│   │   │   ├── {uuid}-2.jpg       # Photo 2
│   │   │   ├── {uuid}-3.jpg       # Photo 3
│   │   │   └── {uuid}-{n}.{ext}   # Photo N
│   │   ├── floorplans/
│   │   │   ├── {uuid}-floorplan.pdf
│   │   │   └── {uuid}-survey.pdf
│   │   └── documents/
│   │       ├── {uuid}-spec-sheet.pdf
│   │       └── {uuid}-brochure.pdf
│   │
│   └── {listingId}/
│       # ... more listings
│
├── transactions/
│   ├── {transactionId}/
│   │   ├── documents/
│   │   │   ├── {uuid}-otp.pdf              # Offer to Purchase
│   │   │   ├── {uuid}-transfer-deed.pdf   # Transfer deed
│   │   │   ├── {uuid}-attorney-letter.pdf # Attorney details
│   │   │   └── {uuid}-bond-agreement.pdf  # Bond documents
│   │   └── correspondence/
│   │       ├── {uuid}-email-{date}.eml    # Saved emails
│   │       └── {uuid}-email-{date}.eml
│   │
│   └── {transactionId}/
│       # ... more transactions
│
├── associates/
│   ├── {associateId}/
│   │   ├── profile/
│   │   │   ├── avatar.jpg               # Profile photo
│   │   │   └── avatar-thumb.jpg         # Thumbnail (100x100)
│   │   └── documents/
│   │       ├── {uuid}-fais-license.pdf  # FAIS Registration
│   │       ├── {uuid}-id-copy.pdf       # ID photocopy
│   │       └── {uuid}-proof-address.jpg # Proof of address
│   │
│   └── {associateId}/
│       # ... more associates
│
├── marketcenters/
│   ├── {marketCenterId}/
│   │   ├── branding/
│   │   │   ├── logo.png
│   │   │   └── banner.jpg
│   │   └── documents/
│   │       └── {uuid}-agreement.pdf
│   │
│   └── {marketCenterId}/
│       # ... more market centers
│
├── reports/
│   ├── gci-reports/
│   │   └── gci-report-{date}.pdf       # Monthly GCI reports
│   ├── transaction-reports/
│   │   └── transaction-report-{date}.pdf
│   └── compliance/
│       └── audit-trail-{date}.pdf
│
└── temp/
    ├── uploads/
    │   └── {sessionId}-{filename}      # Temporary uploads
    └── exports/
        └── {reportId}-export-{date}.zip
```

### Key Principles

1. **Organized by Entity**: Listings, transactions, associates each have dedicated folder
2. **Nested by ID**: Files grouped by entity ID (listingId, transactionId, etc.)
3. **File Type Categories**: Images, documents, etc. separated
4. **UUID-based Filenames**: Prevents collisions and security exposure
5. **Date Stamping**: Reports and time-sensitive files include date
6. **Temp Cleanup**: Temporary files auto-deleted after 30 days

---

## File Naming Conventions

### Format: `{category}-{identifier}-{sequence}.{extension}`

**Examples**:

| Entity | File | GCS Path | Filename Convention |
|--------|------|----------|----------------------|
| Listing | Image 1 | `listings/{id}/images/` | `550e8400-1234-5678.jpg` |
| Listing | Image (ordered) | `listings/{id}/images/` | `550e8400-1234-5678-1.jpg` |
| Listing | Floor Plan | `listings/{id}/floorplans/` | `550e8400-1234-floorplan.pdf` |
| Transaction | OTP Document | `transactions/{id}/documents/` | `550e8400-1234-otp.pdf` |
| Transaction | Email Archive | `transactions/{id}/correspondence/` | `550e8400-1234-email-2024-01-15.eml` |
| Associate | Avatar | `associates/{id}/profile/` | `avatar.jpg` (no UUID) |
| Associate | License | `associates/{id}/documents/` | `550e8400-1234-license.pdf` |
| Report | GCI Report | `reports/gci-reports/` | `gci-report-2024-01.pdf` |

### Naming Rules

1. **No spaces or special chars**: Use hyphens only
2. **Lowercase**: All filenames lowercase
3. **UUID v4**: Use for sequential file names to prevent collisions
4. **Date format**: YYYY-MM-DD for sorting
5. **Preserve extension**: Keep original file type
6. **Max length**: 255 characters total path

---

## Access Control

### Public vs. Private Files

#### Public Files (Readable by Anyone)
- Listing images in published listings
- Market center logos
- Public documents

**GCS Configuration**:
```
Bucket Policy:
- allUsers: roles/storage.objectViewer (for specific prefixes only)
- kvwsa-app-service@project.iam.gserviceaccount.com: roles/storage.admin
```

#### Private Files (Access Controlled)
- Transaction documents (OTP, contracts, etc.)
- Associate licenses and personal docs
- Reports and compliance docs
- Communications (emails)

**GCS Configuration**:
```
Bucket Policy:
- kvwsa-app-service@project.iam.gserviceaccount.com: roles/storage.admin
- Signed URLs for temporary access
```

### IAM Roles

**Service Account** (for Node.js app):
- `kvwsa-app-service@{PROJECT_ID}.iam.gserviceaccount.com`
- Role: `roles/storage.admin` (read/write)
- Can upload, download, delete files
- Must have key file for authentication

**End Users**:
- Never given direct GCS access
- Access via signed URLs with expiration
- Expiration time: 15 minutes for documents, 1 hour for images

---

## Implementation

### 1. Setup GCS Client in Backend

**File**: `backend/src/config/gcs.ts`

```typescript
import { Storage } from '@google-cloud/storage';
import path from 'path';

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const bucket = storage.bucket(process.env.GCS_BUCKET_NAME!);

export { storage, bucket };
```

### 2. Create Storage Service

**File**: `backend/src/services/storage.service.ts`

```typescript
import { bucket } from '../config/gcs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';

export class StorageService {
  /**
   * Upload file to GCS
   * @param file - File buffer
   * @param entityType - 'listings' | 'transactions' | 'associates'
   * @param entityId - ID of entity
   * @param fileCategory - 'images' | 'documents' | 'profile' etc.
   * @param originalFileName - Original filename
   * @returns GCS path
   */
  async uploadFile(
    file: Buffer,
    entityType: string,
    entityId: string,
    fileCategory: string,
    originalFileName: string
  ): Promise<string> {
    try {
      const uuid = uuidv4();
      const ext = this.getFileExtension(originalFileName);
      const fileName = `${uuid}.${ext}`;
      const gcsPath = `${entityType}/${entityId}/${fileCategory}/${fileName}`;

      // Upload to GCS
      const fileRef = bucket.file(gcsPath);
      await fileRef.save(file, {
        metadata: {
          contentType: this.getMimeType(originalFileName),
          metadata: {
            uploadedAt: new Date().toISOString(),
            originalName: originalFileName,
          },
        },
      });

      logger.info(`File uploaded: ${gcsPath}`);
      return gcsPath;
    } catch (error) {
      logger.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download file from GCS
   * @param gcsPath - GCS path
   * @returns File buffer
   */
  async downloadFile(gcsPath: string): Promise<Buffer> {
    try {
      const fileRef = bucket.file(gcsPath);
      const [fileBuffer] = await fileRef.download();
      return fileBuffer;
    } catch (error) {
      logger.error(`Download failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete file from GCS
   * @param gcsPath - GCS path
   */
  async deleteFile(gcsPath: string): Promise<void> {
    try {
      const fileRef = bucket.file(gcsPath);
      await fileRef.delete();
      logger.info(`File deleted: ${gcsPath}`);
    } catch (error) {
      logger.error(`Delete failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete all files in entity folder
   * @param entityType - 'listings' | 'transactions' etc
   * @param entityId - Entity ID
   */
  async deleteEntityFiles(entityType: string, entityId: string): Promise<void> {
    try {
      const prefix = `${entityType}/${entityId}/`;
      const [files] = await bucket.getFiles({ prefix });

      for (const file of files) {
        await file.delete();
        logger.debug(`Deleted: ${file.name}`);
      }

      logger.info(`Deleted all files for ${entityType}/${entityId}`);
    } catch (error) {
      logger.error(`Bulk delete failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate signed URL for temporary access
   * @param gcsPath - GCS file path
   * @param expiresIn - Expiration time in minutes (default: 15)
   * @returns Signed URL
   */
  async generateSignedUrl(gcsPath: string, expiresIn: number = 15): Promise<string> {
    try {
      const fileRef = bucket.file(gcsPath);
      const [signedUrl] = await fileRef.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresIn * 60 * 1000,
      });
      return signedUrl;
    } catch (error) {
      logger.error(`Signed URL generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if file exists
   * @param gcsPath - GCS file path
   */
  async fileExists(gcsPath: string): Promise<boolean> {
    try {
      const fileRef = bucket.file(gcsPath);
      const [exists] = await fileRef.exists();
      return exists;
    } catch (error) {
      logger.error(`Existence check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get file metadata
   * @param gcsPath - GCS file path
   */
  async getFileMetadata(gcsPath: string): Promise<any> {
    try {
      const fileRef = bucket.file(gcsPath);
      const [metadata] = await fileRef.getMetadata();
      return {
        size: metadata.size,
        contentType: metadata.contentType,
        created: metadata.timeCreated,
        updated: metadata.updated,
      };
    } catch (error) {
      logger.error(`Metadata fetch failed: ${error.message}`);
      throw error;
    }
  }

  // Helper methods
  private getFileExtension(fileName: string): string {
    return fileName.split('.').pop()?.toLowerCase() || 'bin';
  }

  private getMimeType(fileName: string): string {
    const ext = this.getFileExtension(fileName);
    const mimeTypes: { [key: string]: string } = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      zip: 'application/zip',
      eml: 'message/rfc822',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

export const storageService = new StorageService();
```

---

## File Upload Workflow

### 1. User uploads file via frontend

```typescript
// frontend/src/services/api.ts
export async function uploadListingImage(
  listingId: string,
  file: File
): Promise<{ path: string; url: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post(
    `/listings/${listingId}/upload-image`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
    }
  );

  return response.data;
}
```

### 2. Backend receives file and uploads to GCS

```typescript
// backend/src/routes/listings.ts
import express from 'express';
import multer from 'multer';
import { storageService } from '../services/storage.service';
import { prisma } from '../config/database';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.post(
  '/:id/upload-image',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      // Upload to GCS
      const gcsPath = await storageService.uploadFile(
        file.buffer,
        'listings',
        id,
        'images',
        file.originalname
      );

      // Get current image count for ordering
      const imageCount = await prisma.listingImage.count({
        where: { listingId: id },
      });

      // Save metadata to database
      const image = await prisma.listingImage.create({
        data: {
          listingId: id,
          url: gcsPath,  // Store GCS path
          orderNumber: imageCount + 1,  // Auto-increment order
          caption: req.body.caption || '',
        },
      });

      // Generate public URL (if image is public listing)
      const listing = await prisma.listing.findUnique({
        where: { id },
        select: { statusId: true },
      });

      let publicUrl = gcsPath;
      if (listing?.statusId === PUBLIC_LISTING_STATUS) {
        // Generate signed URL for public access
        publicUrl = await storageService.generateSignedUrl(gcsPath, 7 * 24 * 60);  // 7 days
      }

      res.json({
        id: image.id,
        path: gcsPath,
        url: publicUrl,
        orderNumber: image.orderNumber,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
```

### 3. Frontend displays uploaded image

```typescript
// frontend/src/pages/ListingDetail.tsx
export function ListingDetail() {
  const [images, setImages] = useState<ListingImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const uploadedImage = await uploadListingImage(listingId, file);
      setImages([...images, uploadedImage]);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageUpload}
      />
      <div>
        {images.map((img, idx) => (
          <img
            key={idx}
            src={img.url}
            alt={`Image ${idx + 1}`}
            style={{ maxWidth: '300px' }}
          />
        ))}
      </div>
    </div>
  );
}
```

---

## File Download Workflow

### 1. Backend provides signed URL

```typescript
// backend/src/routes/listings.ts
router.get('/:id/images/:imageId', async (req, res, next) => {
  try {
    const { id, imageId } = req.params;

    const image = await prisma.listingImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Generate temporary signed URL
    const signedUrl = await storageService.generateSignedUrl(image.url, 15);  // 15 mins

    res.json({ url: signedUrl });
  } catch (error) {
    next(error);
  }
});
```

### 2. Frontend displays image with signed URL

```typescript
const [imageUrl, setImageUrl] = useState('');

useEffect(() => {
  const fetchImageUrl = async () => {
    const response = await api.get(`/listings/${listingId}/images/${imageId}`);
    setImageUrl(response.data.url);
  };
  fetchImageUrl();
}, [listingId, imageId]);

return <img src={imageUrl} alt="Listing" />;
```

---

## Signed URLs

### When to Use Signed URLs

| Scenario | Expiration | Use Case |
|----------|-----------|----------|
| Public listing image | 7 days | Published property listing |
| Document download | 15 minutes | Transaction documents |
| Profile picture | 1 hour | Associate profile page |
| Report download | 1 hour | Exported CSV/PDF |
| Temporary upload | 30 minutes | File upload in progress |

### Example: Generate Signed URL for Download

```typescript
// backend/src/services/documents.service.ts
async function getDocumentDownloadUrl(documentId: string, timeoutMinutes: number = 15) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) throw new Error('Document not found');

  return await storageService.generateSignedUrl(document.fileUrl, timeoutMinutes);
}

// Backend API endpoint
router.get('/download/:documentId', async (req, res) => {
  const url = await getDocumentDownloadUrl(req.params.documentId);
  res.json({ downloadUrl: url });
});
```

### Frontend Usage

```typescript
const handleDownload = async (documentId: string) => {
  const response = await api.get(`/documents/download/${documentId}`);
  const link = document.createElement('a');
  link.href = response.data.downloadUrl;
  link.download = true;
  link.click();
};
```

---

## Cleanup & Lifecycle

### Automatic Cleanup Policies

**GCS Bucket Lifecycle Rules**:

```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {
          "age": 30,
          "matchesPrefix": ["temp/"]
        }
      },
      {
        "action": {"type": "SetStorageClass", "storageClass": "NEARLINE"},
        "condition": {
          "age": 90,
          "matchesPrefix": ["reports/"]
        }
      }
    ]
  }
}
```

Rule 1: Delete temporary uploads after 30 days
Rule 2: Move reports to cheaper storage after 90 days

### Manual Cleanup

```typescript
// backend/src/jobs/cleanup.job.ts
import { CronJob } from 'cron';
import { storageService } from '../services/storage.service';
import { prisma } from '../config/database';

/**
 * Weekly cleanup job
 * Removes orphaned files not referenced in database
 */
export const cleanupJob = new CronJob('0 2 * * 0', async () => {
  try {
    logger.info('Starting cleanup job...');

    // Find deleted listings with files
    const deletedListings = await prisma.listing.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });

    for (const listing of deletedListings) {
      await storageService.deleteEntityFiles('listings', listing.id);
    }

    logger.info(`Cleanup complete: ${deletedListings.length} entity folders removed`);
  } catch (error) {
    logger.error(`Cleanup failed: ${error.message}`);
  }
});

// Start the job
cleanupJob.start();
```

### When to Delete Files

1. **Listing deleted**: Remove all images, documents
2. **Transaction cancelled**: Remove OTP, contracts
3. **Associate removed**: Remove profile documents
4. **Temp uploads older than 30 days**: Auto-delete via lifecycle

---

## Monitoring & Logging

### Monitor Storage Usage

```bash
# GCP Console
# Bucket Settings → Storage usage chart

# Or via Cloud Console
gcloud storage du gs://kwsa-cloud-storage
gcloud storage du gs://kwsa-cloud-storage --total-only
```

### View Logs in Cloud Logging

```bash
# All GCS operations for bucket
gcloud logging read "resource.type=gcs_bucket AND resource.labels.bucket_name=kwsa-cloud-storage" --limit 100

# Filter upload operations (method="storage.objects.create")
gcloud logging read "resource.type=gcs_bucket AND protoPayload.methodName=storage.objects.create" --limit 50
```

### Application Logging

```typescript
// backend/src/config/logger.ts includes GCS operations
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

// Usage
logger.info(`Upload complete: ${gcsPath}`);
logger.error(`Upload failed: ${error.message}`);
logger.debug(`File size: ${file.size} bytes`);
```

### Alerts

Set up in GCP Cloud Monitoring:
- Alert if bucket storage > 100 GB
- Alert if failed uploads spike
- Alert if unusual deletion patterns

---

## Environment Variables

```bash
# backend/.env
GCS_PROJECT_ID=your-gcp-project-id
GCS_BUCKET_NAME=kwsa-cloud-storage
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Local Testing (mock storage)
STORAGE_EMULATOR=true
```

---

## Cost Optimization

| Strategy | Benefit |
|----------|---------|
| Lifecycle rules (move to NEARLINE after 90 days) | Reduce storage cost by 70% for old reports |
| Compressed images for thumbna ils | Reduce bandwidth by ~80% |
| CDN (Cloud CDN) for public images | Reduce egress cost by ~60% |
| Batch delete via lifecycle | Reduce API calls for cleanup |

---

This GCS structure ensures:
- ✅ Organized, scalable file management
- ✅ Secure access control
- ✅ Cost-effective storage
- ✅ Easy retrieval and cleanup
- ✅ Compliance with data protection
