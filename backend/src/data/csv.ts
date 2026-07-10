import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

export type CsvRow = Record<string, string>;

export type CsvEncoding = 'utf8' | 'latin1';

function detectCsvEncodingFromBuffer(rawBuffer: Buffer): CsvEncoding {
  // UTF-8 BOM is explicit.
  if (rawBuffer.length >= 3 && rawBuffer[0] === 0xef && rawBuffer[1] === 0xbb && rawBuffer[2] === 0xbf) {
    return 'utf8';
  }

  // If UTF-8 decoding introduces replacement characters, the file likely uses
  // a single-byte code page (Windows-1252/Latin-1).
  const utf8Preview = rawBuffer.subarray(0, Math.min(rawBuffer.length, 256 * 1024)).toString('utf8');
  if (utf8Preview.includes('\uFFFD')) {
    return 'latin1';
  }

  return 'utf8';
}

export async function detectCsvEncoding(filePath: string): Promise<CsvEncoding> {
  const rawBuffer = await readFile(filePath);
  return detectCsvEncodingFromBuffer(rawBuffer);
}

export async function readCsvRows(filePath: string): Promise<CsvRow[]> {
  const rawBuffer = await readFile(filePath);
  const encoding = detectCsvEncodingFromBuffer(rawBuffer);
  const content = rawBuffer.toString(encoding);

  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as CsvRow[];

  return rows;
}

export function getValue(row: CsvRow, candidates: string[]): string | null {
  for (const key of candidates) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export function toNumeric(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/[, ]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
