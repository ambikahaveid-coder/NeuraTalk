import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const STALE_CHUNK_RELOAD_KEY = "neuratalk_stale_chunk_reload";

async function recoverFromStaleAsset(reason: unknown) {
  const message = String(
    (reason && typeof reason === "object" && "message" in reason
      ? (reason as { message?: unknown }).message
      : reason) || "",
  );
  const lowered = message.toLowerCase();
  const looksLikeChunkError =
    lowered.includes("chunkloaderror") ||
    lowered.includes("loading chunk") ||
    lowered.includes("failed to fetch dynamically imported module") ||
    lowered.includes("importing a module script failed");

  if (!looksLikeChunkError) return false;
  if (sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) === "1") return true;

  sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith("neuratalk-"))
        .map((key) => caches.delete(key)));
    }
  } catch (error) {
    console.warn("[PWA] Failed to clear stale assets", error);
  }

  window.location.reload();
  return true;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[PWA] Service worker registered:", registration.scope);
      })
      .catch((error) => {
        console.log("[PWA] Service worker registration failed:", error);
      });
  });
}

// Global error handlers for production crash prevention
window.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  void recoverFromStaleAsset(event.error);
  // Prevent app from crashing on uncaught errors
  event.preventDefault();
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  void recoverFromStaleAsset(event.reason);
  // Prevent app from crashing on unhandled promise rejections
  event.preventDefault();
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(<App />);
