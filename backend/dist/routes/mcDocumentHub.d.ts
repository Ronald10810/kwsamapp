/**
 * MC Document Hub Routes
 *
 * Allows Office Admins and Regional Admins to manage a market-centre-scoped
 * document library ("MC Document Hub").
 *
 * Endpoints:
 *   GET    /          – list all documents for the current market centre
 *   POST   /          – upload a new document (multipart/form-data: title, description?, file)
 *   DELETE /:id       – delete a document record (and clean up local file if applicable)
 *
 * Supported file types: PDF, JPEG, PNG (max 20 MB)
 * Storage: GCS when configured, local disk otherwise (same pattern as agents.ts)
 *
 * DB table: migration.mc_document_hub (auto-created on startup if absent)
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=mcDocumentHub.d.ts.map