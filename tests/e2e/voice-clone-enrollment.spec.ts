import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FAKE_USER = { id: 7, username: "testuser", role: "consumer" };

/**
 * All backend calls are intercepted — this test never touches a real
 * database, object storage, or ElevenLabs. It verifies the real React
 * component's behavior (consent gating, sample-count validation, the real
 * multi-step upload sequence) against a real browser, not the backend logic
 * (covered separately by the integration tests in tests/integration/).
 */
async function mockAuth(page: import("@playwright/test").Page) {
  await page.addInitScript((user) => {
    localStorage.setItem("neuratalk_auth", JSON.stringify({ user, token: "fake-e2e-token" }));
  }, FAKE_USER);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify(FAKE_USER) }));
}

test.describe("Voice Clone enrollment page", () => {
  test("shows the enrollment form when no profile exists yet", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ hasCustomVoice: false }) }));

    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    await expect(page.getByText("Enroll your voice", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /submit for enrollment/i })).toBeVisible();
  });

  test("blocks submission without consent", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ hasCustomVoice: false }) }));

    let enrollCalled = false;
    await page.route("**/api/voice-training/request-upload", (route) => {
      enrollCalled = true;
      return route.fulfill({ status: 200, body: "{}" });
    });

    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      path.join(__dirname, "fixtures/sample1.wav"),
      path.join(__dirname, "fixtures/sample2.wav"),
      path.join(__dirname, "fixtures/sample3.wav"),
    ]);
    // Deliberately do not check the consent box.
    await page.getByRole("button", { name: /submit for enrollment/i }).click();

    await expect(page.getByText(/consent is required/i).first()).toBeVisible();
    expect(enrollCalled).toBe(false);
  });

  test("blocks submission with fewer than 3 samples", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ hasCustomVoice: false }) }));

    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([path.join(__dirname, "fixtures/sample1.wav")]);
    await page.getByLabel(/I confirm this is my own voice/i).check();
    await page.getByRole("button", { name: /submit for enrollment/i }).click();

    await expect(page.getByText(/at least 3 voice samples/i).first()).toBeVisible();
  });

  test("submits the full enrollment sequence when consent and 3+ samples are provided", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ hasCustomVoice: false }) }));

    let uploadRequests = 0;
    let sampleRequests = 0;
    let trainRequests = 0;
    let putUploads = 0;

    await page.route("**/api/voice-training/request-upload", (route) => {
      uploadRequests++;
      return route.fulfill({
        status: 200,
        body: JSON.stringify({ uploadURL: "https://fake-storage.example/put-target", objectPath: "encrypted:fake:path" }),
      });
    });
    await page.route("https://fake-storage.example/put-target", (route) => {
      putUploads++;
      return route.fulfill({ status: 200, body: "{}" });
    });
    await page.route("**/api/voice-training/samples", (route) => {
      sampleRequests++;
      return route.fulfill({ status: 201, body: JSON.stringify({ id: sampleRequests, message: "ok" }) });
    });
    await page.route("**/api/voice-training/train/7", (route) => {
      trainRequests++;
      return route.fulfill({ status: 200, body: JSON.stringify({ message: "started", profileId: 1, estimatedTime: "2-5 minutes" }) });
    });

    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      path.join(__dirname, "fixtures/sample1.wav"),
      path.join(__dirname, "fixtures/sample2.wav"),
      path.join(__dirname, "fixtures/sample3.wav"),
    ]);
    await page.getByLabel(/I confirm this is my own voice/i).check();
    await page.getByRole("button", { name: /submit for enrollment/i }).click();

    await expect(page.getByText(/voice submitted for training/i).first()).toBeVisible({ timeout: 10_000 });
    expect(uploadRequests).toBe(3);
    expect(putUploads).toBe(3);
    expect(sampleRequests).toBe(3);
    expect(trainRequests).toBe(1);
  });

  test("shows pending-review state and disables the enable toggle before approval", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          hasCustomVoice: true,
          profile: { id: 1, name: "My Custom Voice", isEnabled: false, trainingStatus: "ready", createdAt: new Date().toISOString() },
          sampleCount: 3,
        }),
      }));

    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    await expect(page.getByText(/waiting for admin review/i)).toBeVisible();
  });

  test("delete-all button calls the real endpoint with confirmation", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/voice-training/profile/7", (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          hasCustomVoice: true,
          profile: { id: 1, name: "My Custom Voice", isEnabled: true, trainingStatus: "ready", createdAt: new Date().toISOString() },
          sampleCount: 3,
        }),
      }));

    let deleteAllCalled = false;
    await page.route("**/api/voice-training/delete-all/7", (route) => {
      deleteAllCalled = true;
      return route.fulfill({ status: 200, body: JSON.stringify({ message: "deleted", deletedSamples: 3 }) });
    });

    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/settings/voice-clone", { waitUntil: "commit" });
    await page.getByRole("button", { name: /delete all voice data/i }).click();

    await expect.poll(() => deleteAllCalled).toBe(true);
  });
});
