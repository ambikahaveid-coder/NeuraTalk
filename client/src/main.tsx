import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
  // Prevent app from crashing on uncaught errors
  event.preventDefault();
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  // Prevent app from crashing on unhandled promise rejections
  event.preventDefault();
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(<App />);
