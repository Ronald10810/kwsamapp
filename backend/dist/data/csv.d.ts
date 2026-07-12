export type CsvRow = Record<string, string>;
export type CsvEncoding = 'utf8' | 'latin1';
export declare function detectCsvEncoding(filePath: string): Promise<CsvEncoding>;
export declare function readCsvRows(filePath: string): Promise<CsvRow[]>;
export declare function getValue(row: CsvRow, candidates: string[]): string | null;
export declare function toNumeric(value: string | null): number | null;
//# sourceMappingURL=csv.d.ts.map