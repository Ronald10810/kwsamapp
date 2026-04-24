/**
 * repairEncoding.ts
 *
 * One-shot repair script that fixes Unicode replacement characters (U+FFFD)
 * that ended up in the database because the original Latin-1/Windows-1252 CSV
 * exports were previously read as UTF-8.
 *
 * Run from the backend directory:
 *   npm run data:repair:encoding -- \
 *     --associates  "C:\path\to\Associates.csv" \
 *     --listings    "C:\path\to\Listings.csv" \
 *     --transactions "C:\path\to\Transactions.csv"
 */
export {};
//# sourceMappingURL=repairEncoding.d.ts.map