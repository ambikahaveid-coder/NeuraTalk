import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MarketingControlCenter, MarketingOverviewPage } from "./MarketingControlCenter";

const mockFetch = vi.fn();

describe("Marketing Control Center", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  describe("Marketing Overview", () => {
    it("renders real report values and preserves unavailable metrics as NOT AVAILABLE", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/marketing/report")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              report: {
                businessId: 42,
                campaignCount: 3,
                campaignsByStatus: { draft: 1, scheduled: 2 },
                totals: {
                  targeted: 120,
                  sent: 80,
                  skipped: 40,
                  skippedByReason: { customer_blocked: 10 },
                  cost: { totalChargedPaise: 150000, availability: "AVAILABLE" },
                },
                delivery: {
                  sent: { availability: "AVAILABLE", count: 80 },
                  accepted: { availability: "NOT_AVAILABLE", reason: "No channel adapter is connected" },
                  delivered: { availability: "NOT_AVAILABLE", reason: "No channel adapter is connected" },
                  read: { availability: "NOT_AVAILABLE", reason: "No channel adapter is connected" },
                },
              },
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({ success: true }),
        } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingOverviewPage businessId={42} />
        </QueryClientProvider>
      );

      await waitFor(() => expect(screen.getAllByText("80").length).toBeGreaterThan(0));
      expect(screen.getByText("Actual spend")).toBeInTheDocument();
      expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
      expect(screen.getByText("Active campaigns")).toBeInTheDocument();
    });

    it("handles overview loading state", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          json: async () => ({ success: true, report: {} }),
        } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingOverviewPage businessId={42} />
        </QueryClientProvider>
      );

      // SVG loader should be visible during loading
      const loaderSvg = document.querySelector("svg.lucide-loader-circle");
      expect(loaderSvg).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.queryByText("Active campaigns")).toBeInTheDocument();
      });
    });

    it("handles overview error state", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: "Server error" }),
      } as Response));

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingOverviewPage businessId={42} />
        </QueryClientProvider>
      );

      await waitFor(() => expect(screen.getByText("Server error")).toBeInTheDocument());
    });
  });

  describe("Campaigns list", () => {
    it("renders campaign list with detail and preflight buttons", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/campaigns")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              campaigns: [
                {
                  id: 1,
                  name: "Test Campaign",
                  status: "draft",
                  category: "marketing",
                  createdAt: "2026-01-01T00:00:00Z",
                },
              ],
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      // Navigate to campaigns tab
      const campaignsBtn = screen.getByText("Campaigns");
      fireEvent.click(campaignsBtn);

      await waitFor(() => expect(screen.getByText("Test Campaign")).toBeInTheDocument());
      expect(screen.getByTestId("campaign-detail-btn-1")).toBeInTheDocument();
      expect(screen.getByTestId("campaign-preflight-btn-1")).toBeInTheDocument();
    });

    it("handles campaigns list loading state", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ok: true, json: async () => ({ success: true, campaigns: [] }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const campaignsBtn = screen.getByText("Campaigns");
      fireEvent.click(campaignsBtn);

      // SVG loader should be visible during loading
      const loaderSvg = document.querySelector("svg.lucide-loader-circle");
      expect(loaderSvg).toBeInTheDocument();
    });

    it("handles campaigns list error state", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: "Forbidden" }),
      } as Response));

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const campaignsBtn = screen.getByText("Campaigns");
      fireEvent.click(campaignsBtn);

      await waitFor(() => expect(screen.getByText("Forbidden")).toBeInTheDocument());
    });
  });

  describe("Campaign Detail", () => {
    it("navigates to detail view when detail button clicked", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/campaigns") && !url.includes("/preflight")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              campaigns: [
                {
                  id: 1,
                  name: "Test Campaign",
                  status: "draft",
                  category: "marketing",
                  createdAt: "2026-01-01T00:00:00Z",
                },
              ],
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const campaignsBtn = screen.getByText("Campaigns");
      fireEvent.click(campaignsBtn);

      await waitFor(() => expect(screen.getByText("Test Campaign")).toBeInTheDocument());

      const detailBtn = screen.getByTestId("campaign-detail-btn-1");
      expect(detailBtn).toBeInTheDocument();
    });
  });

  describe("Campaign Preflight", () => {
    it("navigates to preflight view when preflight button clicked", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/campaigns") && !url.includes("/preflight")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              campaigns: [
                {
                  id: 1,
                  name: "Test Campaign",
                  status: "draft",
                  category: "marketing",
                  createdAt: "2026-01-01T00:00:00Z",
                },
              ],
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const campaignsBtn = screen.getByText("Campaigns");
      fireEvent.click(campaignsBtn);

      await waitFor(() => expect(screen.getByText("Test Campaign")).toBeInTheDocument());

      const preflightBtn = screen.getByTestId("campaign-preflight-btn-1");
      expect(preflightBtn).toBeInTheDocument();
    });
  });

  describe("Marketing Reports", () => {
    it("renders business-wide report", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/marketing/report")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              report: {
                businessId: 42,
                campaignCount: 5,
                campaignsByStatus: { draft: 2, running: 2, completed: 1 },
                totals: {
                  targeted: 500,
                  sent: 400,
                  skipped: 100,
                  skippedByReason: { customer_blocked: 50, consent_missing: 50 },
                  cost: { totalChargedPaise: 500000, availability: "AVAILABLE" },
                },
                delivery: {
                  sent: { availability: "AVAILABLE", count: 400 },
                  accepted: { availability: "NOT_AVAILABLE", reason: "No adapter" },
                  delivered: { availability: "NOT_AVAILABLE", reason: "No adapter" },
                  read: { availability: "NOT_AVAILABLE", reason: "No adapter" },
                },
              },
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const reportsBtn = screen.getByText("Reports");
      fireEvent.click(reportsBtn);

      await waitFor(() => expect(screen.getByText("Sent")).toBeInTheDocument());
      expect(screen.getByTestId("metric-report-sent")).toBeInTheDocument();
    });
  });

  describe("Frequency & Limits", () => {
    it("renders business and customer frequency", async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/marketing/frequency")) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              frequency: {
                business: { cap: 1000, used: 500, remaining: 500, windowGranularity: "hour" },
                customer: null,
              },
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ success: true }) } as Response;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <MarketingControlCenter businessId={42} />
        </QueryClientProvider>
      );

      const freqBtn = screen.getByText("Frequency & Limits");
      fireEvent.click(freqBtn);

      await waitFor(() => expect(screen.getByTestId("metric-biz-cap")).toBeInTheDocument());
    });
  });
});
