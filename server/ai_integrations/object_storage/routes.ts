import type { Express } from "express";
import { ObjectStorageService, ObjectNotFoundError, isObjectStorageConfigured } from "./objectStorage";
import { canAccessObject, ObjectPermission } from "./objectAcl";
import { loadUser, requireAuth } from "../../role-middleware";

// Bumped from 25MB -- real chat file sharing (video clips, PPT decks) needs
// more headroom than the original example-route default.
const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "text/plain",
  "audio/wav",
  "audio/mpeg",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/3gpp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
  "application/x-zip-compressed",
];

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

      if (!name || typeof name !== "string") {
        return res.status(400).json({
          error: "Missing required field: name",
        });
      }
      if (!Number.isFinite(size) || size <= 0) {
        return res.status(400).json({ error: "Missing or invalid required field: size" });
      }
      if (size > MAX_UPLOAD_SIZE_BYTES) {
        return res.status(400).json({ error: `File exceeds maximum size of ${MAX_UPLOAD_SIZE_BYTES} bytes` });
      }
      if (!contentType || typeof contentType !== "string") {
        return res.status(400).json({ error: "Missing required field: contentType" });
      }
      if (!ALLOWED_UPLOAD_CONTENT_TYPES.includes(contentType)) {
        return res.status(400).json({ error: "Unsupported file type for upload" });
      }

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();

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
      await objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error serving object:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Object not found" });
      }
      return res.status(500).json({ error: "Failed to serve object" });
    }
  });
}

