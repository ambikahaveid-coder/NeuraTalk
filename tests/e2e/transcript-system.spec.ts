import { test, expect } from "@playwright/test";

/**
 * All backend calls are intercepted — this suite verifies the real React
 * components' behavior (CallHistory's search/export/delete, the RBAC guard
 * in App.tsx, and the enterprise TranscriptAdminDashboard) against a real
 * browser, not the backend logic (covered separately by
 * tests/integration/transcripts.test.ts). Follows the same route-mocking
 * pattern established for tests/e2e/voice-clone-enrollment.spec.ts, which is
 * what stabilized Playwright in this sandbox after prior flakiness.
 */

const CONSUMER_USER = { id: 7, username: "consumer", role: "consumer" };
const COMPANY_ADMIN_USER = { id: 3, username: "orgadmin", role: "company_admin", organizationId: 42 };

async function mockAuth(page: import("@playwright/test").Page, user: Record<string, unknown>) {
  await page.addInitScript((u) => {
    localStorage.setItem("neuratalk_auth", JSON.stringify({ user: u, token: "fake-e2e-token" }));
  }, user);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify(user) }));
}

const CALL_LIST = [
  {
    id: 1,
    callerNumber: "+911234567890",
    receiverNumber: "+919876543210",
    status: "completed",
    createdAt: new Date().toISOString(),
    connectedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    duration: 42,
  },
];

const CALL_DETAIL = {
  call: CALL_LIST[0],
  translations: [
    { originalText: "Hello, how are you?", translatedText: "Hola, ¿cómo estás?" },
    { originalText: "I am fine, thank you.", translatedText: "Estoy bien, gracias." },
  ],
};

test.describe("Transcript system — consumer (CallHistory)", () => {
  test("transcript segments created during a call are visible in call details", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));
    await page.route("**/api/features/call-history/1", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_DETAIL) }));

    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("card-call-1").click();

    await expect(page.getByText("Hello, how are you?")).toBeVisible();
    await expect(page.getByText("Hola, ¿cómo estás?")).toBeVisible();
  });

  test("search returns matching transcript segments", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));

    let searchedQuery = "";
    await page.route("**/api/transcripts/search*", (route) => {
      const url = new URL(route.request().url());
      searchedQuery = url.searchParams.get("q") ?? "";
      return route.fulfill({
        status: 200,
        body: JSON.stringify({
          query: searchedQuery,
          results: [{ originalText: "Meeting tomorrow", translatedText: "Réunion demain", timestamp: new Date().toISOString() }],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      });
    });

    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("input-transcript-search").fill("meeting");
    await page.getByTestId("button-search-transcripts").click();

    await expect(page.getByText("Meeting tomorrow")).toBeVisible();
    await expect(page.getByText("Réunion demain")).toBeVisible();
    expect(searchedQuery).toBe("meeting");
  });

  test("exports transcript as TXT", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));
    await page.route("**/api/features/call-history/1", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_DETAIL) }));

    let exportedFormat = "";
    await page.route("**/api/transcripts/1/export/*", (route) => {
      exportedFormat = route.request().url().split("/").pop() ?? "";
      return route.fulfill({ status: 200, contentType: "text/plain", body: "plain text transcript" });
    });

    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("card-call-1").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("button-export-txt").click();
    const download = await downloadPromise;

    expect(exportedFormat).toBe("txt");
    expect(download.suggestedFilename()).toBe("transcript-1.txt");
  });

  test("exports transcript as PDF", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));
    await page.route("**/api/features/call-history/1", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_DETAIL) }));
    await page.route("**/api/transcripts/1/export/pdf", (route) =>
      route.fulfill({ status: 200, contentType: "application/pdf", body: Buffer.from("%PDF-fake") }));

    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("card-call-1").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("button-export-pdf").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("transcript-1.pdf");
  });

  test("exports transcript as DOCX", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));
    await page.route("**/api/features/call-history/1", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_DETAIL) }));
    await page.route("**/api/transcripts/1/export/docx", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: Buffer.from("PKfake"),
      }));

    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("card-call-1").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("button-export-docx").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("transcript-1.docx");
  });

  test("deletes a transcript after confirmation", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/call-history", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_LIST) }));
    await page.route("**/api/features/call-history/1", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(CALL_DETAIL) }));

    let deleteCalled = false;
    await page.route("**/api/transcripts/1", (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
        return route.fulfill({ status: 200, body: JSON.stringify({ success: true, deletedCount: 2 }) });
      }
      return route.continue();
    });

    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/call-history", { waitUntil: "commit" });
    await page.getByTestId("card-call-1").click();
    await page.getByTestId("button-delete-transcript").click();

    await expect.poll(() => deleteCalled).toBe(true);
    await expect(page.getByText("Transcript deleted")).toBeVisible();
  });
});

test.describe("Transcript system — RBAC", () => {
  test("a consumer is redirected away from the enterprise transcript admin dashboard", async ({ page }) => {
    await mockAuth(page, CONSUMER_USER);
    await page.route("**/api/features/**", (route) => route.fulfill({ status: 200, body: "{}" }));

    await page.goto("/admin/transcripts", { waitUntil: "commit" });

    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a company_admin can reach the enterprise transcript admin dashboard", async ({ page }) => {
    await mockAuth(page, COMPANY_ADMIN_USER);
    await page.route("**/api/admin/transcripts/retention", (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ orgDefault: "none (platform default: 30 days)", members: [{ userId: 9, username: "member1", email: "m1@x.com", retention: "none" }] }),
      }));
    await page.route("**/api/admin/transcripts/audit-log", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ logs: [] }) }));

    await page.goto("/admin/transcripts", { waitUntil: "commit" });

    await expect(page.getByText("Transcript Administration")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/transcripts$/);
  });
});

test.describe("Transcript system — enterprise admin search", () => {
  test("company_admin can search organization transcripts with filters", async ({ page }) => {
    await mockAuth(page, COMPANY_ADMIN_USER);
    await page.route("**/api/admin/transcripts/retention", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ orgDefault: "none (platform default: 30 days)", members: [] }) }));
    await page.route("**/api/admin/transcripts/audit-log", (route) =>
      route.fulfill({ status: 200, body: JSON.stringify({ logs: [] }) }));

    let capturedUrl = "";
    await page.route("**/api/admin/transcripts/search*", (route) => {
      capturedUrl = route.request().url();
      return route.fulfill({
        status: 200,
        body: JSON.stringify({
          query: "invoice",
          results: [{ id: 1, callId: 55, originalText: "Send the invoice", translatedText: "Envoyez la facture", timestamp: new Date().toISOString() }],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      });
    });

    await page.goto("/admin/transcripts", { waitUntil: "commit" });
    await page.getByTestId("input-admin-transcript-search").fill("invoice");
    await page.getByTestId("input-admin-filter-userid").fill("9");
    await page.getByTestId("button-admin-search-transcripts").click();

    await expect(page.getByText("Send the invoice")).toBeVisible();
    await expect(page.getByText("Envoyez la facture")).toBeVisible();
    expect(capturedUrl).toContain("q=invoice");
    expect(capturedUrl).toContain("userId=9");
  });
});
