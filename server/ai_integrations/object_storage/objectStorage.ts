/**
 * Object storage backing for user uploads (avatars, chat images, voice
 * notes/memos, voice-clone training clips) — S3-compatible (DigitalOcean
 * Spaces, or any real S3), not the previous implementation.
 *
 * The previous implementation signed URLs through a Google Cloud Storage
 * "sidecar" at http://127.0.0.1:1106 — that sidecar is a Replit-only local
 * credential broker and does not exist on this app's actual DigitalOcean
 * production host. Every call to it there fails outright (confirmed: no
 * PRIVATE_OBJECT_DIR/GCS credentials were ever configured in production),
 * so every upload built on top of it -- profile photos, chat image/voice
 * attachments, group voice notes, voice-clone training -- has never
 * actually worked outside of a Replit dev environment.
 *
 * This keeps the exact same public API (ObjectStorageService methods,
 * ObjectNotFoundError, the file-handle's exists/getMetadata/setMetadata/
 * createReadStream/delete shape) so none of the call sites elsewhere in the
 * codebase need to change -- only the storage backend underneath does.
 * Until OBJECT_STORAGE_S3_* env vars are set, every method throws the same
 * "not configured" error the old code did, so failures stay loud rather
 * than silent.
 */
import { randomUUID } from "crypto";
import { PassThrough, Readable } from "stream";
import type { Response } from "express";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function bucket(): string {
  const v = process.env.OBJECT_STORAGE_S3_BUCKET?.trim();
  if (!v) {
    throw new Error(
      "OBJECT_STORAGE_S3_BUCKET not set. Create a DigitalOcean Spaces bucket " +
        "(or any S3-compatible bucket) and set OBJECT_STORAGE_S3_BUCKET, " +
        "OBJECT_STORAGE_S3_ACCESS_KEY, OBJECT_STORAGE_S3_SECRET, " +
        "OBJECT_STORAGE_S3_REGION and OBJECT_STORAGE_S3_ENDPOINT.",
    );
  }
  return v;
}

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    process.env.OBJECT_STORAGE_S3_BUCKET?.trim() &&
    process.env.OBJECT_STORAGE_S3_ACCESS_KEY?.trim() &&
    process.env.OBJECT_STORAGE_S3_SECRET?.trim() &&
    process.env.OBJECT_STORAGE_S3_REGION?.trim(),
  );
}

let _client: S3Client | null = null;
export function objectStorageClient(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: process.env.OBJECT_STORAGE_S3_REGION?.trim() || "us-east-1",
    endpoint: process.env.OBJECT_STORAGE_S3_ENDPOINT?.trim() || undefined, // e.g. https://<region>.digitaloceanspaces.com
    forcePathStyle: process.env.OBJECT_STORAGE_S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.OBJECT_STORAGE_S3_ACCESS_KEY?.trim() || "",
      secretAccessKey: process.env.OBJECT_STORAGE_S3_SECRET?.trim() || "",
    },
  });
  return _client;
}

/** Duck-types the subset of @google-cloud/storage's `File` that call sites
 * across the codebase already use, so this can be a drop-in replacement. */
export class ObjectFileHandle {
  constructor(public readonly key: string) {}

  async exists(): Promise<[boolean]> {
    try {
      await objectStorageClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: this.key }));
      return [true];
    } catch {
      return [false];
    }
  }

  async getMetadata(): Promise<[{ contentType?: string; size?: number; metadata?: Record<string, string> }]> {
    const head = await objectStorageClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: this.key }));
    return [{
      contentType: head.ContentType,
      size: head.ContentLength,
      metadata: head.Metadata,
    }];
  }

  /** S3 has no in-place metadata update -- a self-copy with
   * MetadataDirective=REPLACE is the standard way to change it. */
  async setMetadata(update: { metadata: Record<string, string> }): Promise<void> {
    const [current] = await this.getMetadata();
    await objectStorageClient().send(new CopyObjectCommand({
      Bucket: bucket(),
      Key: this.key,
      CopySource: `${bucket()}/${this.key}`,
      Metadata: { ...(current.metadata || {}), ...update.metadata },
      MetadataDirective: "REPLACE",
      ContentType: current.contentType,
    }));
  }

  /** `range` is an inclusive byte range, as in an HTTP Range header. */
  createReadStream(range?: { start: number; end: number }): Readable {
    const passthrough = new PassThrough();
    objectStorageClient()
      .send(new GetObjectCommand({
        Bucket: bucket(),
        Key: this.key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }))
      .then((obj) => {
        const body = obj.Body as Readable;
        body.on("error", (err) => passthrough.emit("error", err));
        body.pipe(passthrough);
      })
      .catch((err) => passthrough.emit("error", err));
    return passthrough;
  }

  /** Downloads the full object into memory -- matches @google-cloud/storage's
   * File.download(), which some call sites (voice-training.ts) use directly. */
  async download(): Promise<[Buffer]> {
    const obj = await objectStorageClient().send(new GetObjectCommand({ Bucket: bucket(), Key: this.key }));
    const chunks: Buffer[] = [];
    for await (const chunk of obj.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return [Buffer.concat(chunks)];
  }

  async delete(): Promise<void> {
    await objectStorageClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: this.key }));
  }
}

export class ObjectStorageService {
  constructor() {}

  /**
   * Streams an object to the client.
   * - Supports single-range requests (206) so video/audio players can seek.
   * - `downloadName` sets the file name the browser/app saves it as.
   * - Only images, audio, video and PDF may render inline; everything else is
   *   forced to download, and nothing is sniffed or allowed to run scripts.
   */
  async downloadObject(
    file: ObjectFileHandle,
    res: Response,
    cacheTtlSec: number = 3600,
    opts: { range?: string; downloadName?: string; forceDownload?: boolean } = {},
  ) {
    try {
      const [metadata] = await file.getMetadata();
      const aclPolicy = await getObjectAclPolicy(file);
      const isPublic = aclPolicy?.visibility === "public";
      const contentType = metadata.contentType || "application/octet-stream";
      const size = metadata.size;
      const inlineSafe = /^(image\/(jpeg|png|gif|webp|heic|heif|bmp)|audio\/|video\/|application\/pdf$)/.test(contentType);
      const name = (opts.downloadName || "").replace(/[\r\n"\\/]/g, "_").slice(0, 200);
      const disposition = opts.forceDownload || !inlineSafe ? "attachment" : "inline";

      res.set({
        "Content-Type": contentType,
        "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Content-Disposition": name
          ? `${disposition}; filename="${name.replace(/[^ -~]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`
          : disposition,
      });

      let range: { start: number; end: number } | undefined;
      const m = opts.range && size !== undefined ? /^bytes=(\d*)-(\d*)$/.exec(opts.range.trim()) : null;
      if (m && size !== undefined && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        let end = m[1] && m[2] ? Number(m[2]) : size - 1;
        end = Math.min(end, size - 1);
        if (start > end || start >= size) {
          res.status(416).set("Content-Range", `bytes */${size}`).end();
          return;
        }
        range = { start, end };
        res.status(206).set({
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Content-Length": String(end - start + 1),
        });
      } else if (size !== undefined) {
        res.set("Content-Length", String(size));
      }

      const stream = file.createReadStream(range);
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Error streaming file" });
        } else {
          res.destroy(err as Error);
        }
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error downloading file:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error downloading file" });
      }
    }
  }

  /** When `contentType` is given it is signed into the URL, so the upload
   * must use exactly that Content-Type (a client can't declare a PDF and then
   * store HTML). */
  async getObjectEntityUploadURL(contentType?: string): Promise<string> {
    const key = `uploads/${randomUUID()}`;
    const command = new PutObjectCommand({ Bucket: bucket(), Key: key, ...(contentType ? { ContentType: contentType } : {}) });
    return getSignedUrl(objectStorageClient(), command, { expiresIn: 900 });
  }

  /** objectPath format is always "/objects/<s3 key>". */
  async getObjectEntityFile(objectPath: string): Promise<ObjectFileHandle> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice("/objects/".length);
    if (!key) {
      throw new ObjectNotFoundError();
    }
    const handle = new ObjectFileHandle(key);
    const [exists] = await handle.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return handle;
  }

  /** Converts a presigned upload URL (as returned by getObjectEntityUploadURL)
   * into the stable "/objects/<key>" path clients should store/reference. */
  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("/objects/")) return rawPath;
    try {
      const url = new URL(rawPath);
      // Path is "/<bucket>/<key>" (path-style) or "/<key>" (virtual-hosted-style).
      const parts = url.pathname.replace(/^\/+/, "").split("/");
      const key = parts[0] === bucket() ? parts.slice(1).join("/") : parts.join("/");
      return `/objects/${key}`;
    } catch {
      return rawPath;
    }
  }

  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: ObjectFileHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}
