import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

export type CsvRow = Record<string, string>;

export async function readCsvRows(filePath: string): Promise<CsvRow[]> {
  const content = await readFile(filePath, 'utf8');

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
