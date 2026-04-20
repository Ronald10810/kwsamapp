import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
export async function readCsvRows(filePath) {
    const content = await readFile(filePath, 'utf8');
    const rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
    });
    return rows;
}
export function getValue(row, candidates) {
    for (const key of candidates) {
        const value = row[key];
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
export function toNumeric(value) {
    if (!value) {
        return null;
    }
    const cleaned = value.replace(/[, ]/g, '');
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}
//# sourceMappingURL=csv.js.map