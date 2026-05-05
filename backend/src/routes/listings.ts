import { Router, type Request } from 'express';
import { type Pool } from 'pg';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getOptionalPgPool } from '../config/db.js';
import { assertLocalUploadStorageEnabled, resolveLocalUploadDir, storageConfig } from '../config/storage.js';
import { uploadToGcs } from '../services/gcsStorage.js';
import { env } from '../config/env.js';
import { resolvePermissions } from '../middleware/permissions.js';

const router = Router();
const pool = getOptionalPgPool();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[, ]/g, '').trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true' || value === 'yes') return true;
  return false;
}

function isUuid(value: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function mapKwwPropertyType(rawType: string, rawSubType: string): { propType: string; propTypeId: number; propSubtypeId: number } {
  const type = rawType.toLowerCase();
  const sub = rawSubType.toLowerCase();

  if (type.includes('commercial') || sub.includes('commercial') || sub.includes('industrial') || sub.includes('business') || sub.includes('office') || sub.includes('retail')) {
    return { propType: 'Commercial', propTypeId: 2, propSubtypeId: sub.includes('industrial') ? 23 : sub.includes('office') ? 24 : sub.includes('retail') ? 25 : sub.includes('business') ? 21 : 32 };
  }

  if (type.includes('farm') || sub.includes('farm') || sub.includes('agric')) {
    return { propType: 'Farm And Agriculture', propTypeId: 4, propSubtypeId: 7 };
  }

  if (type.includes('land') || sub.includes('land') || sub.includes('vacant') || sub.includes('plot')) {
    return { propType: 'Lots And Land', propTypeId: 5, propSubtypeId: 28 };
  }

  if (sub.includes('apartment') || sub.includes('flat')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 1 };
  if (sub.includes('cluster')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 3 };
  if (sub.includes('duplex')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 6 };
  if (sub.includes('simplex')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 17 };
  if (sub.includes('townhouse') || sub.includes('town house')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 18 };
  if (sub.includes('house') || sub.includes('single family') || sub.includes('freehold')) return { propType: 'Residential', propTypeId: 8, propSubtypeId: 15 };

  return { propType: 'Residential', propTypeId: 8, propSubtypeId: 32 };
}

function mapKwwListType(rawMandate: string, propTypeId: number): { listType: string; listTypeId: number } {
  const mandate = rawMandate.toLowerCase();

  if (propTypeId === 5) {
    return { listType: 'Land Listing', listTypeId: 8 };
  }

  if (mandate.includes('multi')) {
    return { listType: 'MLS Listing', listTypeId: 2 };
  }

  if (mandate.includes('exclusive')) {
    return { listType: 'KWW Exclusive', listTypeId: 4 };
  }

  if (mandate.includes('open')) {
    return { listType: 'Open Listing', listTypeId: 5 };
  }

  if (mandate.includes('sole') || mandate.includes('dual')) {
    return { listType: 'Prospective', listTypeId: 1 };
  }

  return { listType: 'Prospective', listTypeId: 1 };
}

function toDateValue(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function parseImageUrls(value: unknown): string[] {
  const dedupe = (entries: string[]): string[] => [...new Set(entries)];

  // Normalize: strip any host prefix from /uploads/ URLs so we always store relative paths
  const normalizeUrl = (u: string): string => {
    const m = u.match(/^https?:\/\/[^/]+(\/uploads\/.+)$/i);
    return m ? m[1] : u;
  };

  if (Array.isArray(value)) {
    return dedupe(value
      .map((entry) => (typeof entry === 'string' ? normalizeUrl(entry.trim()) : ''))
      .filter((entry) => /^https?:\/\//i.test(entry) || entry.startsWith('/uploads/')));
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[\[\]"]/g, ' ').replace(/\r?\n/g, '|').trim();
    if (!cleaned) return [];
    return dedupe(cleaned
      .split(/\s*[|;,]\s*/)
      .map((e) => normalizeUrl(e.trim()))
      .filter((e) => /^https?:\/\//i.test(e) || e.startsWith('/uploads/')));
  }
  return [];
}

async function resolveListingImageUrls(pg: Pool, listingId: number, rawValue: unknown): Promise<string[]> {
  const direct = parseImageUrls(rawValue);
  if (direct.length > 0) return direct;

  const fallback = await pg.query<{ file_url: string | null }>(
    `SELECT file_url
     FROM migration.listing_images
     WHERE listing_id = $1
       AND COALESCE(TRIM(file_url), '') <> ''
     ORDER BY sort_order ASC, id ASC`,
    [listingId]
  );

  return [...new Set(
    fallback.rows
      .map((row) => (typeof row.file_url === 'string' ? row.file_url.trim() : ''))
      .filter((url) => /^https?:\/\//i.test(url) || url.startsWith('/uploads/')),
  )];
}

type P24Photo = { bytes: string; mimeContentType: string; caption: string; isFloorPlan: boolean };

async function fetchPhotoAsBase64(url: string): Promise<P24Photo | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/jpeg';
    return { bytes: buffer.toString('base64'), mimeContentType: mimeType, caption: '', isFloorPlan: false };
  } catch {
    return null;
  }
}

async function selectPhotosForProperty24(urls: string[]): Promise<P24Photo[]> {
  const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
  const localBase = `http://127.0.0.1:${env.port ?? 3000}`;
  const validUrls = urls
    .map((value) => value.trim())
    // Resolve /uploads/ relative paths to full localhost URL so locally-stored images can be fetched
    .map((value) => value.startsWith('/uploads/') ? `${localBase}${value}` : value)
    .filter((value) => /^https?:\/\//i.test(value))
    .filter((value) => {
      try {
        const pathname = new URL(value).pathname.toLowerCase();
        const ext = path.extname(pathname);
        return allowedExt.has(ext) || !path.extname(pathname);
      } catch {
        return false;
      }
    })
    .slice(0, 30);

  const results = await Promise.all(validUrls.map((url) => fetchPhotoAsBase64(url)));
  return results.filter((photo): photo is P24Photo => photo !== null);
}

function getRequestBaseUrl(req: Request): string {
  if (env.uploadsPublicBaseUrl) return env.uploadsPublicBaseUrl.replace(/\/$/, '');
  const forwardedProto = toText(Array.isArray(req.headers['x-forwarded-proto']) ? req.headers['x-forwarded-proto'][0] : req.headers['x-forwarded-proto']);
  const forwardedHost = toText(Array.isArray(req.headers['x-forwarded-host']) ? req.headers['x-forwarded-host'][0] : req.headers['x-forwarded-host']);
  const host = forwardedHost ?? toText(req.get('host')) ?? `127.0.0.1:${env.port ?? 3000}`;
  const protocol = forwardedProto ?? req.protocol ?? 'http';
  return `${protocol}://${host}`;
}

function mimeTypeFromFileName(name: string): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function isNonPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  return false;
}

async function resolveExternalImageUrls(
  urls: string[],
  req: Request
): Promise<{ urls: string[]; failures: string[] }> {
  const baseUrl = getRequestBaseUrl(req);
  const normalized: string[] = [];
  const failures: string[] = [];

  for (const rawUrl of urls) {
    const value = rawUrl.trim();
    if (!value) continue;
    if (/^https?:\/\//i.test(value)) {
      normalized.push(value);
      continue;
    }
    if (!value.startsWith('/uploads/')) continue;

    // Prefer explicit public host mapping when configured.
    if (env.uploadsPublicBaseUrl) {
      normalized.push(`${env.uploadsPublicBaseUrl.replace(/\/$/, '')}${value}`);
      continue;
    }

    // In GCS mode local /uploads links are not externally reachable.
    // Upload local files on demand and use the public bucket URL.
    if (storageConfig.backend === 'gcs') {
      const relativePath = value.replace(/^\/uploads\//, '');
      const localPath = path.join(resolveLocalUploadDir(''), relativePath);
      const fileName = path.basename(relativePath);
      const dirName = path.dirname(relativePath).replace(/\\/g, '/');
      try {
        const content = await readFile(localPath);
        const { publicUrl } = await uploadToGcs(content, fileName, dirName, mimeTypeFromFileName(fileName));
        normalized.push(publicUrl);
        continue;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(`${value} -> ${detail}`);
        // Do not fall back to localhost/private URLs for external portals.
        continue;
      }
    }

    try {
      const host = new URL(baseUrl).hostname;
      if (isNonPublicHost(host)) {
        // External portals cannot fetch from private/loopback hosts.
        failures.push(`${value} -> base URL host is not publicly reachable (${host})`);
        continue;
      }
      normalized.push(`${baseUrl}${value}`);
    } catch {
      failures.push(`${value} -> could not parse base URL (${baseUrl})`);
      continue;
    }
  }

  return {
    urls: [...new Set(normalized)],
    failures: [...new Set(failures)],
  };
}

async function fetchWithRetries(
  url: string,
  init: RequestInit,
  options: { attempts: number; timeoutMs: number }
): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeoutHandle);
      if (response.status !== 502 && response.status !== 504) {
        return response;
      }

      // Return final attempt response as-is; otherwise retry transient upstream gateway errors.
      if (attempt === options.attempts) {
        return response;
      }
      continue;
    } catch (error) {
      clearTimeout(timeoutHandle);
      lastError = error;
      if (attempt === options.attempts) {
        throw error;
      }
    }
  }

  throw (lastError instanceof Error ? lastError : new Error('Property24 request failed after retries.'));
}

function parseTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

type UploadFilePayload = { name?: string; mimeType?: string; contentBase64?: string };

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extensionFromMimeType(mimeType: string | undefined): string {
  if (!mimeType) return '.jpg';
  const n = mimeType.toLowerCase();
  if (n.includes('png')) return '.png';
  if (n.includes('webp')) return '.webp';
  if (n.includes('gif')) return '.gif';
  return '.jpg';
}

function decodeBase64Image(input: string | undefined): Buffer | null {
  if (!input) return null;
  const cleaned = input.includes(',') ? input.split(',').slice(1).join(',') : input;
  try {
    const buffer = Buffer.from(cleaned, 'base64');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

async function storeUploadedFiles(files: UploadFilePayload[], subdir = 'listings'): Promise<string[]> {
  const storeUploadedFilesLocally = async (): Promise<string[]> => {
    const uploadDir = resolveLocalUploadDir(subdir);
    await mkdir(uploadDir, { recursive: true });
    const urls: string[] = [];
    for (const file of files) {
      const content = decodeBase64Image(file.contentBase64);
      if (!content) continue;
      const originalName = file.name ? sanitizeFileName(file.name) : 'file';
      const ext = path.extname(originalName) || extensionFromMimeType(file.mimeType);
      const base = path.basename(originalName, path.extname(originalName)) || 'file';
      const unique = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      await writeFile(path.join(uploadDir, unique), content);
      urls.push(`/uploads/${subdir}/${unique}`);
    }
    return urls;
  };

  const canFallbackToLocalUploads = (): boolean => {
    if (env.isProduction) return false;
    return true;
  };

  const isRecoverableLocalDevGcsError = (message: string): boolean => {
    return /default credentials|application default credentials|could not load the default credentials|gcs_bucket_name is not configured|google_cloud_project/i.test(message);
  };

  if (storageConfig.backend === 'gcs') {
    try {
      const urls: string[] = [];
      for (const file of files) {
        const content = decodeBase64Image(file.contentBase64);
        if (!content) continue;
        const originalName = file.name ? sanitizeFileName(file.name) : 'file';
        const mimeType = file.mimeType ?? 'image/jpeg';
        const { publicUrl } = await uploadToGcs(content, originalName, subdir.replace(/\/$/, ''), mimeType);
        urls.push(publicUrl);
      }
      return urls;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Local dev may have incomplete GCS configuration; fall back to local uploads to keep the workflow unblocked.
      if (canFallbackToLocalUploads() && isRecoverableLocalDevGcsError(message)) {
        console.warn(`[Uploads] Falling back to local storage in local dev because GCS is unavailable: ${message}`);
        return await storeUploadedFilesLocally();
      }
      throw error;
    }
  }

  assertLocalUploadStorageEnabled();
  return await storeUploadedFilesLocally();
}

async function generateNextListingNumber(): Promise<string> {
  if (!pool) return 'KWLM9000';
  const result = await pool.query<{ max_num: string | null }>(
    `SELECT MAX(CAST(SUBSTRING(listing_number FROM 5) AS INTEGER))::text AS max_num
     FROM migration.core_listings
     WHERE listing_number ~ '^KWLM[0-9]+$'`
  );
  const current = Number(result.rows[0]?.max_num ?? 0);
  const next = Math.max(current + 1, 9000);
  return `KWLM${next}`;
}

// ---------------------------------------------------------------------------
// Reference Data
// ---------------------------------------------------------------------------

router.get('/options', async (_req, res) => {
  const base = {
    listing_statuses: ['Active', 'Inactive', 'Draft'],
    listing_status_tags: ['For Sale', 'Reduced', 'Under Offer', 'Sold', 'Withdrawn', 'Expired', 'Pending Approval', 'Approval Declined'],
    ownership_types: ['Full Title', 'Sectional Title', 'Fractional', 'Leasehold', 'Share Block', 'Time Share'],
    sale_or_rent_types: ['For Sale', 'Procurement Rental', 'Management Rental'],
    property_types: ['Residential', 'Commercial', 'Industrial', 'Business', 'Farm'],
    property_sub_types: {
      Residential: ['House', 'TownHouse', 'Flat/Apartment', 'Cluster', 'Vacant Land', 'Luxury Home'],
      Commercial: ['Commercial'],
      Industrial: ['Industrial'],
      Business: ['Business'],
      Farm: ['Farm'],
    },
    mandate_types: ['Sole Mandate', 'Open Mandate', 'Dual Mandate', 'Multi Listing', 'Sole and Exclusive Mandate', 'No Mandate'],
    zoning_types: ['Single Residential', 'General Residential', 'Local Business', 'General Business', 'General Industrial', 'Heavy Industrial', 'Agriculture', 'Rural', 'Mixed Use'],
    marketing_url_types: ['YouTube', 'MatterPort', 'EyeSpy360', 'Virtual Tours'],
    agent_roles: ['Primary', 'Secondary', 'Third', 'Fourth', 'Referral'],
    facing_options: ['Above Road', 'Below Road', 'East', 'Green Belt', 'Level Road', 'Mountain View', 'North', 'Sea', 'South', 'Street Front', 'Water', 'West'],
    roof_options: ['A-frame', 'Aluminium', 'Asbestos', 'Brown Built', 'Concrete', 'Fibreglass', 'Flat Roof', 'Glass Dome', 'Insulation', 'Iron', 'Shingles', 'Slate', 'Thatch', 'Tile', 'Waterproofing', 'Zinc'],
    style_options: ['A-frame', 'Architect-designed', 'Balinese', 'Cape Dutch', 'Classical', 'Colonial', 'Contemporary', 'Conventional', 'Cottage', 'Mediterranean', 'Modern', 'Open Plan', 'Provencal', 'Spanish', 'Split Level', 'Traditional', 'Tuscan', 'Ultra Modern', 'Victorian'],
    walls_options: ['Asbestos', 'Brick', 'Concrete', 'Face Brick', 'Glass', 'Iron', 'Plaster', 'Stone', 'Wood'],
    windows_options: ['Aluminium', 'Bay', 'Cottage', 'Dormer', 'Double Glazed', 'Lead', 'Picture', 'Sash', 'Skylight', 'Stained', 'Steel', 'Wood'],
    lifestyle_options: [
      'Aquatic Activities', 'Casino Estate', 'Coastal/Beach', 'Complex', 'Country Club', 'Country Living',
      'Cul-de-sac', 'Dual Living', 'Eco Estate', 'Equestrian/Polo Estate', 'Estate', 'Fishing Estate',
      'Game/Stock Farm', 'Gated Community', 'Golf Estate', 'Holiday Home', 'Holiday Resort', 'Island Estate',
      'Lakefront', 'Lifestyle Farm', 'Marina', 'Metropolitan', 'Mountain', 'Nature Reserve', 'Retirement Living',
      'River frontage', 'Security Complex', 'Security Estate', 'Shared Living', 'Smallholding', 'Student Accommodation',
      'Suburban', 'University/College Community', 'Waterfront', 'Wellness estate', 'Wildlife Estate', 'Winelands',
    ],
    property_feature_options: [],
    property_descriptives: {
      House: ['Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Dual Living', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse', 'Multi Storey', 'Semi Detached', 'Simplex', 'Single Storey', 'Smallholding', 'Townhouse', 'Villa'],
      TownHouse: ['Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse', 'Multi Storey', 'New Development', 'Semi Detached', 'Simplex', 'Single Storey', 'Villa'],
      Townhouse: ['Bungalow', 'Cluster Home', 'Cottage', 'Double Storey', 'Duplex', 'Duet/Maisonette', 'Freestanding', 'Guesthouse', 'Multi Storey', 'New Development', 'Semi Detached', 'Simplex', 'Single Storey', 'Villa'],
      Apartment: ['Bachelor/Studio', 'Duplex', 'First Floor', 'Garden Flat', 'Ground Floor', 'Loft/Warehouse', 'New Development', 'Penthouse', 'Second floor and above', 'Simplex', 'Stacked Simplex', 'Third Floor', 'Top Floor'],
      'Flat/Apartment': ['Bachelor/Studio', 'Duplex', 'First Floor', 'Garden Flat', 'Ground Floor', 'Loft/Warehouse', 'New Development', 'Penthouse', 'Second floor and above', 'Simplex', 'Stacked Simplex', 'Third Floor', 'Top Floor'],
      'Apartment/Flat': ['Bachelor/Studio', 'Duplex', 'First Floor', 'Garden Flat', 'Ground Floor', 'Loft/Warehouse', 'New Development', 'Penthouse', 'Second floor and above', 'Simplex', 'Stacked Simplex', 'Third Floor', 'Top Floor'],
      Farm: ['Aquaculture', 'Cash Crops', 'Dairy Farm', 'Flower Farm', 'Fruit Farm', 'Game Farm', 'Irrigation Farm', 'Live Stock Farm', 'Nature Reserve', 'New Development', 'Smallholding', 'Stud Farm', 'Vegetable Farm', 'Wine Farm'],
      'Vacant Land': ['Farming', 'New Development', 'Residential', 'Smallholding'],
      Commercial: ['Distribution Centre', 'Factory', 'Guesthouse', 'Hotel', 'New Development', 'Office', 'Retail', 'Smallholding', 'Storage', 'Warehouse', 'Yard'],
      Industrial: ['Distribution Centre', 'Factory', 'New Development', 'Office', 'Smallholding', 'Storage', 'Warehouse', 'Yard'],
    } as Record<string, string[]>,
    property_area_types: ['Bedroom', 'Bathroom', 'Bar', 'Closet', 'Dining Room', 'Family TV Room', 'Garage', 'Garden', 'Kitchen', 'Lounge', 'Loft', 'Office', 'Outbuilding', 'Pool', 'Entrance Hall', 'Parking', 'Security', 'Sewing Room', 'Special Feature', 'Temperature Control', 'Utility Room', 'Braai Room', 'Other'],
    average_price_options: ['Below Market Value', 'At Market Value', 'Above Market Value'],
    property_area_sub_features: {
      Bedroom: ['Air Conditioner', 'Balcony', 'Blinds', 'Built-in Cupboards', 'Carpets', 'Curtain Rails', 'Double Bedroom', 'Fan', 'Fireplace', 'Half Bedroom', 'Internet Port', 'King Bedroom', 'Laminated Floors', 'Main en Suite', 'Open Plan', 'Parquet Floors', 'Queen Bedroom', 'Single Bedroom', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Walk-in-closet', 'Wooden Floors'],
      Bathroom: ['Basin', 'Bath', 'Bath, Toilet and Basin', 'Bidet', 'Common Toilet', 'Communal Bathrooms', 'Domestic Bathroom', 'Double Basin', 'En suite', 'Executive Bathrooms', 'Full', 'Guest Toilet', 'Half Bathroom', 'In Unit Bathrooms', 'Jacuzzi Bath', 'Main en Suite', 'Outside Toilets', 'Separate Toilet', 'Shower', 'Shower, Toilet and Basin', 'Toilet', 'Unisex Bathrooms', 'Urinal'],
      Bar: ['Bar Counter', 'Built In Bar', 'Cellar', 'Projector'],
      Closet: ['Built-in Cupboards', 'Walk-in-closet'],
      'Dining Room': ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
      'Family TV Room': ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
      Garage: ['Carport', 'Double', 'Electric Door', 'Hollywood Garage', 'Roll up', 'Single', 'Tandem', 'Tip up', 'Triple Parking', 'Workshop'],
      Garden: ['Communal braai area', 'Courtyard', 'Covered', 'Exposed', 'Garden Services', 'Immaculate Condition', 'Irrigation system', 'Landscaped', 'Lighting', 'Patio', 'Sculpture', 'Sprinkler System', 'Water Feature', 'Zen Garden'],
      Kitchen: ['Breakfast Nook', 'Centre Island', 'Coffee Machine', 'Dishwasher Connection', 'Extractor Fan', 'Eye Level Oven', 'Fridge', 'Garbage Disposal', 'Gas Hob', 'Gas Oven', 'Granite Tops', 'Grill', 'Hob', 'Icemaker', 'Laundry', 'Open Plan', 'Oven & Hob', 'Pantry', 'Pizza Oven', 'Scullery', 'Sink', 'Under Counter Oven', 'Washing Machine Connection'],
      Lounge: ['Air Conditioner', 'Balcony', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Fireplace', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
      Loft: ['A-frame', 'Ladder', 'Open Plan', 'Skylight', 'Spacious', 'Staircase'],
      Office: ['Air Conditioner', 'Blinds', 'Carpets', 'Curtain Rails', 'Fan', 'Internet Port', 'Open Plan', 'Tiled Floors', 'TV Port', 'Telephone Port', 'Under Floor Heating', 'Wooden Floors'],
      Outbuilding: ['Bath, Toilet and Basin', 'Boathouse', 'Change Rooms', 'Clubhouse', 'Cellar', 'Cottage', 'Domestic Bathroom', 'Flatlet', 'Gazebo', 'Granny flat', 'Greenhouse', 'Lapa', 'Office', 'Pool Shed', 'School', 'Second House', 'Septic Tank', 'Shed', 'Shower, Toilet and Basin', 'Squash Court', 'Stables', 'Staff Quarters/Domestic Rooms', 'Storeroom', 'Studio', 'Teenpad', 'Toilet', 'Wendy House', 'Workshop'],
      Pool: ['Auto Cleaning Equipment', 'Chlorinator', 'Communal Pool', 'Fenced', 'Fibreglass in Ground', 'Gunite in Ground', 'Heated', 'Portapool', 'Rock Pool', 'Safety Net', 'Splash Pool'],
      'Entrance Hall': ['Fireplace', 'Spacious', 'Staircase'],
      Parking: ['Carport', 'Communal', 'Double Parking', 'On Street Parking', 'Secure Parking', 'Shade Net Covered', 'Single Parking', 'Tandem Parking', 'Triple Parking', 'Underground Parking', 'Visitors Parking'],
      Security: ['24 Hour Access', '24 Hour Response', 'Alarm System', 'Boomed Area', 'Burglar Bars', 'Closed Circuit TV', 'Electric Gate', 'Electric fencing', 'Guard', 'Guard House', 'Intercom', 'Security Gate'],
      'Sewing Room': ['Built-in Cupboards'],
      'Special Feature': ['Atrium', 'Balcony', 'Boat Launch', 'BoatLaunch', 'Central Vacuum System', 'Country Style', 'Driveway', 'Indoor Beams', 'Irrigation system', 'Jacuzzi', 'Jetty', 'Linen Room', 'Outdoor Beams', 'Paveway', 'Perimeter Wall', 'Piped Gas', 'Recreation Room', 'Safe', 'Sauna', 'Sliding Doors', 'Spa Pool', 'Special Doors', 'Special Lights', 'Strong Room', 'Subdivision Rights', 'Tennis Court', 'Totally Walled', 'Tumble Dryer', 'TV Antenna', 'Veranda', 'Water Cooler', 'Satellite Dish'],
      'Temperature Control': ['Air Conditioning Unit', 'Anthracite', 'Cooling Fans', 'Fireplace', 'Oil', 'Solar Heating', 'Under Floor Heating'],
      'Utility Room': ['Laundry', 'Tumble Dryer', 'Washing Machine Connection'],
      'Braai Room': ['Built-in Braai', 'Communal braai area'],
      Other: [],
    } as Record<string, string[]>,
    commercial_industrial_options: {
      building_grade_options: ['A', 'B', 'C', 'P'],
      lease_type_options: ['Gross', 'Net', 'Triple Net'],
      truck_access_options: ['Superlink', 'Interlink', 'Rigid', 'Limited Access'],
      power_availability_options: ['Single Phase', 'Three Phase', 'Generator Ready'],
    },
  };

  if (!pool) {
    return res.json({
      ...base,
      provinces: [],
      cities: [],
      suburbs: [],
      city_by_province: {},
      suburb_by_city: {},
      suburb_by_province: {},
    });
  }

  try {
    const combinations = await pool.query<{ province: string | null; city: string | null; suburb: string | null }>(
      `SELECT DISTINCT
        NULLIF(TRIM(province), '') AS province,
        NULLIF(TRIM(city), '') AS city,
        NULLIF(TRIM(suburb), '') AS suburb
       FROM migration.core_listings`
    );

    const provinces = new Set<string>();
    const cities = new Set<string>();
    const suburbs = new Set<string>();
    const cityByProvince: Record<string, Set<string>> = {};
    const suburbByCity: Record<string, Set<string>> = {};
    const suburbByProvince: Record<string, Set<string>> = {};

    for (const row of combinations.rows) {
      const province = row.province ?? '';
      const city = row.city ?? '';
      const suburb = row.suburb ?? '';

      if (province) provinces.add(province);
      if (city) cities.add(city);
      if (suburb) suburbs.add(suburb);

      if (province && city) {
        cityByProvince[province] ??= new Set<string>();
        cityByProvince[province].add(city);
      }
      if (city && suburb) {
        suburbByCity[city] ??= new Set<string>();
        suburbByCity[city].add(suburb);
      }
      if (province && suburb) {
        suburbByProvince[province] ??= new Set<string>();
        suburbByProvince[province].add(suburb);
      }
    }

    const normalizeMap = (input: Record<string, Set<string>>): Record<string, string[]> => {
      const result: Record<string, string[]> = {};
      for (const key of Object.keys(input)) {
        result[key] = [...input[key]].sort((a, b) => a.localeCompare(b));
      }
      return result;
    };

    return res.json({
      ...base,
      provinces: [...provinces].sort((a, b) => a.localeCompare(b)),
      cities: [...cities].sort((a, b) => a.localeCompare(b)),
      suburbs: [...suburbs].sort((a, b) => a.localeCompare(b)),
      city_by_province: normalizeMap(cityByProvince),
      suburb_by_city: normalizeMap(suburbByCity),
      suburb_by_province: normalizeMap(suburbByProvince),
    });
  } catch {
    return res.json({
      ...base,
      provinces: [],
      cities: [],
      suburbs: [],
      city_by_province: {},
      suburb_by_city: {},
      suburb_by_province: {},
    });
  }
});

// ---------------------------------------------------------------------------
// Quick search endpoint for transaction listing selector
// ---------------------------------------------------------------------------

router.get('/search', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json({ items: [] });

  try {
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_listings') AS exists`
    );
    if (!exists.rows[0]?.exists) return res.json({ items: [] });

    const result = await pool.query(
      `SELECT
         cl.id,
         cl.source_listing_id,
         cl.listing_number,
         COALESCE(cl.address_line, TRIM(CONCAT_WS(' ', cl.street_number, cl.street_name))) AS address,
         cl.suburb,
         cl.city,
         cl.price AS list_price
       FROM migration.core_listings cl
       WHERE (
         cl.listing_number ILIKE $1
         OR cl.source_listing_id ILIKE $1
         OR COALESCE(cl.address_line, '') ILIKE $1
         OR COALESCE(cl.street_name, '') ILIKE $1
         OR COALESCE(cl.suburb, '') ILIKE $1
         OR cl.property_title ILIKE $1
       )
       ORDER BY cl.listing_number
       LIMIT 20`,
      [`%${q}%`]
    );

    return res.json({ items: result.rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Generate listing number
// ---------------------------------------------------------------------------

router.get('/next-number', async (_req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  try {
    const number = await generateNextListingNumber();
    return res.json({ listing_number: number });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// List listings
// ---------------------------------------------------------------------------

router.get('/', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const limitInput = Number(req.query.limit ?? 25);
  const offsetInput = Number(req.query.offset ?? 0);
  const searchInput = String(req.query.search ?? '').trim();
  const statusInput = String(req.query.status ?? '').trim();
  const saleOrRentInput = String(req.query.saleOrRent ?? req.query.sale_or_rent ?? '').trim();
  const propertyTypeInput = String(req.query.propertyType ?? req.query.property_type ?? '').trim();
  const minPriceInput = String(req.query.minPrice ?? req.query.min_price ?? '').trim();
  const maxPriceInput = String(req.query.maxPrice ?? req.query.max_price ?? '').trim();
  const minBedroomsInput = Number(req.query.minBedrooms ?? req.query.min_bedrooms ?? 0);
  const minBathroomsInput = Number(req.query.minBathrooms ?? req.query.min_bathrooms ?? 0);
  const agentEmailInput = String(req.query.agentEmail ?? req.query.agent_email ?? '').trim();
  const marketCenterIdInput = String(req.query.marketCenterId ?? req.query.market_center_id ?? '').trim();

  const flag = (value: unknown): boolean => {
    const v = String(value ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  };

  const petFriendlyInput = flag(req.query.petFriendly ?? req.query.pet_friendly);
  const poolInput = flag(req.query.pool);
  const gardenInput = flag(req.query.garden);
  const flatletInput = flag(req.query.flatlet);
  const retirementInput = flag(req.query.retirement);
  const onShowInput = flag(req.query.onShow ?? req.query.on_show);
  const auctionInput = flag(req.query.auction);
  const securityEstateInput = flag(req.query.securityEstate ?? req.query.security_estate);
  const repossessedInput = flag(req.query.repossessed);
  const scopedInput = flag(req.query.scoped);

  const limit = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 25;
  const offset = Number.isFinite(offsetInput) ? Math.max(offsetInput, 0) : 0;

  try {
    const exists = await pool.query<{ exists: string | null }>(
      `SELECT to_regclass('migration.core_listings') AS exists`
    );
    if (!exists.rows[0]?.exists) return res.json({ total: 0, limit, offset, items: [] });

    const whereClauses: string[] = [];
    const params: Array<string | number> = [];
    const perms = req.permissions!;
    let permsMarketCenterDbId: number | null = null;

    if (perms.scope === 'MARKET_CENTRE' && perms.marketCenterId) {
      const mcResult = await pool.query<{ id: string }>(
        `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
        [perms.marketCenterId]
      );
      permsMarketCenterDbId = mcResult.rows[0]?.id ? Number(mcResult.rows[0].id) : null;
    }

    if (searchInput) {
      params.push(`%${searchInput}%`);
      const p = `$${params.length}`;
      whereClauses.push(`(
        cl.listing_number ILIKE ${p}
        OR cl.source_listing_id ILIKE ${p}
        OR cl.address_line ILIKE ${p}
        OR cl.street_number ILIKE ${p}
        OR cl.street_name ILIKE ${p}
        OR cl.suburb ILIKE ${p}
        OR cl.city ILIKE ${p}
        OR cl.status_name ILIKE ${p}
        OR cl.listing_status_tag ILIKE ${p}
        OR cl.sale_or_rent ILIKE ${p}
        OR cl.property_title ILIKE ${p}
        OR cl.short_title ILIKE ${p}
        OR cl.property24_ref1 ILIKE ${p}
        OR cl.private_property_ref1 ILIKE ${p}
        OR cl.kww_property_reference ILIKE ${p}
        OR cl.listing_payload->>'Property24Id' ILIKE ${p}
        OR cl.listing_payload->>'PrivatePropertyId' ILIKE ${p}
        OR cl.listing_payload->>'KWWId' ILIKE ${p}
        OR EXISTS (
          SELECT 1
          FROM migration.listing_agents la
          WHERE la.listing_id = cl.id
            AND COALESCE(la.agent_name, '') ILIKE ${p}
        )
        OR EXISTS (
          SELECT 1
          FROM migration.listing_contacts lc
          WHERE lc.listing_id = cl.id
            AND (
              COALESCE(lc.full_name, '') ILIKE ${p}
              OR COALESCE(lc.phone_number, '') ILIKE ${p}
              OR COALESCE(lc.email_address, '') ILIKE ${p}
            )
        )
      )`);
    }
    if (statusInput) {
      params.push(statusInput);
      whereClauses.push(`LOWER(TRIM(COALESCE(cl.status_name, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (saleOrRentInput) {
      params.push(saleOrRentInput);
      whereClauses.push(`LOWER(TRIM(COALESCE(cl.sale_or_rent, ''))) = LOWER(TRIM($${params.length}))`);
    }
    if (propertyTypeInput) {
      params.push(propertyTypeInput);
      const p = `$${params.length}`;
      whereClauses.push(`(LOWER(TRIM(COALESCE(cl.property_type, ''))) = LOWER(TRIM(${p})) OR LOWER(TRIM(COALESCE(cl.property_sub_type, ''))) = LOWER(TRIM(${p})))`);
    }

    const minPrice = Number(minPriceInput);
    if (minPriceInput && Number.isFinite(minPrice)) {
      params.push(minPrice);
      whereClauses.push(`COALESCE(cl.price, 0) >= $${params.length}`);
    }
    const maxPrice = Number(maxPriceInput);
    if (maxPriceInput && Number.isFinite(maxPrice)) {
      params.push(maxPrice);
      whereClauses.push(`COALESCE(cl.price, 0) <= $${params.length}`);
    }

    if (Number.isFinite(minBedroomsInput) && minBedroomsInput > 0) {
      params.push(minBedroomsInput);
      whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
          AND COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(lpa.count::text, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}
      )`);
    }

    if (Number.isFinite(minBathroomsInput) && minBathroomsInput > 0) {
      params.push(minBathroomsInput);
      whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
          AND COALESCE(NULLIF(REGEXP_REPLACE(COALESCE(lpa.count::text, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}
      )`);
    }

    if (petFriendlyInput) whereClauses.push(`COALESCE(cl.pet_friendly, false) = true`);
    if (flatletInput) whereClauses.push(`COALESCE(cl.has_flatlet, false) = true`);
    if (retirementInput) whereClauses.push(`COALESCE(cl.retirement_living, false) = true`);
    if (auctionInput) whereClauses.push(`COALESCE(cl.property_auction, false) = true`);
    if (repossessedInput) whereClauses.push(`LOWER(TRIM(COALESCE(cl.listing_status_tag, ''))) = 'repossessed'`);
    if (agentEmailInput) {
      params.push(agentEmailInput.toLowerCase());
      whereClauses.push(`EXISTS (
        SELECT 1 FROM migration.listing_agents la
        LEFT JOIN migration.core_associates a ON a.id = la.associate_id
        WHERE la.listing_id = cl.id
          AND LOWER(COALESCE(a.kwsa_email, a.private_email, a.email, '')) = $${params.length}
      )`);
    }
    if (marketCenterIdInput) {
      params.push(marketCenterIdInput);
      whereClauses.push(`REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($${params.length})), '[^a-z0-9]+', '', 'g')`);
    }

    // Optional scoped mode driven by active permissions (used by frontend defaults).
    if (scopedInput) {
      if (perms.scope === 'MARKET_CENTRE') {
        params.push(perms.marketCenterId ?? '');
        const mcSourceParam = `$${params.length}`;
        let mcDbParam: string | null = null;
        if (permsMarketCenterDbId !== null) {
          params.push(permsMarketCenterDbId);
          mcDbParam = `$${params.length}`;
        }

        whereClauses.push(`(
          REGEXP_REPLACE(LOWER(TRIM(COALESCE(cl.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
          ${mcDbParam ? `OR cl.market_center_id = ${mcDbParam}` : ''}
          OR EXISTS (
            SELECT 1
            FROM migration.listing_agents la
            LEFT JOIN migration.core_associates a ON a.id = la.associate_id
            WHERE la.listing_id = cl.id
              AND (
                REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM(${mcSourceParam})), '[^a-z0-9]+', '', 'g')
                ${mcDbParam ? `OR a.market_center_id = ${mcDbParam} OR la.market_center_id = ${mcDbParam}` : ''}
              )
          )
        )`);
      } else if (perms.scope === 'OWN') {
        if (!perms.associateDbId) {
          whereClauses.push('1 = 0');
        } else {
          params.push(perms.associateDbId);
          whereClauses.push(`EXISTS (
            SELECT 1 FROM migration.listing_agents la
            WHERE la.listing_id = cl.id AND la.associate_id = $${params.length}
          )`);
        }
      }
    }
    if (onShowInput) {
      whereClauses.push(`EXISTS (SELECT 1 FROM migration.listing_show_times lst WHERE lst.listing_id = cl.id)`);
    }
    if (poolInput) {
      whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'pool'
      )`);
    }
    if (gardenInput) {
      whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_property_areas lpa
        WHERE lpa.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garden'
      )`);
    }
    if (securityEstateInput) {
      whereClauses.push(`EXISTS (
        SELECT 1
        FROM migration.listing_features lf
        WHERE lf.listing_id = cl.id
          AND LOWER(TRIM(COALESCE(lf.feature_category, ''))) = 'lifestyle'
          AND LOWER(TRIM(COALESCE(lf.feature_value, ''))) IN ('security estate', 'security complex', 'gated community', 'complex')
      )`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const totalResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM migration.core_listings cl ${whereSql}`,
      params
    );

    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push(offset);
    const offsetParam = `$${params.length}`;

    const dataResult = await pool.query(
      `SELECT id::text, source_listing_id, source_market_center_id, market_center_id::text, listing_number, status_name, listing_status_tag,
        sale_or_rent, address_line, street_number, street_name, suburb, city, province, country,
        price::text,
        COALESCE(
          expiry_date::text,
          NULLIF(listing_payload->>'expiry_date', ''),
          NULLIF(listing_payload->>'ExpiryDate', ''),
          NULLIF(listing_payload->>'ExpirationDate', '')
        ) AS expiry_date,
        property_title, short_title,
        property_description, short_description, property_type, property_sub_type,
        COALESCE(
          NULLIF(TRIM(property24_ref1), ''),
          NULLIF(TRIM(property24_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'property24_id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'Property24Id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'Property24Reference'), '')
        ) AS property24_reference_id,
        COALESCE(
          NULLIF(TRIM(private_property_ref1), ''),
          NULLIF(TRIM(private_property_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'private_property_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'privatePropertyReference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'PrivatePropertyId'), ''),
          NULLIF(TRIM(cl.listing_payload->>'PrivatePropertyReference'), '')
        ) AS private_property_reference_id,
        COALESCE(
          NULLIF(TRIM(kww_property_reference), ''),
          NULLIF(TRIM(kww_ref1), ''),
          NULLIF(TRIM(kww_ref2), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_ref1'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_ref2'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_reference'), ''),
          NULLIF(TRIM(cl.listing_payload->>'kww_id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'KWWId'), ''),
          NULLIF(TRIM(cl.listing_payload->>'KWWReference'), '')
        ) AS kww_reference_id,
        COALESCE(NULLIF(TRIM(cl.listing_payload->>'EntegralId'), ''), NULLIF(TRIM(cl.listing_payload->>'entegral_id'), ''), NULLIF(TRIM(cl.listing_payload->>'EntegralReference'), '')) AS entegral_reference_id,
        (SELECT COALESCE(a.full_name, la.agent_name)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_name,
        (SELECT a.image_url
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_image_url,
        (SELECT COALESCE(a.mobile_number, a.office_number)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_phone,
        (SELECT COALESCE(a.kwsa_email, a.private_email, a.email)
         FROM migration.listing_agents la
         LEFT JOIN migration.core_associates a ON a.id = la.associate_id
         WHERE la.listing_id = cl.id
         ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
         LIMIT 1) AS primary_agent_email,
        COALESCE(
          (SELECT mc.logo_image_url
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           LEFT JOIN migration.core_market_centers mc ON mc.id = COALESCE(a.market_center_id, la.market_center_id)
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1),
          (SELECT mc.logo_image_url
           FROM migration.core_market_centers mc
           WHERE mc.id = cl.market_center_id
           LIMIT 1)
        ) AS market_center_logo_url,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersName'), ''),
          (SELECT lc.full_name
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.full_name, la.agent_name)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_name,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersPhone'), ''),
          (SELECT lc.phone_number
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.mobile_number, a.office_number)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_phone,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'SellersEmail'), ''),
          (SELECT lc.email_address
           FROM migration.listing_contacts lc
           WHERE lc.listing_id = cl.id
           ORDER BY lc.id ASC
           LIMIT 1),
          (SELECT COALESCE(a.kwsa_email, a.private_email, a.email)
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = cl.id
           ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC
           LIMIT 1)
        ) AS primary_contact_email,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bedroom'
        ) AS bedroom_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'bathroom'
        ) AS bathroom_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'garage'
        ) AS garage_count,
        (
          SELECT MAX(lpa.count)::int
          FROM migration.listing_property_areas lpa
          WHERE lpa.listing_id = cl.id
            AND LOWER(TRIM(COALESCE(lpa.area_type, ''))) = 'parking'
        ) AS parking_count,
        cl.erf_size::text,
        cl.floor_area::text,
        is_draft, is_published, mandate_type,
        CASE
          WHEN listing_images_json IS NOT NULL
            AND listing_images_json::text NOT IN ('[]', 'null', '')
          THEN listing_images_json
          ELSE COALESCE(
            (SELECT json_agg(li.file_url ORDER BY li.sort_order)
             FROM migration.listing_images li
             WHERE li.listing_id = cl.id AND li.file_url IS NOT NULL AND TRIM(li.file_url) <> ''),
            '[]'::json
          )::jsonb
        END AS listing_images_json,
        feed_to_private_property::boolean,
        private_property_sync_status,
        updated_at::text
       FROM migration.core_listings cl
       ${whereSql}
             ORDER BY CASE WHEN cl.listing_number ~ '^KWL[0-9]+$'
              THEN CAST(SUBSTRING(cl.listing_number FROM 4) AS BIGINT)
              ELSE 0 END DESC,
               cl.updated_at DESC,
               cl.id DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    const rowIds = dataResult.rows
      .map((row: Record<string, unknown>) => Number(row.id))
      .filter((id) => Number.isFinite(id));

    let ownEditableIds = new Set<number>();
    if (perms.scope === 'OWN' && perms.associateDbId && rowIds.length > 0) {
      const ownEditRows = await pool.query<{ listing_id: string }>(
        `SELECT DISTINCT listing_id::text
           FROM migration.listing_agents
          WHERE associate_id = $1
            AND listing_id = ANY($2::int[])`,
        [perms.associateDbId, rowIds]
      );
      ownEditableIds = new Set(ownEditRows.rows.map((r) => Number(r.listing_id)).filter((id) => Number.isFinite(id)));
    }

    let marketCentreEditableIds = new Set<number>();
    if (perms.scope === 'MARKET_CENTRE' && rowIds.length > 0) {
      if (permsMarketCenterDbId !== null) {
        const mcEditRows = await pool.query<{ listing_id: string }>(
          `SELECT DISTINCT la.listing_id::text
             FROM migration.listing_agents la
             LEFT JOIN migration.core_associates a ON a.id = la.associate_id
            WHERE la.listing_id = ANY($1::int[])
              AND (
                REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')
                OR a.market_center_id = $3
                OR la.market_center_id = $3
              )`,
          [rowIds, perms.marketCenterId ?? '', permsMarketCenterDbId]
        );
        marketCentreEditableIds = new Set(mcEditRows.rows.map((r) => Number(r.listing_id)).filter((id) => Number.isFinite(id)));
      } else {
        const mcEditRows = await pool.query<{ listing_id: string }>(
          `SELECT DISTINCT la.listing_id::text
             FROM migration.listing_agents la
             LEFT JOIN migration.core_associates a ON a.id = la.associate_id
            WHERE la.listing_id = ANY($1::int[])
              AND REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')`,
          [rowIds, perms.marketCenterId ?? '']
        );
        marketCentreEditableIds = new Set(mcEditRows.rows.map((r) => Number(r.listing_id)).filter((id) => Number.isFinite(id)));
      }
    }

    return res.json({
      total: Number(totalResult.rows[0]?.total ?? 0),
      limit,
      offset,
      items: dataResult.rows.map((row: Record<string, unknown>) => {
        const imageUrls = parseImageUrls(row.listing_images_json);
        let canEdit = false;
        if (perms.scope === 'GLOBAL') {
          canEdit = true;
        } else if (perms.scope === 'MARKET_CENTRE') {
          const rowId = Number(row.id ?? 0);
          canEdit = Number.isFinite(rowId) && marketCentreEditableIds.has(rowId);
        } else if (perms.scope === 'OWN') {
          const rowId = Number(row.id ?? 0);
          canEdit = Number.isFinite(rowId) && ownEditableIds.has(rowId);
        }

        return { ...row, can_edit: canEdit, image_urls: imageUrls, thumbnail_url: imageUrls[0] ?? null };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Get single listing with all sub-tables
// ---------------------------------------------------------------------------

router.get('/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  try {
    const result = await pool.query(
      `SELECT
        id::text, source_listing_id, source_market_center_id, market_center_id::text,
        listing_number, status_name, listing_status_tag, ownership_type,
        sale_or_rent, address_line, street_number, street_name, suburb, city, province, country,
        price::text,
        COALESCE(
          expiry_date::text,
          NULLIF(listing_payload->>'expiry_date', ''),
          NULLIF(listing_payload->>'ExpiryDate', ''),
          NULLIF(listing_payload->>'ExpirationDate', '')
        ) AS expiry_date,
        reduced_date::text,
        agent_property_valuation::text,
        no_transfer_duty, property_auction, poa,
        property_title, short_title, property_description, short_description,
        property_type, property_sub_type, descriptive_feature, retirement_living,
        erf_number, unit_number, door_number, estate_name, street_number, street_name,
        postal_code, longitude::text, latitude::text,
        override_display_location, override_display_longitude::text, override_display_latitude::text,
        loom_validation_status, loom_property_id, loom_address,
        display_address_on_website, viewing_instructions, viewing_directions,
        feed_to_private_property, private_property_ref1, private_property_ref2, private_property_sync_status,
        feed_to_kww, kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
        COALESCE(NULLIF(TRIM(listing_payload->>'EntegralId'), ''), NULLIF(TRIM(listing_payload->>'entegral_id'), ''), NULLIF(TRIM(listing_payload->>'EntegralReference'), '')) AS entegral_reference_id,
        feed_to_entegral, entegral_sync_status,
        feed_to_property24, property24_ref1, property24_ref2, property24_sync_status,
        signed_date::text, on_market_since_date::text, rates_and_taxes::text,
        monthly_levy::text, occupation_date::text, mandate_type,
        erf_size::text, floor_area::text, construction_date::text,
        height_restriction::text, out_building_size::text, zoning_type,
        is_furnished, pet_friendly, has_standalone_building, has_flatlet,
        has_backup_water, wheelchair_accessible, has_generator,
        has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
        has_solar_geyser, has_water_tank,
        adsl, fibre, isdn, dialup, fixed_wimax, satellite,
        nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
        is_draft, is_published,
        listing_images_json, listing_payload,
        created_at::text, updated_at::text
       FROM migration.core_listings WHERE id = $1 LIMIT 1`,
      [id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Listing not found.' });
    const row = result.rows[0] as Record<string, unknown>;
    const imageUrls = parseImageUrls(row.listing_images_json);

    const [agents, contacts, images, showTimes, openHouse, marketingUrls, mandateDocs, features, areas] =
      await Promise.all([
        pool.query(
          `SELECT la.id::text, la.associate_id::text, COALESCE(a.full_name, la.agent_name) AS agent_name,
                  la.agent_role, la.is_primary, la.market_center_id::text, la.sort_order
           FROM migration.listing_agents la
           LEFT JOIN migration.core_associates a ON a.id = la.associate_id
           WHERE la.listing_id = $1 ORDER BY la.is_primary DESC, la.sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, full_name, phone_number, email_address, sort_order
           FROM migration.listing_contacts WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, file_name, file_url, media_type, sort_order, uploaded_by, uploaded_at::text
           FROM migration.listing_images WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, from_date::text, from_time, to_date::text, to_time, catch_phrase, sort_order
           FROM migration.listing_show_times WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, open_house_date::text, from_time, to_time, average_price, comments, sort_order
           FROM migration.listing_open_house WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, url, url_type, display_name, sort_order
           FROM migration.listing_marketing_urls WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, file_name, file_url, file_type, uploaded_by, uploaded_at::text, sort_order
           FROM migration.listing_mandate_documents WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, feature_category, feature_value, sort_order
           FROM migration.listing_features WHERE listing_id = $1 ORDER BY feature_category, sort_order`, [id]
        ),
        pool.query(
          `SELECT id::text, area_type, count, size::text, description, sub_features, sort_order
           FROM migration.listing_property_areas WHERE listing_id = $1 ORDER BY sort_order`, [id]
        ),
      ]);

    // Load MC entegral portals for display in the listing form
    const mcId = String(row.market_center_id ?? '').trim();
    let mcEntegralPortals: string[] = [];
    if (mcId) {
      const mcPortalRes = await pool.query(
        `SELECT entegral_portals FROM migration.core_market_centers WHERE id::text = $1 LIMIT 1`,
        [mcId]
      );
      const raw = mcPortalRes.rows[0]?.entegral_portals;
      if (Array.isArray(raw)) {
        mcEntegralPortals = raw.map(String).filter(Boolean);
      } else if (typeof raw === 'string' && raw) {
        mcEntegralPortals = raw.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
    }

    return res.json({
      ...row,
      image_urls: imageUrls,
      thumbnail_url: imageUrls[0] ?? null,
      agents: agents.rows,
      contacts: contacts.rows,
      normalized_images: images.rows,
      show_times: showTimes.rows,
      open_house: openHouse.rows,
      marketing_urls: marketingUrls.rows,
      mandate_documents: mandateDocs.rows,
      features: features.rows,
      property_areas: areas.rows,
      mc_entegral_portals: mcEntegralPortals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Create listing
// ---------------------------------------------------------------------------

router.post('/', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const perms = req.permissions!;
  const b = req.body as Record<string, unknown>;

  // OWN scope (agents): anchor to their home market centre
  if (perms.scope === 'OWN') {
    if (!perms.associateDbId) {
      return res.status(403).json({ error: 'Permission denied: could not resolve your associate record.' });
    }
    // If no MC provided, auto-resolve from agent's home MC
    if (!toText(b.source_market_center_id)) {
      const mcRes = await pool.query<{ source_market_center_id: string }>(
        `SELECT mc.source_market_center_id
         FROM migration.core_associates a
         JOIN migration.core_market_centers mc ON mc.id = a.market_center_id
         WHERE a.id = $1 LIMIT 1`,
        [perms.associateDbId]
      );
      if (mcRes.rows[0]?.source_market_center_id) {
        (b as Record<string, unknown>).source_market_center_id = mcRes.rows[0].source_market_center_id;
      }
    }
  }

  await enrichListingPayloadWithResolvedSuburbId(b);
  let sourceMarketCenterId = toText(b.source_market_center_id);
  let marketCenterId: number | null = null;
  if (sourceMarketCenterId) {
    const mc = await pool.query<{ id: string }>(
      `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
      [sourceMarketCenterId]
    );
    marketCenterId = mc.rows[0]?.id ? Number(mc.rows[0].id) : null;
  }

  // MARKET_CENTRE scope: enforce MC boundary
  if (perms.scope === 'MARKET_CENTRE' && sourceMarketCenterId && sourceMarketCenterId !== perms.marketCenterId) {
    return res.status(403).json({ error: 'Permission denied: you may only create listings in your assigned market centre' });
  }

  const listingNumber = toText(b.listing_number);
  const isDraft = toBool(b.is_draft ?? true);
  const isPublished = toBool(b.is_published ?? false);
  const imageUrls = parseImageUrls(b.image_urls ?? b.listing_images_json);

  try {
    const params = buildListingParams(b, sourceMarketCenterId, marketCenterId, listingNumber, isDraft, isPublished, imageUrls);
    const insert = await pool.query<{ id: string }>(
      `INSERT INTO migration.core_listings (
        source_listing_id, source_market_center_id, market_center_id,
        listing_number, status_name, listing_status_tag, ownership_type,
        sale_or_rent, price, expiry_date, reduced_date, agent_property_valuation,
        no_transfer_duty, property_auction, poa,
        property_title, short_title, property_description, short_description,
        property_type, property_sub_type, descriptive_feature, retirement_living,
        address_line, suburb, city, province, country,
        erf_number, unit_number, door_number, estate_name, street_number, street_name,
        postal_code, longitude, latitude,
        override_display_location, override_display_longitude, override_display_latitude,
        loom_validation_status, loom_property_id, loom_address,
        display_address_on_website, viewing_instructions, viewing_directions,
        feed_to_private_property, private_property_ref1, private_property_ref2, private_property_sync_status,
        feed_to_kww, kww_property_reference, kww_ref1, kww_ref2, kww_sync_status,
        feed_to_entegral, entegral_sync_status,
        feed_to_property24, property24_ref1, property24_ref2, property24_sync_status,
        signed_date, on_market_since_date, rates_and_taxes, monthly_levy, occupation_date, mandate_type,
        erf_size, floor_area, construction_date, height_restriction, out_building_size, zoning_type,
        is_furnished, pet_friendly, has_standalone_building, has_flatlet,
        has_backup_water, wheelchair_accessible, has_generator,
        has_borehole, has_gas_geyser, has_solar_panels, has_backup_battery_or_inverter,
        has_solar_geyser, has_water_tank,
        adsl, fibre, isdn, dialup, fixed_wimax, satellite,
        nearby_bus_service, nearby_minibus_taxi_service, nearby_train_service,
        is_draft, is_published,
        listing_images_json, listing_payload
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10::date,$11::date,$12::numeric,
        $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::numeric,$37::numeric,
        $38,$39::numeric,$40::numeric,$41,$42,$43,
        $44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60,$61,
        $62::date,$63::date,$64::numeric,$65::numeric,$66::date,$67,
        $68::numeric,$69::numeric,$70::date,$71::numeric,$72::numeric,$73,
        $74,$75,$76,$77,$78,$79,$80,$81,$82,$83,$84,$85,$86,$87,$88,$89,$90,$91,$92,$93,
        $94,$95,$96,$97,$98::jsonb,$99::jsonb
      ) RETURNING id::text`,
      params
    );

    const newId = insert.rows[0].id;
    await saveSubTables(pool, Number(newId), b);

    return res.status(201).json({ id: newId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Update listing
// ---------------------------------------------------------------------------

router.put('/:id', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  // Enforce edit permission based on active scope
  const perms = req.permissions!;
  if (perms.scope !== 'GLOBAL') {
    const existing = await pool.query<{ source_market_center_id: string | null; market_center_id: string | null }>(
      `SELECT source_market_center_id, market_center_id::text FROM migration.core_listings WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Listing not found.' });
    const listingMcId = existing.rows[0].source_market_center_id;
    const listingMcDbId = existing.rows[0].market_center_id ? Number(existing.rows[0].market_center_id) : null;

    if (perms.scope === 'MARKET_CENTRE') {
      const listingMcNorm = String(listingMcId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
      const permsMcNorm = String(perms.marketCenterId ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

      let permsMcDbId: number | null = null;
      if (perms.marketCenterId) {
        const mc = await pool.query<{ id: string }>(
          `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
          [perms.marketCenterId]
        );
        permsMcDbId = mc.rows[0]?.id ? Number(mc.rows[0].id) : null;
      }

      const directMatch = (!!listingMcNorm && !!permsMcNorm && listingMcNorm === permsMcNorm)
        || (permsMcDbId !== null && listingMcDbId !== null && listingMcDbId === permsMcDbId);

      if (!directMatch) {
        const linked = await pool.query(
          `SELECT 1
             FROM migration.listing_agents la
             LEFT JOIN migration.core_associates a ON a.id = la.associate_id
            WHERE la.listing_id = $1
              AND (
                REGEXP_REPLACE(LOWER(TRIM(COALESCE(a.source_market_center_id, ''))), '[^a-z0-9]+', '', 'g') = REGEXP_REPLACE(LOWER(TRIM($2)), '[^a-z0-9]+', '', 'g')
                OR ($3::int IS NOT NULL AND (a.market_center_id = $3 OR la.market_center_id = $3))
              )
            LIMIT 1`,
          [id, perms.marketCenterId ?? '', permsMcDbId]
        );

        if ((linked.rowCount ?? 0) === 0) {
          return res.status(403).json({ error: 'Permission denied: listing is not in your market centre' });
        }
      }
    } else if (perms.scope === 'OWN') {
      // Agent: may only edit listings where they are a registered listing agent
      const isAgent = await pool.query(
        `SELECT 1 FROM migration.listing_agents la WHERE la.listing_id = $1 AND la.associate_id = $2 LIMIT 1`,
        [id, perms.associateDbId]
      );
      if ((isAgent.rowCount ?? 0) === 0) {
        return res.status(403).json({ error: 'Permission denied: you are not a listing agent for this listing' });
      }
    }
  }

  const b = req.body as Record<string, unknown>;
  await enrichListingPayloadWithResolvedSuburbId(b);
  let sourceMarketCenterId = toText(b.source_market_center_id);
  let marketCenterId: number | null = null;
  if (sourceMarketCenterId) {
    const mc = await pool.query<{ id: string }>(
      `SELECT id::text FROM migration.core_market_centers WHERE source_market_center_id = $1 LIMIT 1`,
      [sourceMarketCenterId]
    );
    marketCenterId = mc.rows[0]?.id ? Number(mc.rows[0].id) : null;
  }

  const listingNumber = toText(b.listing_number);
  const isDraft = toBool(b.is_draft ?? false);
  const isPublished = toBool(b.is_published ?? false);
  const imageUrls = parseImageUrls(b.image_urls ?? b.listing_images_json);

  try {
    const params = buildListingParams(b, sourceMarketCenterId, marketCenterId, listingNumber, isDraft, isPublished, imageUrls);
    const update = await pool.query<{ id: string }>(
      `UPDATE migration.core_listings SET
        source_market_center_id=$2, market_center_id=$3,
        listing_number=$4, status_name=$5, listing_status_tag=$6, ownership_type=$7,
        sale_or_rent=$8, price=$9::numeric, expiry_date=$10::date, reduced_date=$11::date,
        agent_property_valuation=$12::numeric,
        no_transfer_duty=$13, property_auction=$14, poa=$15,
        property_title=$16, short_title=$17, property_description=$18, short_description=$19,
        property_type=$20, property_sub_type=$21, descriptive_feature=$22, retirement_living=$23,
        address_line=$24, suburb=$25, city=$26, province=$27, country=$28,
        erf_number=$29, unit_number=$30, door_number=$31, estate_name=$32, street_number=$33,
        street_name=$34, postal_code=$35, longitude=$36::numeric, latitude=$37::numeric,
        override_display_location=$38, override_display_longitude=$39::numeric, override_display_latitude=$40::numeric,
        loom_validation_status=$41, loom_property_id=$42, loom_address=$43,
        display_address_on_website=$44, viewing_instructions=$45, viewing_directions=$46,
        feed_to_private_property=$47, private_property_ref1=$48, private_property_ref2=$49, private_property_sync_status=$50,
        feed_to_kww=$51, kww_property_reference=$52, kww_ref1=$53, kww_ref2=$54, kww_sync_status=$55,
        feed_to_entegral=$56, entegral_sync_status=$57,
        feed_to_property24=$58, property24_ref1=$59, property24_ref2=$60, property24_sync_status=$61,
        signed_date=$62::date, on_market_since_date=$63::date, rates_and_taxes=$64::numeric,
        monthly_levy=$65::numeric, occupation_date=$66::date, mandate_type=$67,
        erf_size=$68::numeric, floor_area=$69::numeric, construction_date=$70::date,
        height_restriction=$71::numeric, out_building_size=$72::numeric, zoning_type=$73,
        is_furnished=$74, pet_friendly=$75, has_standalone_building=$76, has_flatlet=$77,
        has_backup_water=$78, wheelchair_accessible=$79, has_generator=$80,
        has_borehole=$81, has_gas_geyser=$82, has_solar_panels=$83, has_backup_battery_or_inverter=$84,
        has_solar_geyser=$85, has_water_tank=$86,
        adsl=$87, fibre=$88, isdn=$89, dialup=$90, fixed_wimax=$91, satellite=$92,
        nearby_bus_service=$93, nearby_minibus_taxi_service=$94, nearby_train_service=$95,
        is_draft=$96, is_published=$97,
        listing_images_json=$98::jsonb, listing_payload=$99::jsonb,
        updated_at=NOW()
       WHERE id=$1 RETURNING id::text`,
      [id, ...params.slice(1)]
    );

    if (update.rowCount === 0) return res.status(404).json({ error: 'Listing not found.' });
    await saveSubTables(pool, id, b);

    const normalizedStatusName = (toText(b.status_name) ?? '').toLowerCase().trim();
    const normalizedStatusTag = (toText(b.listing_status_tag) ?? '').toLowerCase().trim();
    const isWithdrawOrInactive = normalizedStatusName === 'inactive'
      || normalizedStatusName === 'withdrawn'
      || normalizedStatusTag === 'withdrawn'
      || normalizedStatusTag === 'withdraw';

    // If an admin publishes a pending-approval listing directly from edit form,
    // treat it as approved and keep approval/notifications in sync.
    if (perms.scope !== 'OWN' && isPublished && !isWithdrawOrInactive) {
      const approvalRes = await pool.query<{
        submitted_by_associate_id: number | null;
        status: string | null;
      }>(
        `SELECT submitted_by_associate_id, status
           FROM migration.listing_approval_requests
          WHERE listing_id = $1
          LIMIT 1`,
        [id]
      );

      if (approvalRes.rows.length > 0) {
        const approval = approvalRes.rows[0];
        const approvalStatus = (approval.status ?? '').toUpperCase().trim();

        let reviewerName = 'Admin';
        if (perms.associateDbId) {
          const reviewer = await pool.query<{ full_name: string | null }>(
            `SELECT full_name FROM migration.core_associates WHERE id = $1 LIMIT 1`,
            [perms.associateDbId]
          );
          reviewerName = reviewer.rows[0]?.full_name ?? 'Admin';
        }

        if (approvalStatus !== 'APPROVED') {
          await pool.query(
            `UPDATE migration.listing_approval_requests
                SET status = 'APPROVED',
                    reviewed_by_associate_id = $2,
                    reviewed_by_name = $3,
                    reviewed_at = NOW(),
                    updated_at = NOW()
              WHERE listing_id = $1`,
            [id, perms.associateDbId ?? null, reviewerName]
          );
        }

        await pool.query(
          `UPDATE migration.core_listings
              SET is_draft = false,
                  is_published = true,
                  listing_status_tag = CASE
                    WHEN LOWER(TRIM(COALESCE(listing_status_tag, ''))) = 'pending approval' THEN 'Approved'
                    ELSE listing_status_tag
                  END,
                  status_name = CASE
                    WHEN LOWER(TRIM(COALESCE(listing_status_tag, ''))) = 'pending approval' THEN 'Approved'
                    ELSE status_name
                  END,
                  updated_at = NOW()
            WHERE id = $1`,
          [id]
        );

        await pool.query(
          `UPDATE migration.in_app_notifications
              SET category = 'APPROVED',
                  is_read = true,
                  read_at = COALESCE(read_at, NOW()),
                  updated_at = NOW()
            WHERE entity_type = 'listing'
              AND entity_id = $1
              AND notification_type = 'LISTING_APPROVAL_REQUESTED'`,
          [id]
        ).catch(() => undefined);

        if (approval.submitted_by_associate_id) {
          try {
            await createNotification(
              pool,
              approval.submitted_by_associate_id,
              'LISTING_APPROVAL_APPROVED',
              'APPROVED',
              `Listing approved: ${listingNumber ?? id}`,
              `Your listing ${listingNumber ?? id} has been approved and published by ${reviewerName}.`,
              'listing',
              id,
              { listing_id: id, listing_number: listingNumber, reviewer_name: reviewerName, status: 'APPROVED' },
            );
          } catch {
            // Keep listing save successful even if notifications table is unavailable.
          }
        }
      }
    }

    return res.json({ id: update.rows[0].id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Sub-table helpers
// ---------------------------------------------------------------------------

function buildListingParams(
  b: Record<string, unknown>,
  sourceMarketCenterId: string | null,
  marketCenterId: number | null,
  listingNumber: string | null,
  isDraft: boolean,
  isPublished: boolean,
  imageUrls: string[]
): unknown[] {
  const sourceListingId = toText(b.source_listing_id) ?? `MAN-${Date.now()}`;
  return [
    sourceListingId, sourceMarketCenterId, marketCenterId, listingNumber,
    toText(b.status_name), toText(b.listing_status_tag), toText(b.ownership_type),
    toText(b.sale_or_rent), toNumber(b.price),
    toDateValue(b.expiry_date), toDateValue(b.reduced_date), toNumber(b.agent_property_valuation),
    toBool(b.no_transfer_duty), toBool(b.property_auction), toBool(b.poa),
    toText(b.property_title), toText(b.short_title), toText(b.property_description), toText(b.short_description),
    toText(b.property_type), toText(b.property_sub_type), toText(b.descriptive_feature), toBool(b.retirement_living),
    toText(b.address_line), toText(b.suburb), toText(b.city), toText(b.province), toText(b.country),
    toText(b.erf_number), toText(b.unit_number), toText(b.door_number), toText(b.estate_name),
    toText(b.street_number), toText(b.street_name), toText(b.postal_code),
    toNumber(b.longitude), toNumber(b.latitude),
    toBool(b.override_display_location), toNumber(b.override_display_longitude), toNumber(b.override_display_latitude),
    toText(b.loom_validation_status), toText(b.loom_property_id), toText(b.loom_address),
    toBool(b.display_address_on_website ?? true), toText(b.viewing_instructions), toText(b.viewing_directions),
    toBool(b.feed_to_private_property), toText(b.private_property_ref1), toText(b.private_property_ref2), toText(b.private_property_sync_status),
    toBool(b.feed_to_kww), toText(b.kww_property_reference), toText(b.kww_ref1), toText(b.kww_ref2), toText(b.kww_sync_status),
    toBool(b.feed_to_entegral), toText(b.entegral_sync_status),
    toBool(b.feed_to_property24), toText(b.property24_ref1), toText(b.property24_ref2), toText(b.property24_sync_status),
    toDateValue(b.signed_date), toDateValue(b.on_market_since_date), toNumber(b.rates_and_taxes), toNumber(b.monthly_levy),
    toDateValue(b.occupation_date), toText(b.mandate_type),
    toNumber(b.erf_size), toNumber(b.floor_area), toDateValue(b.construction_date),
    toNumber(b.height_restriction), toNumber(b.out_building_size), toText(b.zoning_type),
    toBool(b.is_furnished), toBool(b.pet_friendly), toBool(b.has_standalone_building), toBool(b.has_flatlet),
    toBool(b.has_backup_water), toBool(b.wheelchair_accessible), toBool(b.has_generator),
    toBool(b.has_borehole), toBool(b.has_gas_geyser), toBool(b.has_solar_panels), toBool(b.has_backup_battery_or_inverter),
    toBool(b.has_solar_geyser), toBool(b.has_water_tank),
    toBool(b.adsl), toBool(b.fibre), toBool(b.isdn), toBool(b.dialup), toBool(b.fixed_wimax), toBool(b.satellite),
    toBool(b.nearby_bus_service), toBool(b.nearby_minibus_taxi_service), toBool(b.nearby_train_service),
    isDraft, isPublished,
    JSON.stringify(imageUrls),
    JSON.stringify(typeof b.listing_payload === 'object' && b.listing_payload ? b.listing_payload : {}),
  ];
}

type AgentEntry = { associate_id?: string | null; agent_name?: string | null; agent_role?: string; is_primary?: boolean; market_center_id?: string | null; sort_order?: number };
type ContactEntry = { full_name?: string | null; phone_number?: string | null; email_address?: string | null; sort_order?: number };
type ShowTimeEntry = { from_date?: string; from_time?: string; to_date?: string; to_time?: string; catch_phrase?: string; sort_order?: number };
type OpenHouseEntry = { open_house_date?: string; from_time?: string; to_time?: string; average_price?: string; comments?: string; sort_order?: number };
type MarketingUrlEntry = { url?: string; url_type?: string; display_name?: string; sort_order?: number };
type FeatureEntry = { feature_category?: string; feature_value?: string; sort_order?: number };
type PropertyAreaEntry = { area_type?: string; count?: number; size?: number; description?: string; sub_features?: string[] | string | null; sort_order?: number };
type NormalizedImageEntry = { file_url?: string; file_name?: string; media_type?: string; uploaded_by?: string; sort_order?: number };

async function saveSubTables(pg: Pool, listingId: number, b: Record<string, unknown>): Promise<void> {
  if (Array.isArray(b.agents)) {
    await pg.query(`DELETE FROM migration.listing_agents WHERE listing_id = $1`, [listingId]);
    for (const [i, agent] of (b.agents as AgentEntry[]).entries()) {
      await pg.query(
        `INSERT INTO migration.listing_agents (listing_id, associate_id, agent_name, agent_role, is_primary, market_center_id, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [listingId, toNumber(agent.associate_id), toText(agent.agent_name), toText(agent.agent_role) ?? 'Primary', toBool(agent.is_primary), toNumber(agent.market_center_id), agent.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.contacts)) {
    await pg.query(`DELETE FROM migration.listing_contacts WHERE listing_id = $1`, [listingId]);
    for (const [i, c] of (b.contacts as ContactEntry[]).entries()) {
      await pg.query(
        `INSERT INTO migration.listing_contacts (listing_id, full_name, phone_number, email_address, sort_order) VALUES ($1,$2,$3,$4,$5)`,
        [listingId, toText(c.full_name), toText(c.phone_number), toText(c.email_address), c.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.show_times)) {
    await pg.query(`DELETE FROM migration.listing_show_times WHERE listing_id = $1`, [listingId]);
    for (const [i, st] of (b.show_times as ShowTimeEntry[]).entries()) {
      await pg.query(
        `INSERT INTO migration.listing_show_times (listing_id, from_date, from_time, to_date, to_time, catch_phrase, sort_order)
         VALUES ($1,$2::date,$3,$4::date,$5,$6,$7)`,
        [listingId, toDateValue(st.from_date), toText(st.from_time), toDateValue(st.to_date), toText(st.to_time), toText(st.catch_phrase), st.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.open_house)) {
    await pg.query(`DELETE FROM migration.listing_open_house WHERE listing_id = $1`, [listingId]);
    for (const [i, oh] of (b.open_house as OpenHouseEntry[]).entries()) {
      await pg.query(
        `INSERT INTO migration.listing_open_house (listing_id, open_house_date, from_time, to_time, average_price, comments, sort_order)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7)`,
        [listingId, toDateValue(oh.open_house_date), toText(oh.from_time), toText(oh.to_time), toText(oh.average_price), toText(oh.comments), oh.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.marketing_urls)) {
    await pg.query(`DELETE FROM migration.listing_marketing_urls WHERE listing_id = $1`, [listingId]);
    for (const [i, mu] of (b.marketing_urls as MarketingUrlEntry[]).entries()) {
      if (!toText(mu.url)) continue;
      await pg.query(
        `INSERT INTO migration.listing_marketing_urls (listing_id, url, url_type, display_name, sort_order) VALUES ($1,$2,$3,$4,$5)`,
        [listingId, toText(mu.url), toText(mu.url_type), toText(mu.display_name), mu.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.features)) {
    await pg.query(`DELETE FROM migration.listing_features WHERE listing_id = $1`, [listingId]);
    for (const [i, f] of (b.features as FeatureEntry[]).entries()) {
      if (!toText(f.feature_category) || !toText(f.feature_value)) continue;
      await pg.query(
        `INSERT INTO migration.listing_features (listing_id, feature_category, feature_value, sort_order) VALUES ($1,$2,$3,$4)`,
        [listingId, toText(f.feature_category), toText(f.feature_value), f.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.property_areas)) {
    await pg.query(`DELETE FROM migration.listing_property_areas WHERE listing_id = $1`, [listingId]);
    for (const [i, pa] of (b.property_areas as PropertyAreaEntry[]).entries()) {
      if (!toText(pa.area_type)) continue;
      const subFeatures = parseTextArray(pa.sub_features);
      await pg.query(
        `INSERT INTO migration.listing_property_areas (listing_id, area_type, count, size, description, sub_features, sort_order) VALUES ($1,$2,$3,$4::numeric,$5,$6::jsonb,$7)`,
        [listingId, toText(pa.area_type), pa.count ?? null, toNumber(pa.size), toText(pa.description), JSON.stringify(subFeatures), pa.sort_order ?? i]
      );
    }
  }

  if (Array.isArray(b.normalized_images)) {
    await pg.query(`DELETE FROM migration.listing_images WHERE listing_id = $1`, [listingId]);
    for (const [i, img] of (b.normalized_images as NormalizedImageEntry[]).entries()) {
      if (!toText(img.file_url)) continue;
      await pg.query(
        `INSERT INTO migration.listing_images (listing_id, file_name, file_url, media_type, sort_order, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [listingId, toText(img.file_name), toText(img.file_url), toText(img.media_type) ?? 'image', img.sort_order ?? i, toText(img.uploaded_by)]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Image upload endpoints
// ---------------------------------------------------------------------------

router.post('/images/upload', async (req, res) => {
  if (!storageConfig.localUploadsEnabled && storageConfig.backend !== 'gcs') {
    return res.status(503).json({ error: 'File uploads are disabled. Configure STORAGE_BACKEND (local or gcs).' });
  }
  const files = Array.isArray(req.body?.files) ? (req.body.files as UploadFilePayload[]) : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files were provided.' });
  try {
    const urls = await storeUploadedFiles(files);
    return res.status(201).json({ image_urls: urls });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/images/upload', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  if (!storageConfig.localUploadsEnabled && storageConfig.backend !== 'gcs') {
    return res.status(503).json({ error: 'File uploads are disabled. Configure STORAGE_BACKEND (local or gcs).' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const files = Array.isArray(req.body?.files) ? (req.body.files as UploadFilePayload[]) : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files were provided.' });

  try {
    const newUrls = await storeUploadedFiles(files);
    for (const url of newUrls) {
      const fileName = url.split('/').pop() ?? '';
      await pool.query(
        `INSERT INTO migration.listing_images (listing_id, file_name, file_url, sort_order)
         VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order),0)+1 FROM migration.listing_images WHERE listing_id=$1))`,
        [id, fileName, url]
      );
    }
    await pool.query(`UPDATE migration.core_listings SET updated_at=NOW() WHERE id=$1`, [id]);
    return res.status(201).json({ image_urls: newUrls });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.post('/:id/mandate-documents/upload', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  if (!storageConfig.localUploadsEnabled && storageConfig.backend !== 'gcs') {
    return res.status(503).json({ error: 'File uploads are disabled. Configure STORAGE_BACKEND (local or gcs).' });
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const files = Array.isArray(req.body?.files) ? (req.body.files as UploadFilePayload[]) : [];
  if (files.length === 0) return res.status(400).json({ error: 'No files were provided.' });

  try {
    const newUrls = await storeUploadedFiles(files, 'mandate-docs');
    for (const [i, url] of newUrls.entries()) {
      const file = files[i];
      const fileName = toText(file?.name) ?? url.split('/').pop() ?? '';
      await pool.query(
        `INSERT INTO migration.listing_mandate_documents (listing_id, file_name, file_url, file_type, sort_order)
         VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM migration.listing_mandate_documents WHERE listing_id=$1))`,
        [id, fileName, url, toText(file?.mimeType)]
      );
    }
    return res.status(201).json({ document_urls: newUrls });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Publish listing to Property24
// ---------------------------------------------------------------------------

function mapListingTypeToProperty24(value: unknown): 'Sale' | 'Rental' {
  const normalized = (toText(value) ?? '').toLowerCase().trim();
  return normalized.includes('rent') ? 'Rental' : 'Sale';
}

function mapPropertyTypeIdForProperty24(propertyType: unknown, propertySubType: unknown): number {
  const normalized = `${toText(propertySubType) ?? ''} ${toText(propertyType) ?? ''}`.toLowerCase();

  if (normalized.includes('apartment') || normalized.includes('flat') || normalized.includes('cluster')) {
    return 5;
  }

  if (normalized.includes('townhouse') || normalized.includes('town house')) {
    return 6;
  }

  if (normalized.includes('vacant')) {
    return 8;
  }

  if (normalized.includes('farm')) {
    return 10;
  }

  if (normalized.includes('commercial') || normalized.includes('business')) {
    return 11;
  }

  if (normalized.includes('industrial')) {
    return 12;
  }

  return 4;
}

function mapPetsAllowedForProperty24(value: unknown): 'Yes' | 'No' {
  return toBool(value) ? 'Yes' : 'No';
}

function mapFurnishedStatusForProperty24(value: unknown): 'Yes' | 'No' {
  return toBool(value) ? 'Yes' : 'No';
}

function pickNumericString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const numeric = Math.trunc(value);
    return numeric >= 0 ? String(numeric) : null;
  }

  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    return /^\d+$/.test(text) ? text : null;
  }

  return null;
}

function pickIdString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string') {
    const text = value.trim();
    return text.length > 0 ? text : null;
  }

  return null;
}

function extractLegacySuburbId(listingPayload: unknown): string | null {
  if (!listingPayload || typeof listingPayload !== 'object') return null;

  const payload = listingPayload as Record<string, unknown>;
  const propertyInfo = payload.propertyInfo;
  if (propertyInfo && typeof propertyInfo === 'object') {
    const suburbId = pickNumericString((propertyInfo as Record<string, unknown>).suburbId);
    if (suburbId) return suburbId;
  }

  return pickNumericString(payload.suburbId);
}

function normalizeAreaName(value: unknown): string {
  return (toText(value) ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactAreaName(value: unknown): string {
  return normalizeAreaName(value).replace(/\s+/g, '');
}

function matchesAreaName(
  target: string,
  candidate: unknown,
  alternateNames?: Array<{ name?: string | null }> | null,
): boolean {
  const normalizedTarget = normalizeAreaName(target);
  const compactTarget = compactAreaName(target);
  if (!normalizedTarget) return false;

  if (normalizeAreaName(candidate) === normalizedTarget) return true;
  if (compactAreaName(candidate) === compactTarget) return true;
  return (alternateNames ?? []).some((entry) => {
    const normalizedAlternate = normalizeAreaName(entry?.name);
    if (normalizedAlternate === normalizedTarget) return true;
    return compactAreaName(entry?.name) === compactTarget;
  });
}

function areaNameContains(
  query: string,
  candidate: unknown,
  alternateNames?: Array<{ name?: string | null }> | null,
): boolean {
  const normalizedQuery = normalizeAreaName(query);
  if (!normalizedQuery) return true;

  if (normalizeAreaName(candidate).includes(normalizedQuery)) return true;
  return (alternateNames ?? []).some((entry) => normalizeAreaName(entry?.name).includes(normalizedQuery));
}

async function resolveSuburbIdFromMetadata(
  apiBase: string,
  headers: Record<string, string>,
  provinceName: string,
  cityName: string,
  suburbName: string,
): Promise<string | null> {
  try {
    const provincesResponse = await fetch(`${apiBase}/provinces`, { method: 'GET', headers });
    if (!provincesResponse.ok) return null;

    const provinces = await provincesResponse.json() as Array<{ id?: number | string | null; name?: string | null }>;
    const province = provinces.find((entry) => matchesAreaName(provinceName, entry?.name));
    const provinceId = pickNumericString(province?.id);
    if (!provinceId) return null;

    const citiesUrl = new URL(`${apiBase}/cities`);
    citiesUrl.searchParams.set('provinceId', provinceId);
    const citiesResponse = await fetch(citiesUrl.toString(), { method: 'GET', headers });
    if (!citiesResponse.ok) return null;

    const cities = await citiesResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;
    const city = cities.find((entry) => matchesAreaName(cityName, entry?.name, entry?.alternateNames));
    const cityId = pickNumericString(city?.id);
    if (!cityId) return null;

    const suburbsUrl = new URL(`${apiBase}/suburbs`);
    suburbsUrl.searchParams.set('cityId', cityId);
    const suburbsResponse = await fetch(suburbsUrl.toString(), { method: 'GET', headers });
    if (!suburbsResponse.ok) return null;

    const suburbs = await suburbsResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;
    const suburb = suburbs.find((entry) => matchesAreaName(suburbName, entry?.name, entry?.alternateNames));
    return pickNumericString(suburb?.id);
  } catch {
    return null;
  }
}

async function resolveSuburbIdFromTextHints(
  apiBase: string,
  headers: Record<string, string>,
  provinceName: string,
  cityName: string,
  textHints: string[],
): Promise<string | null> {
  const normalizedHints = textHints
    .map((value) => normalizeAreaName(value))
    .filter((value) => value.length > 0);

  if (normalizedHints.length === 0) return null;

  try {
    const provincesResponse = await fetch(`${apiBase}/provinces`, { method: 'GET', headers });
    if (!provincesResponse.ok) return null;

    const provinces = await provincesResponse.json() as Array<{ id?: number | string | null; name?: string | null }>;
    const province = provinces.find((entry) => matchesAreaName(provinceName, entry?.name));
    const provinceId = pickNumericString(province?.id);
    if (!provinceId) return null;

    const citiesUrl = new URL(`${apiBase}/cities`);
    citiesUrl.searchParams.set('provinceId', provinceId);
    const citiesResponse = await fetch(citiesUrl.toString(), { method: 'GET', headers });
    if (!citiesResponse.ok) return null;

    const cities = await citiesResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;
    const city = cities.find((entry) => matchesAreaName(cityName, entry?.name, entry?.alternateNames));
    const cityId = pickNumericString(city?.id);
    if (!cityId) return null;

    const suburbsUrl = new URL(`${apiBase}/suburbs`);
    suburbsUrl.searchParams.set('cityId', cityId);
    const suburbsResponse = await fetch(suburbsUrl.toString(), { method: 'GET', headers });
    if (!suburbsResponse.ok) return null;

    const suburbs = await suburbsResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;

    const candidates = suburbs
      .map((entry) => {
        const names = [normalizeAreaName(entry?.name), ...(entry?.alternateNames ?? []).map((item) => normalizeAreaName(item?.name))]
          .filter((value) => value.length > 0);
        const compactNames = [compactAreaName(entry?.name), ...(entry?.alternateNames ?? []).map((item) => compactAreaName(item?.name))]
          .filter((value) => value.length > 0);
        const compactHints = normalizedHints.map((hint) => hint.replace(/\s+/g, ''));
        const bestMatchLength = names.reduce((best, name) => {
          if (name.length < 4) return best;
          return normalizedHints.some((hint) => hint.includes(name)) ? Math.max(best, name.length) : best;
        }, 0);
        const compactMatchLength = compactNames.reduce((best, name) => {
          if (name.length < 4) return best;
          return compactHints.some((hint) => hint.includes(name)) ? Math.max(best, name.length) : best;
        }, 0);
        return {
          id: pickNumericString(entry?.id),
          bestMatchLength: Math.max(bestMatchLength, compactMatchLength),
        };
      })
      .filter((entry): entry is { id: string; bestMatchLength: number } => Boolean(entry.id) && entry.bestMatchLength > 0)
      .sort((left, right) => right.bestMatchLength - left.bestMatchLength);

    return candidates[0]?.id ?? null;
  } catch {
    return null;
  }
}

function getProperty24MetadataConfig(): { apiBase: string; headers: Record<string, string> } | null {
  const p24BaseUrl = env.property24.baseUrl;
  const p24ApiKey = env.property24.apiKey;
  const p24Endpoint = env.property24.listingsEndpoint ?? 'listings';
  const p24UserGroupId = env.property24.userGroupId;

  if (!p24BaseUrl || !p24ApiKey) return null;

  const endpointPrefix = p24Endpoint.replace(/^\/+|\/+$/g, '');
  const apiBase = (endpointPrefix ? `${p24BaseUrl.replace(/\/$/, '')}/${endpointPrefix}` : p24BaseUrl.replace(/\/$/, ''))
    .replace(/\/listings(?:\/)?$/i, '');
  const headers: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
  };
  if (p24UserGroupId) {
    headers['P24-UserGroupId'] = p24UserGroupId;
  }

  return { apiBase, headers };
}

async function getAccessibleProperty24AgencyIds(
  apiBase: string,
  headers: Record<string, string>,
): Promise<string[]> {
  try {
    const response = await fetchWithRetries(
      `${apiBase}/agencies`,
      { method: 'GET', headers },
      { attempts: 2, timeoutMs: 15000 },
    );

    if (!response.ok) return [];

    const payload = await response.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(payload)) return [];

    return payload
      .map((entry) => pickNumericString(entry.id))
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

async function enrichListingPayloadWithResolvedSuburbId(body: Record<string, unknown>): Promise<void> {
  const listingPayload = typeof body.listing_payload === 'object' && body.listing_payload
    ? { ...(body.listing_payload as Record<string, unknown>) }
    : {};

  if (extractLegacySuburbId(listingPayload)) {
    body.listing_payload = listingPayload;
    return;
  }

  const provinceName = toText(body.province);
  const cityName = toText(body.city);
  const suburbName = toText(body.suburb);
  if (!provinceName || !cityName || !suburbName) {
    body.listing_payload = listingPayload;
    return;
  }

  const property24Config = getProperty24MetadataConfig();
  if (!property24Config) {
    body.listing_payload = listingPayload;
    return;
  }

  const suburbId = await resolveSuburbIdFromMetadata(
    property24Config.apiBase,
    property24Config.headers,
    provinceName,
    cityName,
    suburbName,
  );

  if (!suburbId) {
    body.listing_payload = listingPayload;
    return;
  }

  const propertyInfo = listingPayload.propertyInfo && typeof listingPayload.propertyInfo === 'object'
    ? { ...(listingPayload.propertyInfo as Record<string, unknown>) }
    : {};

  body.listing_payload = {
    ...listingPayload,
    propertyInfo: {
      ...propertyInfo,
      suburbId: Number(suburbId),
    },
  };
}

router.get('/property24-suburbs/search', async (req, res) => {
  const p24BaseUrl = env.property24.baseUrl;
  const p24ApiKey = env.property24.apiKey;
  const p24Endpoint = env.property24.listingsEndpoint ?? 'listings';
  const p24UserGroupId = env.property24.userGroupId;

  if (!p24BaseUrl || !p24ApiKey) {
    return res.status(503).json({ error: 'Property24 API is not configured.' });
  }

  const provinceName = toText(req.query.province);
  const cityName = toText(req.query.city);
  const suburbQuery = toText(req.query.q) ?? '';

  if (!provinceName || !cityName) {
    return res.json({ items: [] });
  }

  const endpointPrefix = p24Endpoint.replace(/^\/+|\/+$/g, '');
  const p24BaseRoot = p24BaseUrl.replace(/\/$/, '');
  const listingApiBases = endpointPrefix
    ? [`${p24BaseRoot}/${endpointPrefix}`, p24BaseRoot]
    : [p24BaseRoot];
  const p24AuthHeaders: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
  };
  if (p24UserGroupId) {
    p24AuthHeaders['P24-UserGroupId'] = p24UserGroupId;
  }

  try {
    let provinces: Array<{ id?: number | string | null; name?: string | null }> = [];
    let listingApiBase: string | null = null;
    for (const candidate of listingApiBases) {
      const provincesResponse = await fetch(`${candidate}/provinces`, { method: 'GET', headers: p24AuthHeaders });
      if (!provincesResponse.ok) continue;
      provinces = await provincesResponse.json() as Array<{ id?: number | string | null; name?: string | null }>;
      listingApiBase = candidate;
      break;
    }
    if (!listingApiBase) {
      return res.status(502).json({ error: 'Failed to fetch Property24 provinces.' });
    }

    const province = provinces.find((entry) => matchesAreaName(provinceName, entry?.name));
    const provinceId = pickIdString(province?.id);
    if (!provinceId) return res.json({ items: [] });

    const citiesUrl = new URL(`${listingApiBase}/cities`);
    citiesUrl.searchParams.set('provinceId', provinceId);
    const citiesResponse = await fetch(citiesUrl.toString(), { method: 'GET', headers: p24AuthHeaders });
    if (!citiesResponse.ok) {
      return res.status(502).json({ error: 'Failed to fetch Property24 cities.' });
    }

    const cities = await citiesResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;
    const city = cities.find((entry) => matchesAreaName(cityName, entry?.name, entry?.alternateNames));
    const cityId = pickIdString(city?.id);
    if (!cityId) return res.json({ items: [] });

    const suburbsUrl = new URL(`${listingApiBase}/suburbs`);
    suburbsUrl.searchParams.set('cityId', cityId);
    const suburbsResponse = await fetch(suburbsUrl.toString(), { method: 'GET', headers: p24AuthHeaders });
    if (!suburbsResponse.ok) {
      return res.status(502).json({ error: 'Failed to fetch Property24 suburbs.' });
    }

    const suburbs = await suburbsResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;

    const items = suburbs
      .filter((entry) => areaNameContains(suburbQuery, entry?.name, entry?.alternateNames))
      .map((entry) => ({
        id: pickIdString(entry?.id),
        name: toText(entry?.name),
        city: toText(city?.name),
        province: toText(province?.name),
        alternateNames: (entry?.alternateNames ?? [])
          .map((alternate) => toText(alternate?.name))
          .filter((value): value is string => Boolean(value)),
      }))
      .filter((entry): entry is { id: string; name: string; city: string | null; province: string | null; alternateNames: string[] } => Boolean(entry.id && entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

router.get('/property24-cities/search', async (req, res) => {
  const p24BaseUrl = env.property24.baseUrl;
  const p24ApiKey = env.property24.apiKey;
  const p24Endpoint = env.property24.listingsEndpoint ?? 'listings';
  const p24UserGroupId = env.property24.userGroupId;

  if (!p24BaseUrl || !p24ApiKey) {
    return res.status(503).json({ error: 'Property24 API is not configured.' });
  }

  const provinceName = toText(req.query.province);
  const cityQuery = toText(req.query.q) ?? '';

  if (!provinceName) {
    return res.json({ items: [] });
  }

  const endpointPrefix = p24Endpoint.replace(/^\/+|\/+$/g, '');
  const p24BaseRoot = p24BaseUrl.replace(/\/$/, '');
  const listingApiBases = endpointPrefix
    ? [`${p24BaseRoot}/${endpointPrefix}`, p24BaseRoot]
    : [p24BaseRoot];
  const p24AuthHeaders: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
  };
  if (p24UserGroupId) {
    p24AuthHeaders['P24-UserGroupId'] = p24UserGroupId;
  }

  try {
    let provinces: Array<{ id?: number | string | null; name?: string | null }> = [];
    let listingApiBase: string | null = null;
    for (const candidate of listingApiBases) {
      const provincesResponse = await fetch(`${candidate}/provinces`, { method: 'GET', headers: p24AuthHeaders });
      if (!provincesResponse.ok) continue;
      provinces = await provincesResponse.json() as Array<{ id?: number | string | null; name?: string | null }>;
      listingApiBase = candidate;
      break;
    }
    if (!listingApiBase) {
      return res.status(502).json({ error: 'Failed to fetch Property24 provinces.' });
    }

    const province = provinces.find((entry) => matchesAreaName(provinceName, entry?.name));
    const provinceId = pickIdString(province?.id);
    if (!provinceId) return res.json({ items: [] });

    const citiesUrl = new URL(`${listingApiBase}/cities`);
    citiesUrl.searchParams.set('provinceId', provinceId);
    const citiesResponse = await fetch(citiesUrl.toString(), { method: 'GET', headers: p24AuthHeaders });
    if (!citiesResponse.ok) {
      return res.status(502).json({ error: 'Failed to fetch Property24 cities.' });
    }

    const cities = await citiesResponse.json() as Array<{
      id?: number | string | null;
      name?: string | null;
      alternateNames?: Array<{ name?: string | null }> | null;
    }>;

    const items = cities
      .filter((entry) => areaNameContains(cityQuery, entry?.name, entry?.alternateNames))
      .map((entry) => ({
        id: pickIdString(entry?.id),
        name: toText(entry?.name),
        province: toText(province?.name),
        alternateNames: (entry?.alternateNames ?? [])
          .map((alternate) => toText(alternate?.name))
          .filter((value): value is string => Boolean(value)),
      }))
      .filter((entry): entry is { id: string; name: string; province: string | null; alternateNames: string[] } => Boolean(entry.id && entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));

    return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// GET /property24-provinces — returns P24 province list for address picker
// ---------------------------------------------------------------------------
router.get('/property24-provinces', async (_req, res) => {
  const p24BaseUrl = env.property24.baseUrl;
  const p24ApiKey = env.property24.apiKey;
  const p24Endpoint = env.property24.listingsEndpoint ?? 'listings';
  const p24UserGroupId = env.property24.userGroupId;

  if (!p24BaseUrl || !p24ApiKey) {
    return res.status(503).json({ error: 'Property24 API is not configured.' });
  }

  const endpointPrefix = p24Endpoint.replace(/^\/+|\/+$/g, '');
  const p24BaseRoot = p24BaseUrl.replace(/\/$/, '');
  const listingApiBases = endpointPrefix
    ? [`${p24BaseRoot}/${endpointPrefix}`, p24BaseRoot]
    : [p24BaseRoot];
  const p24AuthHeaders: Record<string, string> = {
    'Authorization': `Basic ${Buffer.from(p24ApiKey, 'utf8').toString('base64')}`,
  };
  if (p24UserGroupId) p24AuthHeaders['P24-UserGroupId'] = p24UserGroupId;

  try {
    let provinces: Array<{ id?: number | string | null; name?: string | null; countryId?: number | string | null }> = [];
    let found = false;
    for (const candidate of listingApiBases) {
      const provincesResponse = await fetch(`${candidate}/provinces`, { method: 'GET', headers: p24AuthHeaders });
      if (!provincesResponse.ok) continue;
      provinces = await provincesResponse.json() as Array<{ id?: number | string | null; name?: string | null; countryId?: number | string | null }>;
      found = true;
      break;
    }
    if (!found) {
      return res.status(502).json({ error: 'Failed to fetch Property24 provinces.' });
    }

    const items = provinces
      .map((entry) => ({ id: pickIdString(entry?.id) ?? String(toText(entry?.name) ?? ''), name: toText(entry?.name) }))
      .filter((entry): entry is { id: string; name: string } => Boolean(entry.id && entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ items });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

// ---------------------------------------------------------------------------
// GET /geocode-address — geocodes assembled address via Google Maps Geocoding API
// Returns lat/lng for a given address string restricted to South Africa
// ---------------------------------------------------------------------------
// Geocode via Nominatim (OpenStreetMap) — no API key required, works from server side.
// Two-segment path avoids collision with existing '/:id' route.
router.get('/geocode-address/search', async (req, res) => {
  const address = toText(req.query.address);
  if (!address) {
    return res.status(400).json({ error: 'address query parameter is required.' });
  }

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('countrycodes', 'za');
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');

    const response = await fetch(url.toString(), {
      headers: {
        // Nominatim requires a descriptive User-Agent per their usage policy.
        'User-Agent': 'KWSA-MApp/1.0 (kwmapp.co.za)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Nominatim returned ${response.status}` });
    }

    const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;

    if (!results || results.length === 0) {
      return res.json({ found: false, status: 'ZERO_RESULTS' });
    }

    const first = results[0];
    return res.json({
      found: true,
      latitude: parseFloat(first.lat),
      longitude: parseFloat(first.lon),
      formattedAddress: first.display_name,
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/:id/publish-to-property24', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const p24BaseUrl = env.property24.baseUrl;
  const p24ApiKey = env.property24.apiKey;
  const p24Endpoint = env.property24.listingsEndpoint ?? 'listings';
  const p24UserGroupId = env.property24.userGroupId;
  const p24DefaultAgencyId = env.property24.defaultAgencyId;

  if (!p24BaseUrl || !p24ApiKey) {
    return res.status(503).json({
      error: 'Property24 API is not configured. Set PROPERTY24_BASE_URL and PROPERTY24_API_KEY.',
    });
  }

  const p24BaseUrlValue = p24BaseUrl;
  const p24ApiKeyValue = p24ApiKey;
  const endpointPrefix = p24Endpoint.replace(/^\/+|\/+$/g, '');
  const buildP24Url = (referenceId?: string | null): string => {
    const base = p24BaseUrlValue.replace(/\/$/, '');
    const withEndpoint = endpointPrefix ? `${base}/${endpointPrefix}` : base;
    return referenceId ? `${withEndpoint}/${encodeURIComponent(referenceId)}` : withEndpoint;
  };

  try {
    // Load the full listing row
    const listingResult = await pool.query(
      `SELECT
        cl.id, cl.source_market_center_id, cl.market_center_id,
        cl.listing_number, cl.property_title, cl.short_title,
        cl.property_description, cl.short_description,
        cl.sale_or_rent, cl.listing_status_tag, cl.status_name,
        cl.property_type, cl.property_sub_type,
        cl.price::text AS price, cl.poa,
        cl.expiry_date,
        cl.address_line, cl.street_number, cl.street_name,
        cl.unit_number, cl.estate_name, cl.erf_number,
        cl.suburb, cl.city, cl.province, cl.country,
        cl.postal_code, cl.longitude::text, cl.latitude::text,
        cl.override_display_location,
        cl.override_display_longitude::text, cl.override_display_latitude::text,
        cl.erf_size::text, cl.floor_area::text,
        cl.rates_and_taxes::text, cl.monthly_levy::text,
        cl.is_furnished, cl.pet_friendly, cl.retirement_living,
        cl.has_flatlet, cl.property_auction,
        cl.no_transfer_duty, cl.occupation_date,
        cl.feed_to_property24, cl.property24_ref1, cl.property24_ref2,
        cl.display_address_on_website,
        cl.listing_images_json, cl.listing_payload,
        cl.mandate_type
       FROM migration.core_listings cl WHERE cl.id = $1 LIMIT 1`,
      [id]
    );

    if (listingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listingResult.rows[0] as Record<string, unknown>;

    const agentResult = await pool.query(
      `SELECT a.id AS associate_id, a.market_center_id, a.source_market_center_id, a.source_team_id,
              a.agent_property24_id, COALESCE(a.full_name, la.agent_name) AS agent_name,
              COALESCE(a.kwsa_email, a.private_email, a.email) AS agent_email,
              COALESCE(a.mobile_number, a.office_number) AS agent_phone,
              la.is_primary, la.sort_order
       FROM migration.listing_agents la
       LEFT JOIN migration.core_associates a ON a.id = la.associate_id
       WHERE la.listing_id = $1
       ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC`,
      [id]
    );

    const primaryAgent = agentResult.rows[0] as
      | {
          associate_id: string | null;
          market_center_id: string | null;
          source_market_center_id: string | null;
          source_team_id: string | null;
          agent_property24_id: string | null;
          agent_name: string | null;
          agent_email: string | null;
          agent_phone: string | null;
        }
      | undefined;

    const marketCenterLookupId =
      toText(listing.market_center_id) ??
      toText(primaryAgent?.market_center_id);

    let marketCenter:
      | {
          id: string | null;
          source_market_center_id: string | null;
          name: string | null;
        }
      | undefined;

    if (marketCenterLookupId) {
      const marketCenterResult = await pool.query(
        `SELECT id::text, source_market_center_id, name
         FROM migration.core_market_centers
         WHERE id::text = $1
         LIMIT 1`,
        [marketCenterLookupId]
      );
      marketCenter = marketCenterResult.rows[0] as typeof marketCenter;
    }

    type MarketCenterAddress = {
      country: string | null;
      province: string | null;
      city: string | null;
      suburb: string | null;
      market_center_property24_id: string | null;
    };

    let marketCenterAddress: MarketCenterAddress | null = null;

    if (marketCenterLookupId) {
      const marketCenterColumnsResult = await pool.query<{ column_name: string }>(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'migration'
          AND table_name = 'core_market_centers'
          AND column_name IN ('country', 'province', 'city', 'suburb', 'market_center_property24_id')
        `
      );

      const marketCenterColumns = new Set(marketCenterColumnsResult.rows.map((row) => row.column_name));
      const optionalColumns = ['country', 'province', 'city', 'suburb', 'market_center_property24_id'];
      const optionalSelect = optionalColumns
        .map((columnName) => (marketCenterColumns.has(columnName) ? `${columnName}::text AS ${columnName}` : `NULL::text AS ${columnName}`))
        .join(',\n               ');

      const marketCenterAddressResult = await pool.query<MarketCenterAddress>(
        `SELECT ${optionalSelect}
         FROM migration.core_market_centers
         WHERE id::text = $1
         LIMIT 1`,
        [marketCenterLookupId]
      );

      marketCenterAddress = marketCenterAddressResult.rows[0] ?? null;
    }

    // Load bedroom/bathroom counts from property areas
    const areasResult = await pool.query(
      `SELECT area_type, MAX(count)::int AS count
       FROM migration.listing_property_areas
       WHERE listing_id = $1
         AND LOWER(TRIM(COALESCE(area_type, ''))) IN ('bedroom', 'bathroom', 'garage', 'parking')
       GROUP BY area_type`,
      [id]
    );

    const areaCounts: Record<string, number> = {};
    for (const row of areasResult.rows as Array<{ area_type: string; count: number }>) {
      areaCounts[row.area_type.toLowerCase().trim()] = row.count ?? 0;
    }

    // Load image URLs (fallback to listing_images table when legacy json cache is empty)
    const imageUrls = await resolveListingImageUrls(pool, id, listing.listing_images_json);

    // Determine existing reference and whether this is a withdraw action
    const existingRef = toText(listing.property24_ref1) ?? toText(listing.property24_ref2);

    const statusTag = (toText(listing.listing_status_tag) ?? '').toLowerCase().trim();
    const statusName = (toText(listing.status_name) ?? '').toLowerCase().trim();

    // Map listing_status_tag → P24 status (mirrors legacy C# GetP24ListingStatus):
    //   Reduced        → "Reduced"
    //   Under Offer    → "Pending"   (P24 uses "Pending" for under-offer/pending-sale)
    //   Sold           → "Sold"
    //   Withdrawn      → "Withdrawn"
    //   Expired        → "Expired"
    //   everything else → "Active"
    let p24Status: string;
    if (statusTag === 'withdrawn' || statusTag === 'withdraw' || statusName === 'withdrawn' || statusName === 'inactive') {
      p24Status = 'Withdrawn';
    } else if (statusTag === 'sold' || statusName === 'sold') {
      p24Status = 'Sold';
    } else if (statusTag === 'under offer' || statusTag === 'pending' || statusTag.includes('offer')) {
      p24Status = 'Pending';
    } else if (statusTag === 'reduced') {
      p24Status = 'Reduced';
    } else if (statusTag === 'expired') {
      p24Status = 'Expired';
    } else {
      p24Status = 'Active';
    }
    const isWithdraw = p24Status === 'Withdrawn';

    const listingType = mapListingTypeToProperty24(listing.sale_or_rent);
    const description = toText(listing.property_description) ?? toText(listing.short_description) ?? '';
    const descriptionHeader =
      toText(listing.property_title) ??
      toText(listing.short_title) ??
      toText(listing.short_description) ??
      description.slice(0, 500);

    // Auto-register any agents that have no P24 ID yet (mirrors legacy C# AddAgentsToP24ForListingFeed)
    for (const agentRow of agentResult.rows as Array<Record<string, unknown>>) {
      if (agentRow.agent_property24_id) continue;
      const assocId = agentRow.associate_id != null ? Number(agentRow.associate_id) : NaN;
      if (!Number.isFinite(assocId)) continue;
      try {
        const mcId = toText(agentRow.source_market_center_id);
        const mcResult = await pool.query<{ market_center_property24_id: string | null }>(
          `SELECT market_center_property24_id FROM migration.core_market_centers
           WHERE source_market_center_id = $1 LIMIT 1`,
          [mcId],
        );
        const rawMcP24 = mcResult.rows[0]?.market_center_property24_id;
        const agencyIdForAgent = rawMcP24 ? Number(rawMcP24) : (p24DefaultAgencyId ? Number(p24DefaultAgencyId) : null);
        const assocResult = await pool.query<{
          first_name: string | null; last_name: string | null; kwsa_email: string | null;
          mobile_number: string | null; office_number: string | null; national_id: string | null;
          ffc_number: string | null; source_associate_id: string | null;
          source_market_center_id: string | null; kwuid: string | null; status_name: string | null;
        }>(
          `SELECT first_name, last_name, kwsa_email, mobile_number, office_number, national_id,
                  ffc_number, source_associate_id, source_market_center_id, kwuid, status_name
           FROM migration.core_associates WHERE id = $1 LIMIT 1`,
          [assocId],
        );
        const ar = assocResult.rows[0];
        if (!ar) continue;
        const jtResult = await pool.query<{ job_title: string }>(
          `SELECT job_title FROM migration.associate_job_titles WHERE associate_id = $1 ORDER BY id ASC`,
          [assocId],
        );
        const jobTitles = jtResult.rows.map((r) => r.job_title);
        const mc2 = mcId ?? '';
        const uid2 = ar.kwuid ?? ar.source_associate_id ?? '';
        const agentBody = {
          firstname: ar.first_name ?? '',
          lastname: ar.last_name ?? '',
          emailAddress: ar.kwsa_email ?? '',
          mobileNumber: (ar.mobile_number ?? '').replace(/[()]/g, ''),
          workNumber: (ar.office_number ?? '').replace(/[()]/g, ''),
          agencyId: agencyIdForAgent ?? 0,
          sourceReference: `KW_${mc2}_${uid2}`.replace(/_+$/, ''),
          fidelityFundCertificationNumber: ar.ffc_number ?? '',
          idNumber: ar.national_id ?? '',
          jobTitle: jobTitles.join(', '),
          published: true,
          receiveStatsMail: true,
          status: 'Active',
        };
        const p24AgentsBase = buildP24Url().replace(/\/listings(?:\/)?$/i, '');
        const p24AuthHdrs: Record<string, string> = {
          'Authorization': `Basic ${Buffer.from(p24ApiKeyValue, 'utf8').toString('base64')}`,
          'Content-Type': 'application/json',
        };
        if (p24UserGroupId) p24AuthHdrs['P24-UserGroupId'] = p24UserGroupId;
        const createResp = await fetch(`${p24AgentsBase}/agents`, {
          method: 'POST',
          headers: p24AuthHdrs,
          body: JSON.stringify(agentBody),
        });
        if (createResp.ok) {
          const newP24Id = Number((await createResp.text()).trim().replace(/[^0-9]/g, ''));
          if (newP24Id > 0) {
            agentRow.agent_property24_id = String(newP24Id);
            await pool.query(
              `UPDATE migration.core_associates
               SET agent_property24_id = $1, property24_status = 'Registered', updated_at = NOW()
               WHERE id = $2`,
              [String(newP24Id), assocId],
            );
            console.info(`[P24] Auto-registered agent ${assocId} → P24 ID ${newP24Id} during listing publish`);
          }
        } else {
          console.warn(`[P24] Auto-register agent ${assocId} during publish HTTP ${createResp.status}: ${(await createResp.text()).slice(0, 200)}`);
        }
      } catch (autoRegErr) {
        console.warn(`[P24] Auto-register agent ${assocId} during publish error:`, autoRegErr);
      }
    }

    const contactAgentIds = agentResult.rows
      .map((row) => pickNumericString((row as Record<string, unknown>).agent_property24_id))
      .filter((value): value is string => Boolean(value));

    const legacySuburbId = extractLegacySuburbId(listing.listing_payload);
    const listingCountryName =
      toText(listing.country) ??
      toText(marketCenterAddress?.country) ??
      'South Africa';
    const listingProvinceName = toText(listing.province) ?? toText(marketCenterAddress?.province);
    const listingCityName = toText(listing.city) ?? toText(marketCenterAddress?.city);
    const listingSuburbName = toText(listing.suburb) ?? toText(marketCenterAddress?.suburb);

    const listingApiBase = buildP24Url().replace(/\/listings(?:\/)?$/i, '');
    const p24AuthHeaders: Record<string, string> = {
      'Authorization': `Basic ${Buffer.from(p24ApiKeyValue, 'utf8').toString('base64')}`,
    };
    if (p24UserGroupId) {
      p24AuthHeaders['P24-UserGroupId'] = p24UserGroupId;
    }

    let resolvedSuburbId = legacySuburbId;
    if (!resolvedSuburbId && listingProvinceName && listingCityName && listingSuburbName) {
      try {
        const suburbUrl = new URL(`${listingApiBase}/suburbs/find`);
        suburbUrl.searchParams.set('countryName', listingCountryName);
        suburbUrl.searchParams.set('provinceName', listingProvinceName);
        suburbUrl.searchParams.set('cityName', listingCityName);
        suburbUrl.searchParams.set('suburbName', listingSuburbName);

        const suburbResponse = await fetch(suburbUrl.toString(), {
          method: 'GET',
          headers: p24AuthHeaders,
        });

        if (suburbResponse.ok) {
          const suburbData = await suburbResponse.json() as {
            found?: boolean;
            suburb?: { id?: number | string | null };
          };
          if (suburbData?.found && suburbData.suburb?.id != null) {
            resolvedSuburbId = pickNumericString(suburbData.suburb.id);
          }
        }
      } catch {
        // Best-effort suburb lookup; publish can continue and fail with explicit API feedback.
      }
    }

    if (!resolvedSuburbId && listingProvinceName && listingCityName && listingSuburbName) {
      resolvedSuburbId = await resolveSuburbIdFromMetadata(
        listingApiBase,
        p24AuthHeaders,
        listingProvinceName,
        listingCityName,
        listingSuburbName,
      );
    }

    if (!resolvedSuburbId && listingProvinceName && listingCityName) {
      resolvedSuburbId = await resolveSuburbIdFromTextHints(
        listingApiBase,
        p24AuthHeaders,
        listingProvinceName,
        listingCityName,
        [
          listingSuburbName ?? '',
          toText(listing.property_title) ?? '',
          toText(listing.short_title) ?? '',
          toText(listing.address_line) ?? '',
          toText(listing.street_name) ?? '',
          toText(listing.estate_name) ?? '',
          toText(marketCenterAddress?.suburb) ?? '',
        ],
      );
    }

    const accessibleAgencyIds = await getAccessibleProperty24AgencyIds(listingApiBase, p24AuthHeaders);
    const preferredAgencyCandidates = [
      // Prefer market-center scoped IDs before falling back to global defaults.
      pickNumericString(marketCenterAddress?.market_center_property24_id),
      pickNumericString(marketCenter?.source_market_center_id),
      pickNumericString(primaryAgent?.source_market_center_id),
      pickNumericString(p24DefaultAgencyId),
    ].filter((value): value is string => Boolean(value));

    const resolvedAgencyId = accessibleAgencyIds.length > 0
      ? preferredAgencyCandidates.find((candidate) => accessibleAgencyIds.includes(candidate)) ?? accessibleAgencyIds[0]
      : preferredAgencyCandidates[0] ?? null;

    const expiryDateValue =
      toDateValue(listing.expiry_date) ??
      new Date(Date.now() + (90 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);

    const propertyTypeId = mapPropertyTypeIdForProperty24(listing.property_type, listing.property_sub_type);
    const resolvedLatitude =
      toBool(listing.override_display_location)
        ? toNumber(listing.override_display_latitude) ?? toNumber(listing.latitude)
        : toNumber(listing.latitude);
    const resolvedLongitude =
      toBool(listing.override_display_location)
        ? toNumber(listing.override_display_longitude) ?? toNumber(listing.longitude)
        : toNumber(listing.longitude);

    const missingFields: string[] = [];
    if (!resolvedAgencyId) missingFields.push('agencyId');
    if (contactAgentIds.length === 0) missingFields.push('contactAgentIds');
    if (!description.trim()) missingFields.push('description');
    if (!expiryDateValue) missingFields.push('expiryDate');
    if (!resolvedSuburbId) missingFields.push('propertyInfo.suburbId');
    if (!marketCenter && !toText(listing.market_center_id)) missingFields.push('listing.market_center_id');

    if (missingFields.length > 0) {
      const prerequisiteMessage = `Property24 publish prerequisites are missing: ${missingFields.join(', ')}`;
      await pool.query(
        `UPDATE migration.core_listings
         SET property24_sync_status = $2, updated_at = NOW()
         WHERE id = $1`,
        [id, prerequisiteMessage.slice(0, 490)]
      );

      return res.status(422).json({
        success: false,
        message: prerequisiteMessage,
        details: {
          missing_fields: missingFields,
          listing_number: toText(listing.listing_number),
          market_center: marketCenter ?? null,
          primary_agent: primaryAgent
            ? {
                name: primaryAgent.agent_name,
                agent_property24_id: primaryAgent.agent_property24_id,
                source_market_center_id: primaryAgent.source_market_center_id,
                source_team_id: primaryAgent.source_team_id,
              }
            : null,
        },
      });
    }

    // Mask secret in logs
    const maskedKey = p24ApiKey.length > 6
      ? `${p24ApiKey.slice(0, 3)}***${p24ApiKey.slice(-3)}`
      : '***';

    const price = Number(listing.price);
    const p24Photos = await selectPhotosForProperty24(imageUrls);

    const p24Payload: Record<string, unknown> = {
      agencyId: Number(resolvedAgencyId),
      contactAgentIds: contactAgentIds.map((value) => Number(value)),
      listingNumber: existingRef ? Number(existingRef) : null,
      listingType,
      status: p24Status,
      price: Number.isFinite(price) && price > 0 ? price : null,
      isPOA: toBool(listing.poa),
      listingVisibility: 'public',
      occupationDate: toDateValue(listing.occupation_date),
      expiryDate: expiryDateValue,
      description,
      descriptionHeader,
      showDays: null,
      photos: p24Photos.length > 0 ? p24Photos : null,
      propertyInfo: {
        showLocation: toBool(listing.display_address_on_website ?? false),
        suburbId: Number(resolvedSuburbId),
        municipalRatesAndTaxes: toNumber(listing.rates_and_taxes) != null
          ? { amount: toNumber(listing.rates_and_taxes), unit: 'TotalPrice' }
          : null,
        monthlyLevy: toNumber(listing.monthly_levy) != null
          ? { amount: toNumber(listing.monthly_levy), unit: 'TotalPrice' }
          : null,
        streetNumber: toText(listing.street_number),
        streetName: toText(listing.street_name),
        sourceReference: toText(listing.listing_number),
        geographicLocation: resolvedLatitude != null && resolvedLongitude != null
          ? { latitude: resolvedLatitude, longitude: resolvedLongitude }
          : null,
        erf: toNumber(listing.erf_size) != null
          ? { size: toNumber(listing.erf_size), areaUnit: 'SquareMetres' }
          : null,
        floorArea: toNumber(listing.floor_area) != null
          ? { size: toNumber(listing.floor_area), areaUnit: 'SquareMetres' }
          : null,
        propertyTypeId,
      },
      propertyFeatures: {
        bedrooms: areaCounts.bedroom ?? 0,
        bathrooms: {
          bathrooms: areaCounts.bathroom ?? 0,
          description: null,
          cleaningService: null,
          unisexBathrooms: null,
          communalBathrooms: null,
          executiveBathrooms: null,
          inUnitBathrooms: null,
        },
        garages: areaCounts.garage ?? 0,
        domesticBathrooms: 0,
        heightRestrictions: null,
        receptionRooms: null,
        studies: 0,
        kitchens: {
          kitchens: 0,
          description: null,
          dishwasher: null,
          cleaningService: null,
          sink: null,
          coffeeMachine: null,
        },
        parking: {
          parkingSpaces: areaCounts.parking ?? 0,
          parkingSpacesDescription: null,
          parkingBayNumber: null,
          carport: null,
          doubleParking: null,
          onStreetParking: null,
          secureParking: null,
          shadeNetCoveredParking: null,
          singleParking: null,
          tandemParking: null,
          tripleParking: null,
          undergroundParking: null,
          visitorsParking: null,
        },
        domesticRooms: 0,
        outsideToilets: 0,
        garden: false,
        pool: false,
        flatlet: toBool(listing.has_flatlet),
        secondHouse: false,
        outBuildingsSize: null,
        bedroomsDescription: '',
        domesticRoomsDescription: '',
        flatDescription: '',
        garagesDescription: '',
        poolDescription: '',
        receptionRoomsDescription: '',
        studiesDescription: '',
        petsAllowed: mapPetsAllowedForProperty24(listing.pet_friendly),
        furnishedStatus: mapFurnishedStatusForProperty24(listing.is_furnished),
        hasStandaloneBuilding: false,
        numberOfFloors: null,
        publicTransport: {
          nearbyBusService: false,
          nearbyMinibusTaxiService: false,
          nearbyTrainService: false,
        },
        internetAccess: {
          adsl: false,
          dialUp: false,
          fibre: false,
          fixedWiMax: false,
          isdn: false,
          satellite: false,
          vdsl: false,
        },
        isWheelchairAccessible: false,
        hasGenerator: false,
        hasBackupWater: false,
        outsideArea: null,
        sustainabilityInfo: {
          solarPanels: false,
          solarGeyser: false,
          gasGeyser: false,
          waterTank: false,
          borehole: false,
          backupBatteryOrInverter: false,
        },
      },
      rentalInfo: null,
      complexInfo: null,
      auctionInfo: toBool(listing.property_auction) ? {} : null,
      commercialInfo: null,
      tags: [],
      featureTags: [],
      developmentId: null,
      lightstoneId: 0,
      repossessed: false,
      youTubeVideoId: null,
      matterportSpaceId: null,
      noTransferCost: toBool(listing.no_transfer_duty),
      ignoreForPriceReducedAlerts: false,
      eyeSpy360Url: null,
      isMultiListing: (toText(listing.mandate_type) ?? '').toLowerCase().includes('multi'),
    };

    const apiUrl = buildP24Url();
    const apiMethod = 'POST';
    const p24Headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...p24AuthHeaders,
    };

    console.info(`[P24] ${apiMethod} ${apiUrl} | listing=${String(listing.listing_number)} | key=${maskedKey}`);

    const p24Response = await fetchWithRetries(
      apiUrl,
      {
        method: apiMethod,
        headers: p24Headers,
        body: JSON.stringify(p24Payload),
      },
      { attempts: 3, timeoutMs: 30000 }
    );

    const responseText = await p24Response.text();

    let responseBody: Record<string, unknown> = {};
    try {
      responseBody = JSON.parse(responseText) as Record<string, unknown>;
    } catch {
      responseBody = { raw: responseText };
    }

    console.info(`[P24] Response HTTP ${p24Response.status}: ${JSON.stringify(responseBody).slice(0, 500)}`);

    if (!p24Response.ok) {
      const failureMessage = `Failed (HTTP ${p24Response.status}): ${responseText.slice(0, 500)}`;
      await pool.query(
        `UPDATE migration.core_listings
         SET property24_sync_status = $2, updated_at = NOW()
         WHERE id = $1`,
        [id, failureMessage]
      );

      console.warn(`[P24] Publish failed for listing ${String(listing.listing_number)}: HTTP ${p24Response.status}`);

      return res.status(422).json({
        success: false,
        message: `Property24 API returned HTTP ${p24Response.status}`,
        http_status: p24Response.status,
        details: responseBody,
      });
    }

    // Extract reference ID from response (P24 returns { isOnPortal, listingNumber, reasons })
    // Note: listingNumber is an integer from P24, so convert to string before toText check
    const toRef = (v: unknown): string | null => {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return String(v);
      return toText(v);
    };
    const returnedRef = (
      toRef(responseBody.listingNumber ?? responseBody.ListingNumber) ??
      toRef(responseBody.Id ?? responseBody.id) ??
      toRef(responseBody.ReferenceNumber ?? responseBody.referenceNumber) ??
      toRef(responseBody.Reference ?? responseBody.reference) ??
      toRef(responseBody.ListingId ?? responseBody.listingId) ??
      existingRef
    );

    const syncStatus = `${p24Status === 'Withdrawn' ? 'Withdrawn' : 'Published'} ${new Date().toISOString().slice(0, 10)}`;

    await pool.query(
      `UPDATE migration.core_listings
       SET property24_ref1 = COALESCE($2, property24_ref1),
           property24_sync_status = $3,
           feed_to_property24 = true,
           is_published = $4,
           is_draft = false,
           updated_at = NOW()
       WHERE id = $1`,
      [id, returnedRef, syncStatus, !isWithdraw]
    );

    console.info(`[P24] ${p24Status} successfully: listing=${String(listing.listing_number)} ref=${returnedRef ?? 'n/a'}`);

    return res.json({
      success: true,
      property24_reference_id: returnedRef,
      message: `${p24Status === 'Withdrawn' ? 'Withdrawn from' : 'Published to'} Property24 successfully${returnedRef ? ` (ref: ${returnedRef})` : ''}.`,
      details: responseBody,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[P24] Publish error:', message);

    // Store error in sync status if possible
    try {
      await pool.query(
        `UPDATE migration.core_listings SET property24_sync_status = $2, updated_at = NOW() WHERE id = $1`,
        [id, `Error: ${message.slice(0, 490)}`]
      );
    } catch {
      // best-effort
    }

    return res.status(500).json({ error: message });
  }
});

// ---------------------------------------------------------------------------
// Publish to Private Property (direct integration)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Private Property helpers
// ---------------------------------------------------------------------------

function xmlEscape(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizePpProvince(province: string): string {
  const key = province.replace(/[\s-]/g, '').toLowerCase();
  const map: Record<string, string> = {
    kwazulunatal: 'KwaZuluNatal',
    gauteng: 'Gauteng',
    westerncape: 'WesternCape',
    northerncape: 'NorthernCape',
    freestate: 'FreeState',
    easterncape: 'EasternCape',
    limpopo: 'Limpopo',
    northwest: 'NorthWest',
    mpumalanga: 'Mpumalanga',
  };
  return map[key] ?? province.replace(/\s/g, '');
}

function normalizeEmailAlias(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) return trimmed;
  const localPart = trimmed.slice(0, atIndex);
  const domainPart = trimmed.slice(atIndex + 1);
  const plusIndex = localPart.indexOf('+');
  if (plusIndex <= 0) return trimmed;
  return `${localPart.slice(0, plusIndex)}@${domainPart}`;
}

function mapPpHomeType(subType: string): string {
  const s = subType.toLowerCase();
  if (['house', 'cluster', 'simplex', 'georgian', 'duet'].some((v) => s.includes(v))) return 'House';
  if (s.includes('townhouse')) return 'Townhouse';
  if (['apartment', 'flat', 'bachelor', 'loft', 'penthouse', 'studio'].some((v) => s.includes(v))) return 'Apartment';
  if (s.includes('duplex')) return 'Duplex';
  if (s.includes('cottage')) return 'Garden Cottage';
  return 'House';
}

function buildPpToken(username: string, password: string): { Digest: string; UserName: string; StampTime: string; Expires: string; UID: string } {
  const uid = Math.floor(Math.random() * 9000000 + 1000000).toString();
  const tokenTime = new Date(Date.now() - 5 * 60 * 1000);
  const stampTime = tokenTime.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expires = new Date(tokenTime.getTime() + 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const digestString = `${uid}${stampTime}${password}${expires}`;
  const digest = createHash('sha1').update(Buffer.from(digestString, 'ascii')).digest('base64');
  return { Digest: digest, UserName: username, StampTime: stampTime, Expires: expires, UID: uid };
}

function buildPpTokenXml(t: { Digest: string; UserName: string; StampTime: string; Expires: string; UID: string }): string {
  return `<Token><Digest>${t.Digest}</Digest><UserName>${t.UserName}</UserName><StampTime>${t.StampTime}</StampTime><Expires>${t.Expires}</Expires><UID>${t.UID}</UID></Token>`;
}

function replacePpTokenXml(soapXml: string, token: { Digest: string; UserName: string; StampTime: string; Expires: string; UID: string }): string {
  return soapXml.replace(/<Token>[\s\S]*?<\/Token>/i, buildPpTokenXml(token));
}

function extractPpReference(raw: string): string | null {
  const text = raw ?? '';
  const byUrl = text.match(/\/((?:T)\d{5,})\b/i)?.[1];
  if (byUrl) return byUrl.toUpperCase();
  const byTag = text.match(/>(T\d{5,})</i)?.[1];
  if (byTag) return byTag.toUpperCase();
  const byPlain = text.match(/\b(T\d{5,})\b/i)?.[1];
  return byPlain ? byPlain.toUpperCase() : null;
}

async function fetchPpReferenceByUniqueId(args: {
  ppBaseUrl: string;
  ppUsername: string;
  ppPassword: string;
  branchGuid: string;
  uniqueId: string;
}): Promise<string | null> {
  const lookupFromEndpoint = async (endpoint: string): Promise<string | null> => {
    const token = buildPpToken(args.ppUsername, args.ppPassword);
    const soapXml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetActiveListings xmlns="http://tempuri.org/"><BranchId>${args.branchGuid}</BranchId>${buildPpTokenXml(token)}</GetActiveListings></soap:Body></soap:Envelope>`;
    const response = await fetchWithRetries(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/GetActiveListings' },
      body: soapXml,
    }, { attempts: 2, timeoutMs: 30000 });
    const text = await response.text();

    const blockRegex = /<ActiveListing[^>]*>([\s\S]*?)<\/ActiveListing>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(text)) !== null) {
      const block = match[1];
      const uniqueId = block.match(/<UniqueId[^>]*>([^<]*)<\/UniqueId>/i)?.[1]?.trim();
      const ppRef = block.match(/<PrivatePropertyRef[^>]*>([^<]*)<\/PrivatePropertyRef>/i)?.[1]?.trim();
      if (uniqueId && uniqueId.toLowerCase() === args.uniqueId.toLowerCase()) {
        const normalized = ppRef?.toUpperCase() ?? '';
        return /^T\d{5,}$/i.test(normalized) ? normalized : null;
      }
    }
    return null;
  };

  const primary = await lookupFromEndpoint(args.ppBaseUrl);
  if (primary) return primary;

  const canonical = 'https://services.privateproperty.co.za/pplsystems/agentimport/agentimport.asmx';
  if (args.ppBaseUrl.toLowerCase() !== canonical) {
    return lookupFromEndpoint(canonical);
  }

  return null;
}

async function fetchPpListingStatus(args: {
  ppBaseUrl: string;
  ppUsername: string;
  ppPassword: string;
  branchGuid: string;
  propertyId: string;
}): Promise<string | null> {
  const token = buildPpToken(args.ppUsername, args.ppPassword);
  const soapXml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetListingStatus xmlns="http://tempuri.org/"><BranchId>${args.branchGuid}</BranchId><PropertyId>${xmlEscape(args.propertyId)}</PropertyId>${buildPpTokenXml(token)}</GetListingStatus></soap:Body></soap:Envelope>`;

  const response = await fetchWithRetries(args.ppBaseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/GetListingStatus' },
    body: soapXml,
  }, { attempts: 2, timeoutMs: 30000 });
  const text = await response.text();
  const fault = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim() ?? '';
  if (fault) return null;
  const status = text.match(/<GetListingStatusResult[^>]*>([\s\S]*?)<\/GetListingStatusResult>/i)?.[1]?.trim() ?? '';
  return status || null;
}

// ---------------------------------------------------------------------------
// POST /:id/publish-to-private-property
// ---------------------------------------------------------------------------

router.post('/:id/publish-to-private-property', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const ppBaseUrl = env.privateProperty.baseUrl;
  const ppUsername = env.privateProperty.username;
  const ppPassword = env.privateProperty.password;
  const ppPasswordAlt = env.privateProperty.passwordAlt;
  const ppDefaultBranchGuid = env.privateProperty.branchGuid;
  const ppPasswordCandidates = [ppPassword, ppPasswordAlt]
    .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

  if (!ppBaseUrl || !ppUsername || !ppPassword) {
    return res.status(501).json({
      success: false,
      message: 'Private Property integration is not configured. Set PRIVATE_PROPERTY_BASE_URL, PRIVATE_PROPERTY_USERNAME, and PRIVATE_PROPERTY_PASSWORD.',
    });
  }

  try {
    const listingResult = await pool.query(
      `SELECT cl.id, cl.listing_number, cl.market_center_id, cl.source_market_center_id,
        cl.property_title, cl.property_description, cl.short_description,
        cl.sale_or_rent, cl.listing_status_tag, cl.status_name,
        cl.property_type, cl.property_sub_type,
        cl.price::text AS price, cl.poa,
        cl.occupation_date,
        cl.street_number, cl.street_name, cl.unit_number, cl.estate_name,
        cl.suburb, cl.city, cl.province,
        cl.longitude::text, cl.latitude::text,
        cl.override_display_location,
        cl.override_display_longitude::text, cl.override_display_latitude::text,
        cl.erf_size::text, cl.floor_area::text,
        cl.rates_and_taxes::text, cl.monthly_levy::text,
        cl.is_furnished, cl.pet_friendly, cl.has_flatlet,
        cl.feed_to_private_property, cl.private_property_ref1, cl.private_property_ref2,
        cl.display_address_on_website,
        cl.mandate_type, cl.listing_images_json
       FROM migration.core_listings cl WHERE cl.id = $1 LIMIT 1`,
      [id]
    );

    if (listingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listingResult.rows[0] as Record<string, unknown>;

    const agentResult = await pool.query(
      `SELECT la.associate_id::text, la.is_primary, la.sort_order,
              a.market_center_id::text AS market_center_id,
              a.source_associate_id::text AS source_associate_id,
              a.private_email,
              a.kwsa_email,
              a.email,
              a.first_name,
              a.last_name,
              a.mobile_number,
              a.image_url
       FROM migration.listing_agents la
       LEFT JOIN migration.core_associates a ON a.id = la.associate_id
       WHERE la.listing_id = $1
       ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC`,
      [id]
    );

    const primaryAgent = agentResult.rows[0] as {
      associate_id: string | null;
      market_center_id: string | null;
      source_associate_id: string | null;
      private_email: string | null;
      kwsa_email: string | null;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      mobile_number: string | null;
      image_url: string | null;
    } | undefined;
    // market_center_id retained for potential future use but not used for PP branch selection
    void toText(listing.market_center_id);
    void toText(primaryAgent?.market_center_id);

    const buildAgentCandidates = (): string[] => {
      const kwsaEmail = toText(primaryAgent?.kwsa_email);
      const publicEmail = toText(primaryAgent?.email);
      const privateEmail = toText(primaryAgent?.private_email);
      const kwsaEmailNoAlias = normalizeEmailAlias(kwsaEmail);
      const publicEmailNoAlias = normalizeEmailAlias(publicEmail);
      const privateEmailNoAlias = normalizeEmailAlias(privateEmail);
      return [
        kwsaEmail,
        kwsaEmailNoAlias,
        publicEmail,
        publicEmailNoAlias,
        privateEmail,
        privateEmailNoAlias,
        toText(primaryAgent?.source_associate_id),
        toText(primaryAgent?.associate_id),
      ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
    };

    // Resolve branch GUID: prefer MC-specific private_property_id, fall back to env default.
    // All KW MC GUIDs in the PP system table are valid live branches.
    let branchGuid = ppDefaultBranchGuid ?? '';
    const mcLookupId = toText(listing.market_center_id) ?? toText(primaryAgent?.market_center_id);
    if (mcLookupId) {
      try {
        const mcRes = await pool.query(
          `SELECT private_property_id::text AS pp_id FROM migration.core_market_centers WHERE id::text = $1 LIMIT 1`,
          [mcLookupId]
        );
        const mcPpId = toText((mcRes.rows[0] as { pp_id?: string } | undefined)?.pp_id);
        if (mcPpId && /^[0-9a-f-]{36}$/i.test(mcPpId)) branchGuid = mcPpId;
      } catch { /* fall back to default */ }
    }

    if (!branchGuid) {
      return res.status(400).json({ success: false, message: 'No Private Property Branch GUID configured (PRIVATE_PROPERTY_BRANCH_GUID env var).' });
    }

    const areasResult = await pool.query(
      `SELECT LOWER(TRIM(area_type)) AS area_type, MAX(count)::int AS count
       FROM migration.listing_property_areas
       WHERE listing_id = $1
         AND LOWER(TRIM(COALESCE(area_type, ''))) IN ('bedroom', 'bathroom', 'garage')
       GROUP BY LOWER(TRIM(area_type))`,
      [id]
    );
    const areaCounts: Record<string, number> = {};
    for (const row of areasResult.rows as Array<{ area_type: string; count: number }>) {
      areaCounts[row.area_type] = row.count ?? 0;
    }

    const statusTag = (toText(listing.listing_status_tag) ?? '').toLowerCase().trim();
    const statusName = (toText(listing.status_name) ?? '').toLowerCase().trim();
    const isWithdraw =
      statusTag === 'withdrawn' || statusTag === 'withdraw' ||
      statusName === 'withdrawn' || statusName === 'inactive';

    const existingRef = toText(listing.private_property_ref1) ?? toText(listing.private_property_ref2);
    const existingRefNormalized = (existingRef ?? '').trim();
    const existingRefUsable = /^T\d{5,}$/i.test(existingRefNormalized) ? existingRefNormalized.toUpperCase() : null;
    const propertyId = toText(listing.listing_number) ?? id.toString();
    const listingType = mapListingTypeToProperty24(listing.sale_or_rent);
    let activePpPassword = ppPassword;
    const token = buildPpToken(ppUsername, activePpPassword);
    const tokenXml = buildPpTokenXml(token);
    let ppAgentIdUsed: string | null = null;

    let soapXml: string;
    let soapAction: string;

    if (isWithdraw && existingRef) {
      // PP ListingStatusUpdate uses our unique listing id (KWLM...), not PP ref (T...).
      soapAction = 'ListingStatusUpdate';
      soapXml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ListingStatusUpdate xmlns="http://tempuri.org/"><BranchId>${branchGuid}</BranchId><PropertyId>${xmlEscape(propertyId)}</PropertyId><ListingType>${listingType}</ListingType><PropertyStatus>Inactive</PropertyStatus>${tokenXml}</ListingStatusUpdate></soap:Body></soap:Envelope>`;
    } else {
      // Build UpdateListing payload
      const imageResolution = await resolveExternalImageUrls(
        (await resolveListingImageUrls(pool, id, listing.listing_images_json)).slice(0, 30),
        req
      );
      const imageUrls = imageResolution.urls;
      if (imageUrls.length === 0) {
        const failureHint = imageResolution.failures.slice(0, 3).join(' | ');
        return res.status(422).json({
          success: false,
          message: 'No externally reachable image URLs available for Private Property. Configure UPLOADS_PUBLIC_BASE_URL or ensure images are stored in public GCS. If using local images + GCS storage, set up ADC with: gcloud.cmd auth application-default login.',
          portal: 'PrivateProperty',
          details: failureHint || undefined,
        });
      }
      const photoUrlsXml = imageUrls.map((u) => `<string>${xmlEscape(u)}</string>`).join('');

      const rawSubType = (toText(listing.property_sub_type) ?? '').toLowerCase();
      let category = 'Residential';
      if (rawSubType.includes('commercial') || rawSubType.includes('business') || rawSubType.includes('industrial')) category = 'Commercial';
      else if (rawSubType.includes('farm')) category = 'Farms';
      else if (rawSubType.includes('land') || rawSubType.includes('vacant')) category = 'Land';

      let propertyStatus = listingType === 'Rental' ? 'ToLet' : 'ForSale';
      if (statusTag.includes('sold') || statusName.includes('sold')) propertyStatus = 'Sold';
      else if (statusTag.includes('pending') || statusTag.includes('offer')) propertyStatus = 'PendingOffer';

      const rawMandate = (toText(listing.mandate_type) ?? '').toLowerCase();
      const mandateType = (rawMandate.includes('sole') || rawMandate.includes('exclusive')) ? 'FullMandate' : 'OpenMandate';

      const province = normalizePpProvince(toText(listing.province) ?? '');
      const addressHierarchyXml = `<Suburb>${xmlEscape(toText(listing.suburb) ?? '')}</Suburb><Town>${xmlEscape(toText(listing.city) ?? '')}</Town><Province>${xmlEscape(province)}</Province>`;

      const price = toNumber(listing.price) ?? 0;
      const pricePresentation = toBool(listing.poa) ? 'Poa' : 'Standard';

      // Deposit for rentals
      const deposit = toNumber(listing.monthly_levy) ?? 0;
      const depositXml = listingType === 'Rental' && deposit > 0 ? `<Deposit>${deposit}</Deposit>` : '';

      // AvailableFrom for rentals
      const occupationDate = toDateValue(listing.occupation_date);
      const availableFromXml = listingType === 'Rental' && occupationDate ? `<AvailableFrom>${occupationDate}</AvailableFrom>` : '';

      // Coordinates
      const useOverride = toBool(listing.override_display_location);
      const xCoord = useOverride ? toNumber(listing.override_display_longitude) : toNumber(listing.longitude);
      const yCoord = useOverride ? toNumber(listing.override_display_latitude) : toNumber(listing.latitude);
      const xCoordXml = xCoord != null ? `<XCoordinate>${xCoord}</XCoordinate>` : '';
      const yCoordXml = yCoord != null ? `<YCoordinate>${yCoord}</YCoordinate>` : '';

      // Build attributes
      const attrs: Array<{ type: string; value: string }> = [];
      if (category === 'Residential') {
        attrs.push({ type: 'Bedrooms', value: (areaCounts['bedroom'] ?? 0).toString() });
        attrs.push({ type: 'Bathrooms', value: (areaCounts['bathroom'] ?? 0).toString() });
        attrs.push({ type: 'HomeType', value: mapPpHomeType(rawSubType) });
      }
      if (category === 'Land') {
        attrs.push({ type: 'LandArea', value: Math.round(toNumber(listing.erf_size) ?? 0).toString() });
      }
      if (category === 'Farms') {
        attrs.push({ type: 'FarmType', value: 'Farm' });
      }
      if (areaCounts['garage'] > 0) attrs.push({ type: 'Garages', value: areaCounts['garage'].toString() });
      const floorArea = toNumber(listing.floor_area);
      if (floorArea && floorArea > 0) attrs.push({ type: 'FloorArea', value: Math.round(floorArea).toString() });
      const erfSize = toNumber(listing.erf_size);
      if (erfSize && erfSize > 0 && category !== 'Land') attrs.push({ type: 'LandArea', value: Math.round(erfSize).toString() });
      const rates = toNumber(listing.rates_and_taxes);
      if (rates && rates > 0) attrs.push({ type: 'Rates', value: Math.round(rates).toString() });
      const levies = toNumber(listing.monthly_levy);
      if (levies && levies > 0) attrs.push({ type: 'Levies', value: Math.round(levies).toString() });
      if (toBool(listing.pet_friendly)) attrs.push({ type: 'PetsAllowed', value: 'Yes' });
      if (toBool(listing.is_furnished)) attrs.push({ type: 'Furnished', value: 'Yes' });
      if (toBool(listing.has_flatlet)) attrs.push({ type: 'Flatlet', value: 'Yes' });
      const attributesXml = attrs.map((a) => `<Attribute><AttributeType>${xmlEscape(a.type)}</AttributeType><Value>${xmlEscape(a.value)}</Value></Attribute>`).join('');

      // PP uses the numeric associate_id as AgentId (same as legacy MAPP system).
      const agentIdStr = toText(primaryAgent?.associate_id) ?? '';
      ppAgentIdUsed = agentIdStr || null;

      // Ensure the agent exists in PP before publishing the listing.
      // This mirrors the legacy EnsureAgentsExistAsync() step.
      if (agentIdStr) {
        const agentEmail = toText(primaryAgent?.kwsa_email) ?? toText(primaryAgent?.email) ?? toText(primaryAgent?.private_email) ?? '';
        const agentFirstName = toText(primaryAgent?.first_name) ?? '';
        const agentLastName = toText(primaryAgent?.last_name) ?? '';
        const agentPhone = toText(primaryAgent?.mobile_number) ?? '';
        const agentToken = buildPpToken(ppUsername, ppPassword);
        const agentTokenXml = buildPpTokenXml(agentToken);
        const updateAgentSoap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><UpdateAgent xmlns="http://tempuri.org/"><Agent><Email>${xmlEscape(agentEmail)}</Email><FirstName>${xmlEscape(agentFirstName)}</FirstName><LastName>${xmlEscape(agentLastName)}</LastName><AgentId>${xmlEscape(agentIdStr)}</AgentId><PrivysealAlias></PrivysealAlias><Active>true</Active><TelCell>${xmlEscape(agentPhone)}</TelCell><TelHome></TelHome><TelWork>${xmlEscape(agentPhone)}</TelWork><BranchId>${branchGuid}</BranchId></Agent>${agentTokenXml}</UpdateAgent></soap:Body></soap:Envelope>`;
        try {
          await fetchWithRetries(ppBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://tempuri.org/UpdateAgent' },
            body: updateAgentSoap,
          }, { attempts: 2, timeoutMs: 20000 });
        } catch {
          // Non-fatal: UpdateAgent failure should not block listing publish attempt
        }

        // Call GetAgents to find PP's internal PrivatePropertyAgentId for this agent,
        // then call UpdateUniqueAgentId to link our associate_id to that PP-internal ID.
        // This is the key step from the old implementation notes: "I just used the encrypted
        // value for PrivatePropertyAgentId which I received with GetAgents."
        try {
          const getAgentsToken = buildPpToken(ppUsername, ppPassword);
          const getAgentsSoap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetAgents xmlns="http://tempuri.org/"><BranchId>${branchGuid}</BranchId>${buildPpTokenXml(getAgentsToken)}</GetAgents></soap:Body></soap:Envelope>`;
          const getAgentsResp = await fetchWithRetries(ppBaseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://tempuri.org/GetAgents' },
            body: getAgentsSoap,
          }, { attempts: 2, timeoutMs: 20000 });
          const getAgentsText = await getAgentsResp.text();
          // Parse agent entries; match by email or AgentId
          const agentRegex = /<PrivatePropertyAgent[^>]*>([\s\S]*?)<\/PrivatePropertyAgent>/gi;
          let agentMatch: RegExpExecArray | null;
          while ((agentMatch = agentRegex.exec(getAgentsText)) !== null) {
            const block = agentMatch[1];
            const ppAgentId = block.match(/<PrivatePropertyAgentId[^>]*>([^<]*)<\/PrivatePropertyAgentId>/i)?.[1]?.trim();
            const ppEmail = block.match(/<Email[^>]*>([^<]*)<\/Email>/i)?.[1]?.trim()?.toLowerCase();
            const ppAgentCustomId = block.match(/<AgentId[^>]*>([^<]*)<\/AgentId>/i)?.[1]?.trim();
            const emailMatches = agentEmail && ppEmail === agentEmail.toLowerCase();
            const alreadyLinked = ppAgentCustomId === agentIdStr;
            if (ppAgentId && emailMatches && !alreadyLinked) {
              // Link PP's internal ID to our numeric associate_id
              const linkToken = buildPpToken(ppUsername, ppPassword);
              const linkSoap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><UpdateUniqueAgentID xmlns="http://tempuri.org/"><PrivatePropertyAgentId>${xmlEscape(ppAgentId)}</PrivatePropertyAgentId><AgentId>${xmlEscape(agentIdStr)}</AgentId>${buildPpTokenXml(linkToken)}</UpdateUniqueAgentID></soap:Body></soap:Envelope>`;
              await fetchWithRetries(ppBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://tempuri.org/UpdateUniqueAgentID' },
                body: linkSoap,
              }, { attempts: 2, timeoutMs: 20000 });
              break;
            }
          }
        } catch {
          // Non-fatal: agent linking failure does not block publish
        }

        // Sync agent profile image when available.
        // PP expects an externally reachable absolute URL.
        try {
          const rawAgentImage = toText(primaryAgent?.image_url);
          if (rawAgentImage) {
            const resolvedAgentImageUrls = await resolveExternalImageUrls([rawAgentImage], req);
            const resolvedAgentImageUrl = resolvedAgentImageUrls.urls[0] ?? null;
            if (resolvedAgentImageUrl) {
              const imageToken = buildPpToken(ppUsername, activePpPassword);
              const updateAgentImageSoap = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><UpdateAgentImage xmlns="http://tempuri.org/"><Agent><Email>${xmlEscape(agentEmail)}</Email><FirstName>${xmlEscape(agentFirstName)}</FirstName><LastName>${xmlEscape(agentLastName)}</LastName><AgentId>${xmlEscape(agentIdStr)}</AgentId><Active>true</Active><TelCell>${xmlEscape(agentPhone)}</TelCell><TelHome></TelHome><TelWork>${xmlEscape(agentPhone)}</TelWork><BranchId>${branchGuid}</BranchId></Agent><imgurl>${xmlEscape(resolvedAgentImageUrl)}</imgurl>${buildPpTokenXml(imageToken)}</UpdateAgentImage></soap12:Body></soap12:Envelope>`;
              await fetchWithRetries(ppBaseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
                body: updateAgentImageSoap,
              }, { attempts: 2, timeoutMs: 20000 });
            }
          }
        } catch {
          // Non-fatal: image sync failure should not block listing publish
        }
      }

      const headline = xmlEscape(toText(listing.property_title) ?? '');
      const description = toText(listing.property_description) ?? toText(listing.short_description) ?? '';

      // When "Display Address on Website" is not checked, instruct PP to hide street-level address details.
      const hideAddress = !toBool(listing.display_address_on_website ?? false);

      soapAction = 'UpdateListing';
      soapXml = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><UpdateListing xmlns="http://tempuri.org/"><ListingImport><PropertyId>${xmlEscape(propertyId)}</PropertyId><BranchId>${branchGuid}</BranchId><Category><Category>${category}</Category></Category><MandateType>${mandateType}</MandateType><StreetName>${xmlEscape(toText(listing.street_name) ?? '')}</StreetName><StreetNumber>${xmlEscape(toText(listing.street_number) ?? '')}</StreetNumber><ComplexName>${xmlEscape(toText(listing.estate_name) ?? '')}</ComplexName><UnitNumber>${xmlEscape(toText(listing.unit_number) ?? '')}</UnitNumber>${addressHierarchyXml}<Headline>${headline}</Headline><Description><![CDATA[${description}]]></Description><Price>${price}</Price><SalesPricePresentation>${pricePresentation}</SalesPricePresentation>${depositXml}<ListingDate>${new Date().toISOString().slice(0, 10)}</ListingDate>${availableFromXml}<AgentId>${xmlEscape(agentIdStr)}</AgentId><PhotoUrls>${photoUrlsXml}</PhotoUrls>${xCoordXml}${yCoordXml}<ListingType>${listingType}</ListingType><PropertyStatus>${propertyStatus}</PropertyStatus><Attributes>${attributesXml}</Attributes><HideStreetName>${hideAddress}</HideStreetName><HideStreetNo>${hideAddress}</HideStreetNo><HideComplexName>${hideAddress}</HideComplexName><HideUnitNumber>${hideAddress}</HideUnitNumber></ListingImport>${tokenXml}</UpdateListing></soap:Body></soap:Envelope>`;
    }

    // Send SOAP request
    const isSoap12 = soapXml.includes('soap12:Envelope');
    const contentType = isSoap12 ? 'application/soap+xml' : 'text/xml';
    const soapHeaders: Record<string, string> = { 'Content-Type': `${contentType}; charset=utf-8` };
    if (!isSoap12) soapHeaders['SOAPAction'] = `http://tempuri.org/${soapAction}`;

    const ppUrls = [
      ppBaseUrl,
      ppBaseUrl.includes('services.sandbox.pp.co.za')
        ? ppBaseUrl.replace('services.sandbox.pp.co.za', 'services.privateproperty.co.za')
        : null,
    ].filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);

    let ppResponse: Response | null = null;
    let responseText = '';
    let lastTransportError: unknown = null;
    let activePpUrl = ppBaseUrl;

    for (const candidateUrl of ppUrls) {
      try {
        const candidateResponse = await fetchWithRetries(candidateUrl, {
          method: 'POST',
          headers: soapHeaders,
          body: soapXml,
        }, { attempts: 2, timeoutMs: 30000 });
        ppResponse = candidateResponse;
        responseText = await candidateResponse.text();
        activePpUrl = candidateUrl;
        lastTransportError = null;
        break;
      } catch (error) {
        lastTransportError = error;
      }
    }

    if (!ppResponse) {
      const transportMessage = lastTransportError instanceof Error ? lastTransportError.message : String(lastTransportError ?? 'Unknown network error');
      return res.status(502).json({
        success: false,
        message: `Private Property endpoint unreachable (${transportMessage}).`,
        portal: 'PrivateProperty',
        details: {
          attemptedEndpoints: ppUrls,
        },
      });
    }

    // PP occasionally rotates or differentiates credentials. If token auth fails (PP100),
    // retry once with the alternate configured password by replacing only the token block.
    if (
      /PP100|Security token did not authenticate properly/i.test(responseText) &&
      ppPasswordCandidates.length > 1
    ) {
      const retryPassword = ppPasswordCandidates.find((value) => value !== activePpPassword);
      if (retryPassword) {
        activePpPassword = retryPassword;
        const retryToken = buildPpToken(ppUsername, activePpPassword);
        soapXml = replacePpTokenXml(soapXml, retryToken);

        const retryResponse = await fetchWithRetries(activePpUrl, {
          method: 'POST',
          headers: soapHeaders,
          body: soapXml,
        }, { attempts: 2, timeoutMs: 30000 });

        ppResponse = retryResponse;
        responseText = await retryResponse.text();
      }
    }

    // Parse result
    let success = false;
    let ppRef: string | null = null;
    let message = '';
    let refSource: 'result' | 'responseText' | 'existing' | 'activeListingsLookup' | 'none' = 'none';
    let referenceLookupTried = false;
    let referenceLookupFound = false;
    let persistedReference: string | null = null;

    const callPpStatusUpdate = async (propertyStatus: 'Inactive' | 'Archived'): Promise<{ ok: boolean; result: string; fault: string; text: string }> => {
      const statusToken = buildPpToken(ppUsername, activePpPassword);
      const statusSoap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ListingStatusUpdate xmlns="http://tempuri.org/"><BranchId>${branchGuid}</BranchId><PropertyId>${xmlEscape(propertyId)}</PropertyId><ListingType>${listingType}</ListingType><PropertyStatus>${propertyStatus}</PropertyStatus>${buildPpTokenXml(statusToken)}</ListingStatusUpdate></soap:Body></soap:Envelope>`;
      const statusResponse = await fetchWithRetries(activePpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/ListingStatusUpdate',
        },
        body: statusSoap,
      }, { attempts: 2, timeoutMs: 30000 });
      const statusText = await statusResponse.text();
      const statusResult = statusText.match(/<ListingStatusUpdateResult[^>]*>([\s\S]*?)<\/ListingStatusUpdateResult>/i)?.[1]?.trim() ?? '';
      const statusFault = statusText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i)?.[1]?.trim() ?? '';
      const lowered = statusResult.toLowerCase();
      const explicitFailure = /error|fault|not found|does not exist|invalid/.test(lowered);
      const ok = !statusFault && !explicitFailure && (lowered.includes('success') || statusResult === '');
      return { ok, result: statusResult, fault: statusFault, text: statusText };
    };

    const faultMatch = responseText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    const faultText = faultMatch?.[1]?.trim() ?? '';

    if (isWithdraw) {
      const match = responseText.match(/<ListingStatusUpdateResult[^>]*>([\s\S]*?)<\/ListingStatusUpdateResult>/i);
      const result = match?.[1]?.trim() ?? '';
      const lowered = result.toLowerCase();
      const explicitFailure = /error|fault|not found|does not exist|invalid/.test(lowered);
      success = !faultText && !explicitFailure && (lowered.includes('success') || result === '');
      message = faultText || result || (success ? 'Withdrawn successfully' : 'Withdraw failed');

      if (success) {
        try {
          const stillActiveRef = await fetchPpReferenceByUniqueId({
            ppBaseUrl: activePpUrl,
            ppUsername,
            ppPassword: activePpPassword,
            branchGuid,
            uniqueId: propertyId,
          });

          if (stillActiveRef) {
            const archived = await callPpStatusUpdate('Archived');
            if (archived.ok) {
              responseText = archived.text;
              message = archived.result || 'Withdrawn successfully';
              const stillActiveAfterArchive = await fetchPpReferenceByUniqueId({
                ppBaseUrl: activePpUrl,
                ppUsername,
                ppPassword: activePpPassword,
                branchGuid,
                uniqueId: propertyId,
              });
              success = !stillActiveAfterArchive;
              if (!success) {
                message = 'PP accepted withdraw request but listing is still active after archival retry.';
              }
            } else {
              success = false;
              message = archived.fault || archived.result || 'PP archival retry failed.';
            }
          }

          if (!success) {
            const ppStatus = await fetchPpListingStatus({
              ppBaseUrl: activePpUrl,
              ppUsername,
              ppPassword: activePpPassword,
              branchGuid,
              propertyId,
            });
            const normalizedStatus = (ppStatus ?? '').toLowerCase();
            if (normalizedStatus === 'inactive' || normalizedStatus === 'archived') {
              success = true;
              message = `Withdrawn successfully (PP status ${ppStatus}; active feed may still be catching up).`;
            }
          }
        } catch {
          // Non-fatal verification issue; keep original withdraw result.
        }
      }
    } else {
      const match = responseText.match(/<UpdateListingResult[^>]*>([\s\S]*?)<\/UpdateListingResult>/i);
      const result = match?.[1]?.trim() ?? '';
      if (faultText || result.toLowerCase().includes('error') || result.toLowerCase().includes('fault')) {
        message = faultText || result;
        success = false;
      } else if (result.toLowerCase().includes('success') || result === '' || ppResponse.ok) {
        success = true;
        const fromResult = extractPpReference(result);
        const fromResponse = extractPpReference(responseText);
        const fromExisting = existingRef;
        ppRef = fromResult ?? fromResponse ?? fromExisting;
        refSource = fromResult ? 'result' : fromResponse ? 'responseText' : fromExisting ? 'existing' : 'none';
        message = result || 'Published successfully';
      } else {
        message = faultText || result;
        success = false;
      }
    }

    // Some PP accounts link agents under a default branch GUID only.
    // If the first attempt fails with PP102, retry once using the configured default branch.
    if (
      !success &&
      !isWithdraw &&
      /PP102|agent associated to this listing does not exist/i.test(message) &&
      ppDefaultBranchGuid &&
      ppDefaultBranchGuid !== branchGuid &&
      ppAgentIdUsed
    ) {
      const retrySoapXml = soapXml
        .replace(/<BranchId>[\s\S]*?<\/BranchId>/i, `<BranchId>${ppDefaultBranchGuid}</BranchId>`)
        .replace(/<AgentId>[\s\S]*?<\/AgentId>/i, `<AgentId>${xmlEscape(ppAgentIdUsed)}</AgentId>`);

      const retryResponse = await fetchWithRetries(activePpUrl, {
        method: 'POST',
        headers: soapHeaders,
        body: retrySoapXml,
      }, { attempts: 2, timeoutMs: 30000 });

      const retryText = await retryResponse.text();
      responseText = retryText;
      const retryFaultMatch = retryText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
      const retryFaultText = retryFaultMatch?.[1]?.trim() ?? '';
      const retryResultMatch = retryText.match(/<UpdateListingResult[^>]*>([\s\S]*?)<\/UpdateListingResult>/i);
      const retryResult = retryResultMatch?.[1]?.trim() ?? '';

      if (retryFaultText || retryResult.toLowerCase().includes('error') || retryResult.toLowerCase().includes('fault')) {
        message = retryFaultText || retryResult || message;
        success = false;
      } else if (retryResult.toLowerCase().includes('success') || retryResult === '' || retryResponse.ok) {
        success = true;
        const fromResult = extractPpReference(retryResult);
        const fromResponse = extractPpReference(retryText);
        const fromExisting = existingRef;
        ppRef = fromResult ?? fromResponse ?? fromExisting;
        refSource = fromResult ? 'result' : fromResponse ? 'responseText' : fromExisting ? 'existing' : refSource;
        message = retryResult || 'Published successfully';
      }
    }

    // If PP still rejects the agent association, retry with alternative agent identifiers.
    if (
      !success &&
      !isWithdraw &&
      /PP102|agent associated to this listing does not exist/i.test(message)
    ) {
      const fallbackAgentIds = buildAgentCandidates().filter((value) => value !== (ppAgentIdUsed ?? ''));

      for (const fallbackAgentId of fallbackAgentIds) {
        const retrySoapXml = soapXml
          .replace(/<BranchId>[\s\S]*?<\/BranchId>/i, `<BranchId>${branchGuid}</BranchId>`)
          .replace(/<AgentId>[\s\S]*?<\/AgentId>/i, `<AgentId>${xmlEscape(fallbackAgentId)}</AgentId>`);

        const retryResponse = await fetchWithRetries(activePpUrl, {
          method: 'POST',
          headers: soapHeaders,
          body: retrySoapXml,
        }, { attempts: 2, timeoutMs: 30000 });

        const retryText = await retryResponse.text();
        responseText = retryText;

        const retryFaultMatch = retryText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
        const retryFaultText = retryFaultMatch?.[1]?.trim() ?? '';
        const retryResultMatch = retryText.match(/<UpdateListingResult[^>]*>([\s\S]*?)<\/UpdateListingResult>/i);
        const retryResult = retryResultMatch?.[1]?.trim() ?? '';

        if (retryFaultText || retryResult.toLowerCase().includes('error') || retryResult.toLowerCase().includes('fault')) {
          message = retryFaultText || retryResult || message;
          success = false;
          ppAgentIdUsed = fallbackAgentId;
          continue;
        }

        if (retryResult.toLowerCase().includes('success') || retryResult === '' || retryResponse.ok) {
          success = true;
          const fromResult = extractPpReference(retryResult);
          const fromResponse = extractPpReference(retryText);
          const fromExisting = existingRef;
          ppRef = fromResult ?? fromResponse ?? fromExisting;
          refSource = fromResult ? 'result' : fromResponse ? 'responseText' : fromExisting ? 'existing' : refSource;
          message = retryResult || 'Published successfully';
          ppAgentIdUsed = fallbackAgentId;
          break;
        }
      }
    }

    // Final PP102 fallback: retry all known agent candidates on alternative branch GUIDs.
    if (
      !success &&
      !isWithdraw &&
      /PP102|agent associated to this listing does not exist/i.test(message)
    ) {
      const branchCandidates = [ppDefaultBranchGuid, branchGuid]
        .filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
      const fallbackAgentIds = buildAgentCandidates();

      for (const candidateBranchGuid of branchCandidates) {
        for (const fallbackAgentId of fallbackAgentIds) {
          if (candidateBranchGuid === branchGuid && fallbackAgentId === (ppAgentIdUsed ?? '')) continue;

          const retrySoapXml = soapXml
            .replace(/<BranchId>[\s\S]*?<\/BranchId>/i, `<BranchId>${candidateBranchGuid}</BranchId>`)
            .replace(/<AgentId>[\s\S]*?<\/AgentId>/i, `<AgentId>${xmlEscape(fallbackAgentId)}</AgentId>`);

          const retryResponse = await fetchWithRetries(activePpUrl, {
            method: 'POST',
            headers: soapHeaders,
            body: retrySoapXml,
          }, { attempts: 2, timeoutMs: 30000 });

          const retryText = await retryResponse.text();
          responseText = retryText;

          const retryFaultMatch = retryText.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
          const retryFaultText = retryFaultMatch?.[1]?.trim() ?? '';
          const retryResultMatch = retryText.match(/<UpdateListingResult[^>]*>([\s\S]*?)<\/UpdateListingResult>/i);
          const retryResult = retryResultMatch?.[1]?.trim() ?? '';

          if (retryFaultText || retryResult.toLowerCase().includes('error') || retryResult.toLowerCase().includes('fault')) {
            message = retryFaultText || retryResult || message;
            success = false;
            ppAgentIdUsed = fallbackAgentId;
            continue;
          }

          if (retryResult.toLowerCase().includes('success') || retryResult === '' || retryResponse.ok) {
            success = true;
            const fromResult = extractPpReference(retryResult);
            const fromResponse = extractPpReference(retryText);
            const fromExisting = existingRef;
            ppRef = fromResult ?? fromResponse ?? fromExisting;
            refSource = fromResult ? 'result' : fromResponse ? 'responseText' : fromExisting ? 'existing' : refSource;
            message = retryResult || 'Published successfully';
            ppAgentIdUsed = fallbackAgentId;
            break;
          }
        }
        if (success) break;
      }
    }

    // Update DB
    if (success) {
      if (isWithdraw) {
        await pool.query(
          `UPDATE migration.core_listings
           SET private_property_sync_status = 'Inactive', updated_at = NOW()
           WHERE id = $1`,
          [id]
        );
      } else {
        let finalRef = ppRef ?? extractPpReference(responseText) ?? existingRefUsable;

        // Fallback: PP sometimes returns only "Success" in UpdateListingResult.
        // In that case, query active listings for the branch and map by UniqueId=PropertyId (KWLM...).
        if (!finalRef || !/^T\d{5,}$/i.test(finalRef)) {
          referenceLookupTried = true;
          try {
            const lookedUpRef = await fetchPpReferenceByUniqueId({
              ppBaseUrl: activePpUrl,
              ppUsername,
              ppPassword: activePpPassword,
              branchGuid,
              uniqueId: propertyId,
            });
            if (lookedUpRef) finalRef = lookedUpRef;
            if (lookedUpRef) {
              refSource = 'activeListingsLookup';
              referenceLookupFound = true;
            }
          } catch {
            // non-fatal; keep existing usable reference if any
          }
        }

        persistedReference = finalRef && /^T\d{5,}$/i.test(finalRef) ? finalRef.toUpperCase() : null;

        await pool.query(
          `UPDATE migration.core_listings
           SET private_property_ref1 = COALESCE($1, private_property_ref1), private_property_sync_status = 'Active', updated_at = NOW()
           WHERE id = $2`,
          [persistedReference, id]
        );
      }
    }

    const displayMessage = !success
      ? `${message} [branchGuid=${branchGuid}; agentId=${ppAgentIdUsed ?? 'n/a'}]`
      : message;

    return res.status(success ? 200 : 422).json({
      success,
      message: displayMessage,
      reference: persistedReference ?? ppRef,
      reference_id: persistedReference ?? ppRef,
      portal: 'PrivateProperty',
      rawResponse: responseText.slice(0, 1000),
      debug: {
        endpoint: activePpUrl,
        branchGuid,
        agentIdUsed: ppAgentIdUsed,
        usedAlternatePassword: activePpPassword !== ppPassword,
        resolvedReference: persistedReference ?? ppRef,
        referenceSource: refSource,
        referenceLookupTried,
        referenceLookupFound,
      },
    });
  } catch (err) {
    console.error('[publish-to-private-property] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/publish-to-kww
// ---------------------------------------------------------------------------

router.post('/:id/publish-to-kww', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const kwwBaseUrl = env.kww.baseUrl;
  const kwwApiKey = env.kww.apiKey;
  const kwwApiSecret = env.kww.apiSecret;

  if (!kwwBaseUrl || !kwwApiKey || !kwwApiSecret) {
    return res.status(501).json({
      success: false,
      message: 'KW Worldwide integration is not configured. Set KWW_BASE_URL, KWW_API_KEY, and KWW_API_SECRET.',
    });
  }

  try {
    const listingResult = await pool.query(
      `SELECT cl.id, cl.listing_number, cl.market_center_id, cl.source_market_center_id,
        cl.property_title, cl.property_description, cl.short_description,
        cl.sale_or_rent, cl.listing_status_tag, cl.status_name,
        cl.property_type, cl.property_sub_type,
        cl.price::text AS price, cl.poa,
        cl.street_number, cl.street_name, cl.unit_number, cl.estate_name,
        cl.suburb, cl.city, cl.province, cl.country, cl.postal_code,
        cl.longitude::text, cl.latitude::text,
        cl.override_display_location,
        cl.override_display_longitude::text, cl.override_display_latitude::text,
        cl.erf_size::text, cl.floor_area::text,
        cl.rates_and_taxes::text, cl.monthly_levy::text,
        cl.is_furnished, cl.pet_friendly,
        cl.mandate_type,
        cl.feed_to_kww, cl.kww_property_reference, cl.kww_ref1, cl.kww_ref2,
        cl.kww_sync_status,
        cl.listing_images_json
       FROM migration.core_listings cl WHERE cl.id = $1 LIMIT 1`,
      [id]
    );

    if (listingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listingResult.rows[0] as Record<string, unknown>;

    const agentResult = await pool.query(
      `SELECT la.associate_id::text, la.is_primary, la.sort_order,
              a.market_center_id::text AS market_center_id,
              a.kwuid,
              COALESCE(a.full_name, la.agent_name) AS agent_name,
              COALESCE(a.mobile_number, a.office_number) AS agent_phone,
              COALESCE(a.kwsa_email, a.private_email, a.email) AS agent_email
       FROM migration.listing_agents la
       LEFT JOIN migration.core_associates a ON a.id = la.associate_id
       WHERE la.listing_id = $1
       ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC`,
      [id]
    );

    type AgentRow = { associate_id: string | null; market_center_id: string | null; kwuid: string | null; agent_name: string | null; agent_phone: string | null; agent_email: string | null };
    const primaryAgent = agentResult.rows[0] as AgentRow | undefined;

    if (!primaryAgent?.kwuid) {
      return res.status(400).json({ success: false, message: 'Primary agent does not have a KWUID configured. KW Worldwide requires a KWUID for each agent.' });
    }

    const agentKwuid = primaryAgent.kwuid;
    const marketCenterLookupId = toText(listing.market_center_id) ?? toText(primaryAgent.market_center_id);

    // Load market center frontdoor_id
    let frontdoorId: number | null = null;
    let marketCenterName = '';
    if (marketCenterLookupId) {
      try {
        const mcResult = await pool.query(
          `SELECT name, frontdoor_id::text AS frontdoor_id
           FROM migration.core_market_centers WHERE id::text = $1 LIMIT 1`,
          [marketCenterLookupId]
        );
        const mcRow = mcResult.rows[0] as { name: string | null; frontdoor_id: string | null } | undefined;
        marketCenterName = toText(mcRow?.name) ?? '';
        const fdId = toNumber(mcRow?.frontdoor_id);
        if (fdId != null) frontdoorId = fdId;
      } catch {
        // column may not exist
      }
    }

    if (!frontdoorId) {
      return res.status(400).json({ success: false, message: 'Market center does not have a Frontdoor ID. KW Worldwide requires a Frontdoor ID.' });
    }

    const statusTag = (toText(listing.listing_status_tag) ?? '').toLowerCase().trim();
    const statusName = (toText(listing.status_name) ?? '').toLowerCase().trim();
    const isWithdraw =
      statusTag === 'withdrawn' || statusTag === 'withdraw' ||
      statusName === 'withdrawn' || statusName === 'inactive';

      const candidateListUuid = toText(listing.kww_ref1) ?? toText(listing.kww_ref2);
    // Only PATCH if WE previously published successfully via this system (kww_sync_status = 'Active').
    // Listings imported from the old system may have stale UUIDs that KWW no longer recognises.
    const kwwSyncStatus = (toText(listing.kww_sync_status) ?? '').toLowerCase();
    const existingListUuid = (isUuid(candidateListUuid) && kwwSyncStatus === 'active') ? candidateListUuid : null;
    const listingNumber = toText(listing.listing_number) ?? id.toString();
    const listingType = mapListingTypeToProperty24(listing.sale_or_rent);
    const price = toNumber(listing.price) ?? 0;

    // Map status (confirmed from live KWW data: Active=1, Pending=2, Sold=3, Withdrawn=11, Expired=14)
    let listStatus = 'Active';
    let listStatusId = 1;
    if (isWithdraw) { listStatus = 'Withdrawn'; listStatusId = 11; }
    else if (statusTag.includes('sold') || statusName.includes('sold')) { listStatus = 'Sold'; listStatusId = 3; }
    else if (statusTag.includes('pending') || statusTag.includes('offer')) { listStatus = 'Pending'; listStatusId = 2; }

    // Map list category (confirmed from live KWW data: For Sale=2, For Rent=1, Sold=3)
    const isRental = listingType === 'Rental';
    const listCategory = isRental ? 'For Rent' : 'For Sale';
    const listCategoryId = isRental ? 1 : 2;

    // Map property type
    const rawSubType = toText(listing.property_sub_type) ?? '';
    const rawType = toText(listing.property_type) ?? '';
    const kwwType = mapKwwPropertyType(rawType, rawSubType);
    const propTypeName = kwwType.propType;

    // Map list type using the legacy values that previously worked against KWW for KW Sourced payloads.
    const rawMandate = (toText(listing.mandate_type) ?? '').toLowerCase();
    const kwwListType = mapKwwListType(rawMandate, kwwType.propTypeId);
    const listType = kwwListType.listType;
    const listTypeId = kwwListType.listTypeId;

    // Load area counts
    const areasResult = await pool.query(
      `SELECT LOWER(TRIM(area_type)) AS area_type, MAX(count)::int AS count
       FROM migration.listing_property_areas
       WHERE listing_id = $1
         AND LOWER(TRIM(COALESCE(area_type, ''))) IN ('bedroom', 'bathroom', 'garage')
       GROUP BY LOWER(TRIM(area_type))`,
      [id]
    );
    const areaCounts: Record<string, number> = {};
    for (const row of areasResult.rows as Array<{ area_type: string; count: number }>) {
      areaCounts[row.area_type] = row.count ?? 0;
    }

    // Address
    const streetNum = toText(listing.street_number) ?? '';
    const streetName = toText(listing.street_name) ?? '';
    const city = toText(listing.city) ?? '';
    const province = toText(listing.province) ?? '';
    const country = toText(listing.country) ?? 'South Africa';
    const postalCode = toText(listing.postal_code) ?? '';
    const useOverride = toBool(listing.override_display_location);
    const lat = useOverride ? (toNumber(listing.override_display_latitude) ?? toNumber(listing.latitude) ?? -26.195246) : (toNumber(listing.latitude) ?? -26.195246);
    const lon = useOverride ? (toNumber(listing.override_display_longitude) ?? toNumber(listing.longitude) ?? 28.034088) : (toNumber(listing.longitude) ?? 28.034088);

    // Photos
    const imageUrls = (await resolveListingImageUrls(pool, id, listing.listing_images_json)).slice(0, 25);
    const photos = imageUrls.map((url, i) => ({ ph_url: url, ph_short_desc: 'Listing Image', ph_order: i + 1, ph_type: 'image/jpeg' }));

    // Description
    const listDesc = (toText(listing.property_description) ?? toText(listing.short_description) ?? '').replace(/\r/g, '').replace(/\n/g, '\n');

    const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const payload: Record<string, unknown> = {
      brokerage: { name: marketCenterName || 'Keller Williams' },
      currency_code: 'ZAR',
      current_list_price: Math.round(price),
      is_kww_listing: true,
      kw_agent: true,
      kw_listing: true,
      kw_mc: true,
      kwls_status: listStatus === 'Active' ? 'Active' : listStatus,
      list_kw_uid: Number(agentKwuid) || agentKwuid,
      list_address: {
        street_number: streetNum,
        street_name: streetName,
        city,
        state_prov: province,
        country,
        postal_code: postalCode,
        coordinates_gp: { lat, lon },
      },
      list_category: listCategory,
      list_category_id: listCategoryId,
      kww_region: 5956,
      list_status: listStatus,
      list_status_id: listStatusId,
      list_type: listType,
      list_type_id: listTypeId,
      manual_entry: true,
      market_center: frontdoorId,
      mls_id: 'KWW_KWZA',
      mls_name: 'Keller Williams Southern Africa',
      prop_type: propTypeName,
      prop_type_id: kwwType.propTypeId,
      prop_subtype_id: kwwType.propSubtypeId,
      source_system_name: 'KW Sourced',
      version: '2.0.0',
      contract_expiry_dt: expiry,
      contract_expiry_dt_lock: false,
      full_bath: areaCounts['bathroom'] ?? 0,
      is_deleted: false,
      kw_expiry_dt: expiry,
      kw_expiry_dt_lock: false,
      kw_updated_at: now,
      list_desc: listDesc,
      list_desc_en: listDesc,
      list_desc_lock: false,
      list_dt: new Date().toISOString().slice(0, 10),
      list_status_lock: false,
      living_area: Math.round(toNumber(listing.floor_area) ?? 0) || null,
      living_area_units: 'sqm',
      lot_size_area: Math.round(toNumber(listing.erf_size) ?? 0) || null,
      lot_size_units: 'sqm',
      mls_number: listingNumber,
      mls_updated_at: now,
      photos,
      prop_subtype: rawSubType || propTypeName,
      prop_type_lock: false,
      total_bath: areaCounts['bathroom'] ?? 0,
      total_bed: areaCounts['bedroom'] ?? 0,
      list_agent_office: {
        list_agent_key: agentKwuid,
        list_agent_full_name: primaryAgent.agent_name ?? '',
        list_agent_email: primaryAgent.agent_email ?? '',
        list_agent_preferred_phone: primaryAgent.agent_phone ?? '',
        list_office_key: frontdoorId.toString(),
        list_office_name: marketCenterName || 'Keller Williams',
      },
    };

    if (existingListUuid) {
      (payload as Record<string, unknown>).list_uuid = existingListUuid;
    }

    const authHeader = `Basic ${Buffer.from(`${kwwApiKey}:${kwwApiSecret}`, 'ascii').toString('base64')}`;
    const kwwHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'x-consumer-token-user-id': agentKwuid,
      'x-kwuid': agentKwuid,
      'API-Key': kwwApiKey,
    };

    let requestMethod = existingListUuid ? 'PATCH' : 'POST';
    let requestUrl = existingListUuid ? `${kwwBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(existingListUuid)}` : kwwBaseUrl;

    type KwwResponseBody = {
      success?: boolean | string | null;
      data?: { list_uuid?: string | null; list_key?: string | null; list_id?: number | null } | null;
      errorCode?: string | null;
      message?: string | null;
      error?: string | null;
      details?: unknown;
    };

    const parseKwwResponse = (rawText: string): KwwResponseBody | null => {
      if (!rawText) return null;
      try {
        return JSON.parse(rawText) as KwwResponseBody;
      } catch {
        return null;
      }
    };

    type KwwIdentifiers = {
      listUuid: string | null;
      listKey: string | null;
      listId: string | null;
    };

    const extractKwwIdentifiers = (rawJson: unknown): KwwIdentifiers | null => {
      if (!rawJson || typeof rawJson !== 'object') return null;

      const root = rawJson as Record<string, unknown>;
      const directData = root.data;
      if (directData && typeof directData === 'object') {
        const dataRecord = directData as Record<string, unknown>;
        const directUuid = toText(dataRecord.list_uuid);
        const directKey = toText(dataRecord.list_key);
        const directId = toNumber(dataRecord.list_id);
        if (directUuid || directKey || directId != null) {
          return {
            listUuid: directUuid,
            listKey: directKey,
            listId: directId != null ? String(directId) : null,
          };
        }
      }

      const hitsRoot = root.hits;
      if (!hitsRoot || typeof hitsRoot !== 'object') return null;
      const outerHits = (hitsRoot as Record<string, unknown>).hits;
      if (!Array.isArray(outerHits) || outerHits.length === 0) return null;

      const firstHit = outerHits[0];
      if (!firstHit || typeof firstHit !== 'object') return null;

      const source = (firstHit as Record<string, unknown>)._source;
      if (!source || typeof source !== 'object') return null;

      const sourceRecord = source as Record<string, unknown>;
      const sourceUuid = toText(sourceRecord.list_uuid);
      const sourceKey = toText(sourceRecord.list_key);
      const sourceId = toNumber(sourceRecord.list_id);
      if (!sourceUuid && !sourceKey && sourceId == null) return null;

      return {
        listUuid: sourceUuid,
        listKey: sourceKey,
        listId: sourceId != null ? String(sourceId) : null,
      };
    };

    const findExistingKwwListingByKey = async (): Promise<KwwIdentifiers | null> => {
      const baseUrl = kwwBaseUrl.replace(/\/$/, '');
      const candidateKeys = [`KWW_KWZA-${listingNumber}`, `KWZA-${listingNumber}`, listingNumber];

      for (const candidateKey of candidateKeys) {
        const lookupUrl = `${baseUrl}?filter[list_key][is]=${encodeURIComponent(candidateKey)}`;
        attemptedRequests.push({ method: 'GET', url: lookupUrl });

        const lookupResponse = await fetchWithRetries(lookupUrl, {
          method: 'GET',
          headers: kwwHeaders,
        }, { attempts: 2, timeoutMs: 30000 });

        const lookupText = await lookupResponse.text();
        const lookupJson = parseKwwResponse(lookupText) ?? (() => {
          try {
            return JSON.parse(lookupText) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();

        const foundListing = extractKwwIdentifiers(lookupJson);
        if (foundListing) return foundListing;
      }

      return null;
    };

    let attemptedListTypes: string[] = [String((payload as Record<string, unknown>).list_type ?? '')].filter(Boolean);
    const attemptedRequests: Array<{ method: string; url: string }> = [];

    attemptedRequests.push({ method: requestMethod, url: requestUrl });
    let kwwResponse = await fetchWithRetries(requestUrl, {
      method: requestMethod,
      headers: kwwHeaders,
      body: JSON.stringify(payload),
    }, { attempts: 2, timeoutMs: 30000 });

    let responseText = await kwwResponse.text();
    let responseJson = parseKwwResponse(responseText);

    let parsedErrorMessage =
      responseJson?.message ??
      responseJson?.error ??
      (responseText ? responseText.slice(0, 800) : null);

    let listUuid = toText(responseJson?.data?.list_uuid) ?? null;
    let listKey = toText(responseJson?.data?.list_key) ?? null;
    let listId = (() => {
      const value = toNumber(responseJson?.data?.list_id);
      return value != null ? String(value) : null;
    })();
    let kwwSuccess = responseJson?.success === true || responseJson?.success === 'true';
    let success = (kwwResponse.ok && kwwSuccess) || (kwwResponse.ok && listUuid != null) || Boolean(listUuid);

    if (!success && /listing number is already in use/i.test(parsedErrorMessage ?? '')) {
      const resolvedListing = await findExistingKwwListingByKey();
      const resolvedListUuid = resolvedListing?.listUuid ?? null;
      if (resolvedListUuid) {
        requestMethod = 'PATCH';
        requestUrl = `${kwwBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(resolvedListUuid)}`;
        (payload as Record<string, unknown>).list_uuid = resolvedListUuid;

        attemptedRequests.push({ method: requestMethod, url: requestUrl });
        kwwResponse = await fetchWithRetries(requestUrl, {
          method: requestMethod,
          headers: kwwHeaders,
          body: JSON.stringify(payload),
        }, { attempts: 2, timeoutMs: 30000 });

        responseText = await kwwResponse.text();
        responseJson = parseKwwResponse(responseText);
        parsedErrorMessage =
          responseJson?.message ??
          responseJson?.error ??
          (responseText ? responseText.slice(0, 800) : null);

        listUuid = toText(responseJson?.data?.list_uuid) ?? resolvedListUuid;
        listKey = toText(responseJson?.data?.list_key) ?? listKey ?? resolvedListing?.listKey ?? null;
        listId = (() => {
          const value = toNumber(responseJson?.data?.list_id);
          return value != null ? String(value) : (listId ?? resolvedListing?.listId ?? null);
        })();
        kwwSuccess = responseJson?.success === true || responseJson?.success === 'true';
        success = (kwwResponse.ok && kwwSuccess) || (kwwResponse.ok && listUuid != null) || Boolean(listUuid);
      }
    }

    if (!success && /invalid\s+list\s+type/i.test(parsedErrorMessage ?? '')) {
      // Some stale imported KWW UUIDs can pass local checks but fail server-side update validation.
      // If PATCH path fails with invalid list type, retry as a fresh POST without list_uuid.
      if (requestMethod === 'PATCH') {
        requestMethod = 'POST';
        requestUrl = kwwBaseUrl;
        delete (payload as Record<string, unknown>).list_uuid;
      }

      const fallbackTypes = [
        kwwType.propTypeId === 5 ? 'Land Listing' : null,
        'Prospective',
        'KWW Exclusive',
        'Open Listing',
        'MLS Listing',
        'Coming Soon',
        'KW Reserve',
        'Internal MC Exclusive',
      ].filter((value): value is string => typeof value === 'string' && !attemptedListTypes.includes(value));

      for (const fallbackType of fallbackTypes) {
        (payload as Record<string, unknown>).list_type = fallbackType;
        (payload as Record<string, unknown>).list_type_id = fallbackType === 'Prospective'
          ? 1
          : fallbackType === 'MLS Listing'
            ? 2
            : fallbackType === 'KWW Exclusive'
              ? 4
              : fallbackType === 'Land Listing'
                ? 8
              : 5;
        attemptedListTypes.push(fallbackType);

        attemptedRequests.push({ method: requestMethod, url: requestUrl });
        kwwResponse = await fetchWithRetries(requestUrl, {
          method: requestMethod,
          headers: kwwHeaders,
          body: JSON.stringify(payload),
        }, { attempts: 2, timeoutMs: 30000 });

        responseText = await kwwResponse.text();
        responseJson = parseKwwResponse(responseText);
        parsedErrorMessage =
          responseJson?.message ??
          responseJson?.error ??
          (responseText ? responseText.slice(0, 800) : null);

        listUuid = toText(responseJson?.data?.list_uuid) ?? null;
        listKey = toText(responseJson?.data?.list_key) ?? null;
        listId = (() => {
          const value = toNumber(responseJson?.data?.list_id);
          return value != null ? String(value) : null;
        })();
        kwwSuccess = responseJson?.success === true || responseJson?.success === 'true';
        success = (kwwResponse.ok && kwwSuccess) || (kwwResponse.ok && listUuid != null) || Boolean(listUuid);

        if (success) break;
        if (!/invalid\s+list\s+type/i.test(parsedErrorMessage ?? '')) break;
      }
    }

    if (success && (!listId || !listKey)) {
      const resolvedListing = await findExistingKwwListingByKey();
      if (resolvedListing) {
        listUuid = listUuid ?? resolvedListing.listUuid;
        listKey = listKey ?? resolvedListing.listKey;
        listId = listId ?? resolvedListing.listId;
      }
    }

    const publicReferenceId = listId ?? toText(listing.kww_property_reference) ?? null;

    const message = success
      ? `Published successfully${publicReferenceId ? `. Property ID: ${publicReferenceId}` : ''}${listKey ? `. List Key: ${listKey}` : listUuid ? `. List UUID: ${listUuid.slice(0, 12)}…` : ''}`
      : (parsedErrorMessage ?? `KWW returned status ${kwwResponse.status}`);
    const rawKwwResponse = !success
      ? (responseJson ?? { rawText: responseText.slice(0, 2000) })
      : undefined;
    const failureDetails = !success
      ? {
          status: kwwResponse.status,
          method: requestMethod,
          url: requestUrl,
          response: rawKwwResponse,
          payloadPreview: {
            mls_number: listingNumber,
            list_kw_uid: (payload as Record<string, unknown>).list_kw_uid,
            list_type: (payload as Record<string, unknown>).list_type,
            list_type_id: (payload as Record<string, unknown>).list_type_id,
            prop_type: (payload as Record<string, unknown>).prop_type,
            prop_type_id: (payload as Record<string, unknown>).prop_type_id,
            prop_subtype: (payload as Record<string, unknown>).prop_subtype,
            prop_subtype_id: (payload as Record<string, unknown>).prop_subtype_id,
          },
          attemptedListTypes,
          attemptedRequests,
        }
      : undefined;

    // Update DB
    if (success) {
      if (isWithdraw) {
        await pool.query(
          `UPDATE migration.core_listings
           SET kww_sync_status = 'Inactive', updated_at = NOW()
           WHERE id = $1`,
          [id]
        );
      } else {
        await pool.query(
          `UPDATE migration.core_listings
           SET kww_property_reference = COALESCE($1, kww_property_reference),
               kww_ref1 = COALESCE($2, kww_ref1),
               kww_ref2 = COALESCE($3, kww_ref2),
               kww_sync_status = 'Active', updated_at = NOW()
           WHERE id = $4`,
          [publicReferenceId, listUuid ?? existingListUuid ?? null, listKey ?? null, id]
        );
      }
    }

    return res.status(success ? 200 : 422).json({
      success,
      message,
      reference: publicReferenceId,
      reference_id: publicReferenceId,
      reference_uuid: listUuid ?? existingListUuid ?? null,
      reference_key: listKey,
      portal: 'KWW',
      ...(rawKwwResponse ? { rawResponse: rawKwwResponse } : {}),
      ...(failureDetails ? { details: failureDetails } : {}),
    });
  } catch (err) {
    console.error('[publish-to-kww] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/publish-to-entegral
// ---------------------------------------------------------------------------

router.post('/:id/publish-to-entegral', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id.' });

  const entegralBaseUrl = env.entegral.baseUrl;
  const entegralGlobalAuth = env.entegral.globalAuth;

  if (!entegralBaseUrl || !entegralGlobalAuth) {
    return res.status(501).json({
      success: false,
      message: 'Entegral integration is not configured. Set ENTEGRAL_BASE_URL and ENTEGRAL_GLOBAL_AUTH.',
    });
  }

  const authHeader = `Basic ${Buffer.from(entegralGlobalAuth).toString('base64')}`;
  const entegralUrl = (segment: string) => `${entegralBaseUrl.replace(/\/$/, '')}/${segment}`;

  try {
    // Load listing row
    const listingResult = await pool.query(
      `SELECT
        cl.id, cl.source_market_center_id, cl.market_center_id,
        cl.listing_number, cl.property_description, cl.short_description,
        cl.sale_or_rent, cl.listing_status_tag, cl.status_name,
        cl.property_type, cl.property_sub_type,
        cl.price::text AS price, cl.poa,
        cl.signed_date::text AS list_date, cl.expiry_date::text AS expiry_date,
        cl.street_number, cl.street_name, cl.unit_number, cl.estate_name,
        cl.suburb, cl.city, cl.province, cl.country,
        cl.longitude::text, cl.latitude::text,
        cl.override_display_location,
        cl.override_display_longitude::text, cl.override_display_latitude::text,
        cl.erf_size::text, cl.floor_area::text,
        cl.rates_and_taxes::text, cl.monthly_levy::text,
        cl.pet_friendly, cl.mandate_type, cl.display_address_on_website,
        cl.listing_images_json, cl.listing_payload,
        cl.feed_to_entegral, cl.entegral_sync_status,
        COALESCE(
          NULLIF(TRIM(cl.listing_payload->>'EntegralId'), ''),
          NULLIF(TRIM(cl.listing_payload->>'entegral_id'), ''),
          NULLIF(TRIM(cl.listing_payload->>'EntegralReference'), '')
        ) AS entegral_reference_id
       FROM migration.core_listings cl WHERE cl.id = $1 LIMIT 1`,
      [id]
    );

    if (listingResult.rowCount === 0) {
      return res.status(404).json({ error: 'Listing not found.' });
    }

    const listing = listingResult.rows[0] as Record<string, unknown>;

    // Determine action from listing status
    const statusTag = (toText(listing.listing_status_tag) ?? '').toLowerCase().trim();
    const statusName = (toText(listing.status_name) ?? '').toLowerCase().trim();
    const isWithdraw =
      statusTag === 'withdrawn' ||
      statusTag === 'withdraw' ||
      statusName === 'withdrawn' ||
      statusName === 'inactive';

    // Load agents linked to this listing
    const agentResult = await pool.query(
      `SELECT a.id AS associate_id, a.market_center_id, a.source_market_center_id,
              COALESCE(a.full_name, la.agent_name) AS agent_name,
              COALESCE(a.kwsa_email, a.private_email, a.email) AS agent_email,
              COALESCE(a.mobile_number, a.office_number) AS agent_phone,
              a.agent_entegral_id,
              la.is_primary, la.sort_order
       FROM migration.listing_agents la
       LEFT JOIN migration.core_associates a ON a.id = la.associate_id
       WHERE la.listing_id = $1
       ORDER BY la.is_primary DESC, la.sort_order ASC, la.id ASC`,
      [id]
    );

    const allAgents = agentResult.rows as Array<Record<string, unknown>>;
    const primaryAgent = allAgents[0];

    // Load market center (with optional entegral columns)
    const marketCenterLookupId =
      toText(listing.market_center_id) ??
      toText(primaryAgent?.market_center_id);

    let marketCenter: Record<string, unknown> | undefined;
    let entegralPortals: string[] = [];

    if (marketCenterLookupId) {
      const mcColResult = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'migration' AND table_name = 'core_market_centers'
           AND column_name IN ('source_market_center_id', 'name', 'entegral_portals', 'entegral_url', 'office_number')`
      );
      const mcCols = new Set(mcColResult.rows.map((r) => r.column_name));
      const optSelect = ['entegral_portals', 'entegral_url', 'office_number']
        .map((c) => (mcCols.has(c) ? c : `NULL AS ${c}`))
        .join(', ');

      const mcResult = await pool.query(
        `SELECT id::text, source_market_center_id, name, ${optSelect}
         FROM migration.core_market_centers WHERE id::text = $1 LIMIT 1`,
        [marketCenterLookupId]
      );
      marketCenter = mcResult.rows[0] as Record<string, unknown> | undefined;

      const rawPortals = marketCenter?.entegral_portals;
      if (Array.isArray(rawPortals)) {
        entegralPortals = rawPortals.map(String).filter(Boolean);
      } else if (typeof rawPortals === 'string' && rawPortals) {
        // PostgreSQL TEXT[] arrives as "{val1,val2}"
        entegralPortals = rawPortals
          .replace(/^\{|\}$/g, '')
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      }
    }

    // Load area counts (bedrooms, bathrooms, etc.)
    const areasResult = await pool.query(
      `SELECT LOWER(TRIM(area_type)) AS area_type, MAX(count)::int AS count
       FROM migration.listing_property_areas
       WHERE listing_id = $1
         AND LOWER(TRIM(COALESCE(area_type, ''))) IN ('bedroom', 'bathroom', 'garage', 'carport', 'study', 'living area')
       GROUP BY LOWER(TRIM(area_type))`,
      [id]
    );
    const areaCounts: Record<string, number> = {};
    for (const row of areasResult.rows as Array<{ area_type: string; count: number }>) {
      areaCounts[row.area_type] = row.count ?? 0;
    }

    // Load images
    const imageUrls = await resolveListingImageUrls(pool, id, listing.listing_images_json);

    // Map property type
    const rawType = (toText(listing.property_type) ?? '').trim();
    const rawSubType = (toText(listing.property_sub_type) ?? '').trim();

    function mapEntegralPropertyType(type: string, subType: string): string {
      switch (type) {
        case 'Residential':
          switch (subType) {
            case 'House': return 'House';
            case 'TownHouse': case 'Townhouse': return 'Townhouse';
            case 'Vacant Land': return 'Vacant Land Residential';
            case 'Flat/Apartment': case 'Apartment': return 'Apartment';
            case 'Cluster': return 'Cluster';
            default: return 'House';
          }
        case 'Commercial':
          return subType === 'Vacant Land' ? 'Vacant Land Commercial' : 'Commercial Property';
        case 'Industrial':
          return subType === 'Vacant Land' ? 'Vacant Land Industrial' : 'Industrial Property';
        case 'Business':
          return 'Commercial Property';
        case 'Farm':
          return 'Farm';
        default:
          return 'House';
      }
    }

    // Map property status
    const listingType = toText(listing.sale_or_rent) ?? 'Sale';
    const isRental = /rental|rent/i.test(listingType);
    const propertyStatus = isWithdraw ? 'Inactive' : (isRental ? 'Rental Monthly' : 'For Sale');

    // Map mandate
    const rawMandate = (toText(listing.mandate_type) ?? '').toLowerCase();
    const mandate = rawMandate.includes('open') ? 'Open'
      : rawMandate.includes('joint') || rawMandate.includes('dual') || rawMandate.includes('multi') ? 'Joint'
      : 'Sole';

    // Geo
    const useOverride = toBool(listing.override_display_location);
    const lat = useOverride
      ? (toNumber(listing.override_display_latitude) ?? toNumber(listing.latitude))
      : toNumber(listing.latitude);
    const lng = useOverride
      ? (toNumber(listing.override_display_longitude) ?? toNumber(listing.longitude))
      : toNumber(listing.longitude);
    const showOnMap = toBool(listing.display_address_on_website) ? 1 : 0;

    // Dates
    const now = new Date();
    const listDate = toDateValue(listing.list_date) ?? now.toISOString().slice(0, 10);
    const expiryDate = toDateValue(listing.expiry_date)
      ?? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Determine clientPropertyID and action
    const existingEntegralRef = toText(listing.entegral_reference_id) ?? toText(listing.listing_number);
    const clientPropertyID = existingEntegralRef ?? `ENT${String(id).padStart(7, '0')}`;
    const action = isWithdraw ? 'delete' : existingEntegralRef ? 'update' : 'create';

    // Build contacts array
    const contacts = allAgents.map((agent) => ({
      clientAgentID: toText(agent.agent_entegral_id) ?? toText(agent.associate_id) ?? '',
      clientOfficeID: toText(agent.source_market_center_id) ?? toText(marketCenter?.source_market_center_id) ?? '',
      fullName: toText(agent.agent_name) ?? '',
      cell: toText(agent.agent_phone) ?? '',
      email: toText(agent.agent_email) ?? '',
      profile: '',
      logo: '',
    }));

    // Build photos array
    const photos = imageUrls.slice(0, 30).map((url, i) => ({
      imgUrl: url,
      imgDescription: 'Listing Image',
      isMain: i === 0 ? 1 : 0,
    }));

    // Build portal listings
    const portalListing = entegralPortals.map((p) => ({ name: p, id: p }));

    // Full Entegral listing payload
    const entegralPayload: Record<string, unknown> = {
      clientPropertyID,
      currency: 'ZAR',
      price: toNumber(listing.price) ?? 0,
      ratesAndTaxes: toNumber(listing.rates_and_taxes) ?? 0,
      levy: toNumber(listing.monthly_levy) ?? 0,
      landSize: toNumber(listing.erf_size) ?? 0,
      landSizeType: 'm2',
      buildingSize: toNumber(listing.floor_area) ?? 0,
      buildingSizeType: 'm2',
      propertyType: mapEntegralPropertyType(rawType, rawSubType),
      propertyStatus,
      country: toText(listing.country) ?? 'South Africa',
      province: toText(listing.province) ?? '',
      town: toText(listing.city) ?? '',
      suburb: toText(listing.suburb) ?? '',
      beds: areaCounts['bedroom'] ?? null,
      baths: areaCounts['bathroom'] ?? null,
      garages: areaCounts['garage'] ?? null,
      carports: areaCounts['carport'] ?? null,
      pool: 0,
      study: areaCounts['study'] ?? null,
      livingAreas: areaCounts['living area'] ?? null,
      petsAllowed: toBool(listing.pet_friendly) ? 'Yes' : 'No',
      propertyFeatures: '-',
      streetNumber: toText(listing.street_number) ?? '',
      streetName: toText(listing.street_name) ?? '',
      unitNumber: (() => { const u = toText(listing.unit_number); return u ? (parseInt(u, 10) || null) : null; })(),
      complexName: toText(listing.estate_name) ?? '',
      latlng: lat != null && lng != null ? `${lat},${lng}` : '',
      showOnMap,
      description: toText(listing.property_description) ?? toText(listing.short_description) ?? '',
      isReduced: 0,
      isDevelopment: 0,
      mandate,
      action,
      timeStamp: now.toISOString().replace('T', ' ').slice(0, 19),
      listDate,
      expiryDate,
      photos,
      contact: contacts,
      portalListing,
    };

    // POST listing to Entegral
    const entegralResponse = await fetch(entegralUrl('listings'), {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(entegralPayload),
      signal: AbortSignal.timeout(30000),
    });

    const rawResponseBody = await entegralResponse.text();
    let parsedResponse: unknown;
    try { parsedResponse = JSON.parse(rawResponseBody); } catch { parsedResponse = rawResponseBody; }

    const success = entegralResponse.ok;
    const newSyncStatus = success
      ? (isWithdraw ? 'Withdrawn' : 'Synced')
      : `Error ${entegralResponse.status}`;

    // Update entegral sync status in DB
    await pool.query(
      `UPDATE migration.core_listings
       SET entegral_sync_status = $1, feed_to_entegral = $2, updated_at = NOW()
       WHERE id = $3`,
      [newSyncStatus, !isWithdraw && success, id]
    );

    return res.status(success ? 200 : 422).json({
      success,
      message: success
        ? (isWithdraw ? 'Listing withdrawn from Entegral.' : 'Listing published to Entegral.')
        : `Entegral responded with status ${entegralResponse.status}`,
      reference: clientPropertyID,
      action,
      portal: 'Entegral',
      ...(process.env.NODE_ENV !== 'production' ? { rawResponse: parsedResponse, payload: entegralPayload } : {}),
    });
  } catch (err) {
    console.error('[publish-to-entegral] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

// ---------------------------------------------------------------------------
// Listing Approval Workflow
// ---------------------------------------------------------------------------

async function createNotification(
  pg: Pool,
  associateId: number,
  notificationType: string,
  category: string,
  title: string,
  message: string,
  entityType: string,
  entityId: number,
  metadata: Record<string, unknown>
): Promise<void> {
  await pg.query(
    `INSERT INTO migration.in_app_notifications
       (associate_id, notification_type, category, title, message, entity_type, entity_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [associateId, notificationType, category, title, message, entityType, entityId, JSON.stringify(metadata)]
  );
}

// POST /:id/submit-for-approval
router.post('/:id/submit-for-approval', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  const perms = req.permissions!;
  const { comment } = req.body as { comment?: string };

  try {
    // Fetch listing to get market_center_id and listing_number
    const listingRes = await pool.query<{
      market_center_id: number | null;
      listing_number: string | null;
      source_market_center_id: string | null;
    }>(
      `SELECT market_center_id, listing_number, source_market_center_id FROM migration.core_listings WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!listingRes.rows.length) return res.status(404).json({ error: 'Listing not found' });
    const listing = listingRes.rows[0];

    // Resolve submitter name/email
    let submitterName = 'Unknown';
    let submitterEmail = '';
    if (perms.associateDbId) {
      const assocRes = await pool.query<{ full_name: string | null; email: string | null }>(
        `SELECT full_name, COALESCE(kwsa_email, email, private_email) AS email FROM migration.core_associates WHERE id = $1 LIMIT 1`,
        [perms.associateDbId]
      );
      submitterName = assocRes.rows[0]?.full_name ?? 'Unknown';
      submitterEmail = assocRes.rows[0]?.email ?? '';
    }

    // Upsert approval request — use DELETE+INSERT to avoid needing a unique constraint
    await pool.query(
      `DELETE FROM migration.listing_approval_requests WHERE listing_id = $1`,
      [id]
    );
    await pool.query(
      `INSERT INTO migration.listing_approval_requests
         (listing_id, status, submitted_by_associate_id, submitted_by_name, submitted_by_email, submission_comment, submitted_at)
       VALUES ($1, 'PENDING', $2, $3, $4, $5, NOW())`,
      [id, perms.associateDbId ?? null, submitterName, submitterEmail, comment ?? null]
    );

    // Update listing status
    await pool.query(
      `UPDATE migration.core_listings SET listing_status_tag = 'Pending Approval', is_draft = true, is_published = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Notify all admins in this market centre (via associate_roles table)
    if (listing.market_center_id) {
      const adminsRes = await pool.query<{ id: number; full_name: string | null }>(
        `SELECT DISTINCT a.id, a.full_name
         FROM migration.core_associates a
         JOIN migration.associate_roles r ON r.associate_id = a.id
         WHERE a.market_center_id = $1
           AND r.role_name IN ('Office Admin', 'OfficeAdmin')`,
        [listing.market_center_id]
      );
      for (const admin of adminsRes.rows) {
        try {
          await createNotification(
            pool, admin.id,
            'LISTING_APPROVAL_REQUESTED', 'PENDING',
            `Listing approval requested: ${listing.listing_number ?? id}`,
            `${submitterName} has submitted listing ${listing.listing_number ?? id} for approval.`,
            'listing', id,
            { listing_id: id, listing_number: listing.listing_number, submitter_name: submitterName, submitter_email: submitterEmail, status: 'PENDING' }
          );
        } catch { /* notification table may not exist */ }
      }
    }

    // Notify submitter that the request is now pending review
    const submitterAssociateId = perms.associateDbId ? Number(perms.associateDbId) : null;
    if (submitterAssociateId && Number.isFinite(submitterAssociateId)) {
      try {
        await createNotification(
          pool, submitterAssociateId,
          'LISTING_APPROVAL_SUBMITTED', 'PENDING',
          `Listing submitted for approval: ${listing.listing_number ?? id}`,
          `Your listing ${listing.listing_number ?? id} was submitted and is pending office admin review.`,
          'listing', id,
          { listing_id: id, listing_number: listing.listing_number, status: 'PENDING' }
        );
      } catch { /* notification table may not exist */ }
    }

    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[submit-for-approval]', message);
    return res.status(500).json({ error: message });
  }
});

// POST /:id/approve-approval
router.post('/:id/approve-approval', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  const perms = req.permissions!;
  if (perms.scope === 'OWN') return res.status(403).json({ error: 'Only admins may approve listings' });
  const { comment } = req.body as { comment?: string };

  try {
    const approvalRes = await pool.query<{
      submitted_by_associate_id: number | null;
      submitted_by_name: string | null;
    }>(
      `SELECT submitted_by_associate_id, submitted_by_name FROM migration.listing_approval_requests WHERE listing_id = $1 LIMIT 1`,
      [id]
    );
    if (!approvalRes.rows.length) return res.status(404).json({ error: 'No approval request found for this listing' });
    const approval = approvalRes.rows[0];

    // Resolve reviewer
    let reviewerName = 'Admin';
    if (perms.associateDbId) {
      const r = await pool.query<{ full_name: string | null }>(
        `SELECT full_name FROM migration.core_associates WHERE id = $1 LIMIT 1`,
        [perms.associateDbId]
      );
      reviewerName = r.rows[0]?.full_name ?? 'Admin';
    }

    // Update approval record
    await pool.query(
      `UPDATE migration.listing_approval_requests SET
         status = 'APPROVED', reviewed_by_associate_id = $2, reviewed_by_name = $3,
         review_comment = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE listing_id = $1`,
      [id, perms.associateDbId ?? null, reviewerName, comment ?? null]
    );

    // Publish listing
    await pool.query(
      `UPDATE migration.core_listings SET is_draft = false, is_published = true, listing_status_tag = 'Available', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Notify submitter
    if (approval.submitted_by_associate_id) {
      const listingRes = await pool.query<{ listing_number: string | null }>(
        `SELECT listing_number FROM migration.core_listings WHERE id = $1 LIMIT 1`, [id]
      );
      try {
        await createNotification(
          pool, approval.submitted_by_associate_id,
          'LISTING_APPROVAL_APPROVED', 'APPROVED',
          `Listing approved: ${listingRes.rows[0]?.listing_number ?? id}`,
          `Your listing ${listingRes.rows[0]?.listing_number ?? id} has been approved and published by ${reviewerName}.`,
          'listing', id,
          { listing_id: id, listing_number: listingRes.rows[0]?.listing_number, reviewer_name: reviewerName, status: 'APPROVED' }
        );
      } catch { /* notification table may not exist */ }
    }

    await pool.query(
      `UPDATE migration.in_app_notifications
          SET category = 'APPROVED',
              is_read = true,
              read_at = COALESCE(read_at, NOW()),
              updated_at = NOW()
        WHERE entity_type = 'listing'
          AND entity_id = $1
          AND notification_type = 'LISTING_APPROVAL_REQUESTED'`,
      [id]
    ).catch(() => undefined);

    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[approve-approval]', message);
    return res.status(500).json({ error: message });
  }
});

// POST /:id/reject-approval
router.post('/:id/reject-approval', resolvePermissions, async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DATABASE_URL is not configured.' });
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid listing id' });
  const perms = req.permissions!;
  if (perms.scope === 'OWN') return res.status(403).json({ error: 'Only admins may reject listings' });
  const { comment } = req.body as { comment?: string };

  try {
    const approvalRes = await pool.query<{
      submitted_by_associate_id: number | null;
    }>(
      `SELECT submitted_by_associate_id FROM migration.listing_approval_requests WHERE listing_id = $1 LIMIT 1`,
      [id]
    );
    if (!approvalRes.rows.length) return res.status(404).json({ error: 'No approval request found for this listing' });
    const approval = approvalRes.rows[0];

    let reviewerName = 'Admin';
    if (perms.associateDbId) {
      const r = await pool.query<{ full_name: string | null }>(
        `SELECT full_name FROM migration.core_associates WHERE id = $1 LIMIT 1`,
        [perms.associateDbId]
      );
      reviewerName = r.rows[0]?.full_name ?? 'Admin';
    }

    await pool.query(
      `UPDATE migration.listing_approval_requests SET
         status = 'REJECTED', reviewed_by_associate_id = $2, reviewed_by_name = $3,
         review_comment = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE listing_id = $1`,
      [id, perms.associateDbId ?? null, reviewerName, comment ?? null]
    );

    await pool.query(
      `UPDATE migration.core_listings SET listing_status_tag = 'Draft', is_draft = true, is_published = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    if (approval.submitted_by_associate_id) {
      const listingRes = await pool.query<{ listing_number: string | null }>(
        `SELECT listing_number FROM migration.core_listings WHERE id = $1 LIMIT 1`, [id]
      );
      try {
        await createNotification(
          pool, approval.submitted_by_associate_id,
          'LISTING_APPROVAL_REJECTED', 'REJECTED',
          `Listing not approved: ${listingRes.rows[0]?.listing_number ?? id}`,
          `Your listing ${listingRes.rows[0]?.listing_number ?? id} was not approved by ${reviewerName}.${comment ? ` Reason: ${comment}` : ''}`,
          'listing', id,
          { listing_id: id, listing_number: listingRes.rows[0]?.listing_number, reviewer_name: reviewerName, comment, status: 'REJECTED' }
        );
      } catch { /* notification table may not exist */ }
    }

    await pool.query(
      `UPDATE migration.in_app_notifications
          SET category = 'REJECTED',
              is_read = true,
              read_at = COALESCE(read_at, NOW()),
              updated_at = NOW()
        WHERE entity_type = 'listing'
          AND entity_id = $1
          AND notification_type = 'LISTING_APPROVAL_REQUESTED'`,
      [id]
    ).catch(() => undefined);

    return res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[reject-approval]', message);
    return res.status(500).json({ error: message });
  }
});

export default router;
