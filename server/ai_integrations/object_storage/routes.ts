import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError, isObjectStorageConfigured } from "./objectStorage";
import { canAccessObject, ObjectPermission } from "./objectAcl";
import { loadUser, requireAuth } from "../../role-middleware";

// Chat file sharing (photos, videos, documents). Uploads go straight to
// S3 via a presigned URL, so the server never holds the file in memory.
export const MAX_UPLOAD_SIZE_BYTES = 200 * 1024 * 1024;

export const ALLOWED_UPLOAD_CONTENT_TYPES = [
  // Images (HEIC/HEIF = iPhone photos)
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/bmp",
  // Audio
  "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/webm", "audio/mp4", "audio/x-m4a", "audio/m4a",
  "audio/aac", "audio/ogg", "audio/opus", "audio/amr", "audio/3gpp", "audio/flac",
  // Video
  "video/mp4", "video/quicktime", "video/webm", "video/3gpp", "video/x-matroska", "video/x-msvideo", "video/mpeg",
  // Documents
  "application/pdf", "text/plain", "text/csv", "application/rtf", "text/rtf", "application/json",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation", "application/epub+zip",
  // Archives
  "application/zip", "application/x-zip-compressed", "application/x-7z-compressed",
  "application/x-rar-compressed", "application/vnd.rar", "application/gzip", "application/x-tar",
  // Any other document the phone can't name. Always served as a download
  // (never rendered), see ObjectStorageService.downloadObject.
  "application/octet-stream",
];

// Files that run code when opened. Blocked by extension because their
// declared type can be anything (usually application/octet-stream).
export const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  "exe", "msi", "bat", "cmd", "com", "scr", "pif", "cpl", "vbs", "vbe", "js", "jse", "wsf", "wsh", "ps1",
  "psm1", "hta", "jar", "apk", "aab", "xapk", "dll", "sys", "reg", "lnk", "html", "htm", "xhtml", "svg", "svgz",
  "sh", "app", "dmg", "deb", "rpm",
]);

export function uploadRejection(name: string, size: unknown, contentType: unknown): string | null {
  if (!name || typeof name !== "string") return "Missing required field: name";
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return "Missing or invalid required field: size";
  if (size > MAX_UPLOAD_SIZE_BYTES) return `File is larger than ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB`;
  if (!contentType || typeof contentType !== "string") return "Missing required field: contentType";
  if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(contentType)) return "Unsupported file type for upload";
  const ext = name.toLowerCase().split(".").pop() || "";
  if (name.includes(".") && BLOCKED_UPLOAD_EXTENSIONS.has(ext)) return "This type of file can't be sent for safety reasons";
  return null;
}

/**
 * Register object storage routes for file uploads.
 *
 * This provides example routes for the presigned URL upload flow:
 * 1. POST /api/uploads/request-url - Get a presigned URL for uploading
 * 2. The client then uploads directly to the presigned URL
 *
 * IMPORTANT: These are example routes. Customize based on your use case:
 * - Add authentication middleware for protected uploads
 * - Add file metadata storage (save to database after upload)
 * - Add ACL policies for access control
 */
export function registerObjectStorageRoutes(app: Express): void {
  const objectStorageService = new ObjectStorageService();

  /**
   * Request a presigned URL for file upload.
   *
   * Request body (JSON):
   * {
   *   "name": "filename.jpg",
   *   "size": 12345,
   *   "contentType": "image/jpeg"
   * }
   *
   * Response:
   * {
   *   "uploadURL": "https://storage.googleapis.com/...",
   *   "objectPath": "/objects/uploads/uuid"
   * }
   *
   * IMPORTANT: The client should NOT send the file to this endpoint.
   * Send JSON metadata only, then upload the file directly to uploadURL.
   */
  app.post("/api/uploads/request-url", loadUser, requireAuth, async (req, res) => {
    try {
      if (!isObjectStorageConfigured()) {
        return res.status(503).json({ error: "File uploads are not available right now." });
      }

      const { name, size, contentType } = req.body;

      const rejection = uploadRejection(name, size, contentType);
      if (rejection) {
        return res.status(400).json({ error: rejection });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL(contentType);

      // Extract object path from the presigned URL for later reference
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json({
        uploadURL,
        objectPath,
        // Echo back the metadata for client convenience
        metadata: { name, size, contentType },
      });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  /**
   * Serve uploaded objects.
   *
   * GET /objects/:objectPath(*)
   *
   * This serves files from object storage. For public files, no auth needed.
   * For protected files, add authentication middleware and ACL checks.
   */
  app.get("/objects/:objectPath(*)", loadUser, async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      const acl = await canAccessObject({
        userId: req.user?.id ? String(req.user.id) : undefined,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      });
      if (!acl) {
        return res.status(403).json({ error: "You do not have access to this object" });
      }
      // ?name= gives the saved file its real name; ?download=1 forces a download.
      const downloadName = typeof req.query.name === "string" ? req.query.name : undefined;
      await objectStorageService.downloadObject(objectFile, res, 3600, {
        range: typeof req.headers.range === "string" ? req.headers.range : undefined,
        downloadName,
        forceDownload: req.query.download === "1",
      });
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

