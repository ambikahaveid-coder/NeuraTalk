import { describe, expect, it } from "vitest";
import { uploadRejection, MAX_UPLOAD_SIZE_BYTES } from "../../server/ai_integrations/object_storage/routes";

describe("chat upload rules", () => {
  it("accepts photos, videos, audio and office documents", () => {
    for (const [name, type] of [
      ["photo.jpg", "image/jpeg"],
      ["IMG_0001.HEIC", "image/heic"],
      ["party.gif", "image/gif"],
      ["clip.mp4", "video/mp4"],
      ["clip.mov", "video/quicktime"],
      ["song.mp3", "audio/mpeg"],
      ["report.pdf", "application/pdf"],
      ["letter.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["backup.zip", "application/zip"],
      ["drawing.dwg", "application/octet-stream"],
    ]) {
      expect(uploadRejection(name, 1000, type), name).toBeNull();
    }
  });

  it("blocks files that run code when opened, whatever type is declared", () => {
    for (const name of ["setup.exe", "app.apk", "page.html", "image.svg", "run.bat", "script.JS"]) {
      expect(uploadRejection(name, 1000, "application/octet-stream"), name).toMatch(/can't be sent/);
    }
  });

  it("rejects unknown declared types, empty and oversized files", () => {
    expect(uploadRejection("x.html", 10, "text/html")).toMatch(/Unsupported/);
    expect(uploadRejection("a.pdf", 0, "application/pdf")).toMatch(/size/);
    expect(uploadRejection("a.pdf", MAX_UPLOAD_SIZE_BYTES + 1, "application/pdf")).toMatch(/larger than/);
    expect(uploadRejection("", 10, "application/pdf")).toMatch(/name/);
  });
});
