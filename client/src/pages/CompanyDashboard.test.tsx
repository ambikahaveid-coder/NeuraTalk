import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentsTab, BusinessAccessDialog } from "./CompanyDashboard";

/**
 * P0-5 UI: exercises the new Business Access grant control added to the
 * existing Team tab, plus the pre-existing "UI exposes an action the
 * backend would reject" gap this same pass fixed (Add/Deactivate/Business
 * Access controls were previously visible to a plain "agent" viewer, who
 * would get a working-looking button that 403s server-side on click).
 */

const mockFetch = vi.fn();

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const AGENT_NO_PERMISSIONS = { id: 7, username: "agent7", email: "agent7@example.com", role: "agent", isActive: true, permissions: [] };
const AGENT_WITH_PERMISSIONS = { id: 8, username: "agent8", email: "agent8@example.com", role: "agent", isActive: true, permissions: ["customers:manage"] };

describe("AgentsTab RBAC visibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("hides Add Member / Business Access / Deactivate for a viewer who is not company_admin/super_admin (agent role)", () => {
    renderWithClient(
      <AgentsTab
        agents={{ agents: [AGENT_NO_PERMISSIONS] }}
        isLoading={false}
        canManageCompany={false}
        businessId={42}
      />,
    );

    expect(screen.queryByText("Add Member")).not.toBeInTheDocument();
    expect(screen.queryByText("Bulk Import")).not.toBeInTheDocument();
    expect(screen.queryByTestId(`button-business-access-${AGENT_NO_PERMISSIONS.id}`)).not.toBeInTheDocument();
    expect(screen.queryByText("Deactivate")).not.toBeInTheDocument();
    // The list itself still renders -- only the mutating/security-sensitive controls are hidden.
    expect(screen.getByText("agent7")).toBeInTheDocument();
  });

  it("shows Add Member / Business Access / Deactivate for a company_admin viewer", () => {
    renderWithClient(
      <AgentsTab
        agents={{ agents: [AGENT_NO_PERMISSIONS] }}
        isLoading={false}
        canManageCompany={true}
        businessId={42}
      />,
    );

    expect(screen.getByText("Add Member")).toBeInTheDocument();
    expect(screen.getByTestId(`button-business-access-${AGENT_NO_PERMISSIONS.id}`)).toBeInTheDocument();
    expect(screen.getByText("Deactivate")).toBeInTheDocument();
  });

  it("shows an empty state when there are no team members", () => {
    renderWithClient(
      <AgentsTab agents={{ agents: [] }} isLoading={false} canManageCompany={true} businessId={42} />,
    );
    expect(screen.getByText("No team members yet.")).toBeInTheDocument();
  });

  it("indicates how many business permissions a member already has", () => {
    renderWithClient(
      <AgentsTab agents={{ agents: [AGENT_WITH_PERMISSIONS] }} isLoading={false} canManageCompany={true} businessId={42} />,
    );
    expect(screen.getByText(/1 business permission granted/)).toBeInTheDocument();
  });
});

describe("BusinessAccessDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("fetches the grantable-permissions list live and renders it grouped, not from a hardcoded copy", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rbac/grantable-permissions")) {
        return { ok: true, json: async () => ({ permissions: ["customers:manage", "campaigns:view"] }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderWithClient(
      <BusinessAccessDialog agent={AGENT_NO_PERMISSIONS} businessId={42} onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText("Manage customers")).toBeInTheDocument());
    expect(screen.getByText("View campaigns")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/business/42/rbac/grantable-permissions",
      expect.anything(),
    );
  });

  it("renders an already-granted permission as locked/checked (cannot be unchecked) since the backend has no revoke path", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rbac/grantable-permissions")) {
        return { ok: true, json: async () => ({ permissions: ["customers:manage"] }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderWithClient(
      <BusinessAccessDialog agent={AGENT_WITH_PERMISSIONS} businessId={42} onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText("Manage customers")).toBeInTheDocument());
    expect(screen.getByText("(already granted)")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeDisabled();
    expect(checkbox).toBeChecked();
  });

  it("disables Save until a NEW permission is selected", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rbac/grantable-permissions")) {
        return { ok: true, json: async () => ({ permissions: ["customers:manage"] }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderWithClient(
      <BusinessAccessDialog agent={AGENT_NO_PERMISSIONS} businessId={42} onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText("Manage customers")).toBeInTheDocument());
    expect(screen.getByTestId("button-save-business-access")).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("button-save-business-access")).not.toBeDisabled();
  });

  it("submits only the NEWLY selected permission(s) to the correct businessId-scoped endpoint after confirmation, and closes on success", async () => {
    const onClose = vi.fn();
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rbac/grantable-permissions")) {
        return { ok: true, json: async () => ({ permissions: ["customers:manage"] }) } as Response;
      }
      if (url.includes("/rbac/grant-business-access")) {
        const body = JSON.parse(String(init?.body));
        expect(url).toBe("/api/business/42/rbac/grant-business-access");
        expect(body).toEqual({ userId: AGENT_NO_PERMISSIONS.id, permissions: ["customers:manage"] });
        return { ok: true, json: async () => ({ success: true, permissions: ["customers:manage"] }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    renderWithClient(
      <BusinessAccessDialog agent={AGENT_NO_PERMISSIONS} businessId={42} onClose={onClose} />,
    );

    await waitFor(() => expect(screen.getByText("Manage customers")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-save-business-access"));

    // Confirmation dialog gates the actual mutation (security-sensitive action).
    await waitFor(() => expect(screen.getByText("Confirm business access change")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("surfaces a 403 from the backend without crashing and without closing the dialog", async () => {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/rbac/grantable-permissions")) {
        return { ok: true, json: async () => ({ permissions: ["customers:manage"] }) } as Response;
      }
      if (url.includes("/rbac/grant-business-access")) {
        return { ok: false, status: 403, json: async () => ({ error: "You don't have permission to perform this action" }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true }) } as Response;
    });

    const onClose = vi.fn();
    renderWithClient(
      <BusinessAccessDialog agent={AGENT_NO_PERMISSIONS} businessId={42} onClose={onClose} />,
    );

    await waitFor(() => expect(screen.getByText("Manage customers")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-save-business-access"));
    await waitFor(() => expect(screen.getByText("Confirm business access change")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm"));

    // Dialog stays open (onClose not called) so the admin can see the error and retry.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Manage customers")).toBeInTheDocument();
  });

  it("shows an error state (not a blank dialog) when the grantable-permissions fetch itself fails", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
    } as Response));

    renderWithClient(
      <BusinessAccessDialog agent={AGENT_NO_PERMISSIONS} businessId={42} onClose={() => {}} />,
    );

    await waitFor(() => expect(screen.getByTestId("button-save-business-access")).toBeInTheDocument());
    expect(screen.getByTestId("button-save-business-access")).toBeDisabled();
  });
});
