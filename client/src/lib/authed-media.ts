import { useEffect, useState } from "react";
import { getAuthToken } from "@/hooks/use-auth";

/**
 * Chat attachments under /objects/ are private: the server only serves them
 * with the user's Bearer token. <img src> / <a href> can't send that header,
 * so we fetch the file ourselves and hand the browser a local blob URL.
 */
async function fetchObject(path: string): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(res.status === 403 ? "You don't have access to this file." : `Download failed (${res.status})`);
  return res.blob();
}

/** Blob URL for a private attachment, or null while loading. `enabled` lets big files wait for a click. */
export function useAuthedObjectUrl(path: string | null | undefined, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!path || !enabled) return;
    if (!path.startsWith("/objects/")) {
      setUrl(path);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    fetchObject(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load file"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, enabled]);

  return { url, error, loading };
}

/** Downloads a private attachment and saves it with its real file name. */
export async function downloadAuthedObject(path: string, fileName: string): Promise<void> {
  const blob = path.startsWith("/objects/") ? await fetchObject(path) : await (await fetch(path)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
