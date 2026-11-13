import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ContactCard, MessageButtons, MessageListMenu, PaymentCard, rupeesText, type MessagePayment } from "./BusinessMessageExtras";
import { wallpaperCss } from "@/pages/WebAppPage";
import { serverMessage } from "@/lib/server-message";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 } }), getAuthToken: () => "t", requestSessionCheck: vi.fn() }));

const list = {
  button: "View menu",
  sections: [
    { title: "Tiffins", rows: [{ id: "idli", title: "Idli", description: "2 pcs" }, { id: "dosa", title: "Masala dosa" }] },
    { title: "Meals", rows: [{ id: "thali", title: "Andhra thali" }] },
  ],
};

const payment: MessagePayment = {
  requestId: 7, amountPaise: 25050, note: "2 idli + dosa", upiId: "shop@okaxis", payeeName: "Sri Sai",
  status: "requested", upiLink: "upi://pay?pa=shop%40okaxis&am=250.50", reference: "NT7",
};

describe("business message extras (web)", () => {
  it("reply buttons: quick reply sends its id; link and call buttons are links", () => {
    const onReply = vi.fn();
    render(<MessageButtons buttons={[{ type: "quick_reply", id: "am", title: "Morning" }, { type: "url", title: "Site", url: "https://x.in" }, { type: "call", title: "Call us", phone: "+91 99999 00000" }]} onReply={onReply} />);
    fireEvent.click(screen.getByText("Morning"));
    expect(onReply).toHaveBeenCalledWith("am");
    expect(screen.getByText("Site").closest("a")?.getAttribute("href")).toBe("https://x.in");
    expect(screen.getByText("Call us").closest("a")?.getAttribute("href")).toBe("tel:+919999900000");
  });

  it("reply buttons are locked once one was tapped", () => {
    const onReply = vi.fn();
    render(<MessageButtons buttons={[{ type: "quick_reply", id: "am", title: "Morning" }]} tappedId="am" onReply={onReply} />);
    expect(screen.getByText("Morning").closest("button")).toBeDisabled();
  });

  it("list menu opens and picking an option replies with it", async () => {
    const onPick = vi.fn();
    render(<MessageListMenu list={list} onPick={onPick} />);
    fireEvent.click(screen.getByTestId("message-list-open"));
    expect(await screen.findByText("Tiffins")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("message-list-row-dosa"));
    expect(onPick).toHaveBeenCalledWith("dosa");
  });

  it("contact card shows the name and a call link", () => {
    render(<ContactCard contact={{ name: "Suresh", phone: "+91 98765 43210", organization: "Delivery" }} />);
    expect(screen.getByText("Suresh")).toBeInTheDocument();
    expect(screen.getByLabelText("Call Suresh").getAttribute("href")).toBe("tel:+919876543210");
  });

  it("payment card (customer): QR to scan and I've paid with a UTR", async () => {
    const onPaid = vi.fn(async () => undefined);
    render(<PaymentCard payment={payment} onPaid={onPaid} />);
    expect(screen.getByText("250.50")).toBeInTheDocument();
    expect(await screen.findByAltText("UPI QR code to pay")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("payment-i-paid"));
    fireEvent.change(await screen.findByLabelText("UTR or reference"), { target: { value: "412345678901" } });
    fireEvent.click(screen.getByText("Tell the business"));
    await waitFor(() => expect(onPaid).toHaveBeenCalledWith("412345678901"));
  });

  it("payment card (business): confirm money received; nothing to do once paid", () => {
    const onSettle = vi.fn();
    const { rerender } = render(<PaymentCard payment={{ ...payment, status: "customer_paid" }} onSettle={onSettle} />);
    expect(screen.getByText("Customer says they paid · check your bank")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("payment-received"));
    expect(onSettle).toHaveBeenCalledWith("paid");
    rerender(<PaymentCard payment={{ ...payment, status: "paid" }} onSettle={onSettle} />);
    expect(screen.queryByTestId("payment-received")).toBeNull();
    expect(screen.getByText("Paid ✓")).toBeInTheDocument();
  });

  it("rupees text", () => {
    expect(rupeesText(25050)).toBe("₹250.50");
    expect(rupeesText(10000)).toBe("₹100");
  });
});

describe("web chat wallpaper", () => {
  it("matches the app's wallpaper choices and ignores bad values", () => {
    expect(wallpaperCss(undefined, false)).toBeNull();
    expect(wallpaperCss({ chatKey: "default", kind: "none", value: "", dim: 0 }, false)).toBeNull();
    expect(wallpaperCss({ chatKey: "default", kind: "color", value: "#1F6F5C", dim: 0 }, false)).toEqual({ background: "#1F6F5C" });
    expect(String(wallpaperCss({ chatKey: "default", kind: "preset", value: "sky", dim: 20 }, true)?.background)).toContain("rgba(0,0,0,0.2)");
    expect(wallpaperCss({ chatKey: "default", kind: "color", value: "red;}", dim: 0 }, false)).toBeNull();
  });
});

describe("server messages", () => {
  it("shows the server's sentence from an apiRequest error", () => {
    expect(serverMessage(new Error('403: {"error":"An admin removed you from this group."}'), "x")).toBe("An admin removed you from this group.");
    expect(serverMessage(new Error("500: oops"), "x")).toBe("oops");
    expect(serverMessage(null, "fallback")).toBe("fallback");
  });
});
