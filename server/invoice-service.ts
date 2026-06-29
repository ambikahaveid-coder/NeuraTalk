/**
 * INVOICE GENERATION SERVICE
 * 
 * GST-compliant invoice generation with PDF support.
 * 
 * FEATURES:
 * - Unique invoice number generation
 * - GST calculation (CGST/SGST/IGST)
 * - Line items with HSN codes
 * - PDF generation
 * - Storage integration
 */

import { db } from "./db";
import {
  invoices, invoiceLineItems, gstSettings, subscriptions, usageRecords,
  organizations, users, billingPlans,
  INVOICE_STATUS, type Invoice, type InvoiceLineItem
} from "@shared/schema";
import { eq, sql, and, gte, lte } from "drizzle-orm";
import { logger } from "./observability";

// ============================================================================
// TYPES
// ============================================================================

interface CreateInvoiceParams {
  userId?: number;
  organizationId?: number;
  subscriptionId?: number;
  periodStart: Date;
  periodEnd: Date;
  lineItems: {
    description: string;
    quantity: number;
    unitPricePaise: number;
    hsnCode?: string;
    usageRecordId?: number;
    planId?: number;
  }[];
  notes?: string;
}

interface InvoiceResult {
  success: boolean;
  invoice?: Invoice;
  message?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get platform GST settings
 */
async function getPlatformGstSettings() {
  const [settings] = await db.select()
    .from(gstSettings)
    .where(sql`${gstSettings.organizationId} IS NULL`);
  return settings;
}

/**
 * Get organization GST settings
 */
async function getOrgGstSettings(organizationId: number) {
  const [settings] = await db.select()
    .from(gstSettings)
    .where(eq(gstSettings.organizationId, organizationId));
  return settings;
}

/**
 * Generate next invoice number
 */
async function getNextInvoiceNumber(): Promise<string> {
  const platformSettings = await getPlatformGstSettings();
  const prefix = platformSettings?.invoicePrefix || "INV";
  const counter = (platformSettings?.invoiceCounter || 0) + 1;
  
  // Update counter
  if (platformSettings) {
    await db.update(gstSettings)
      .set({ invoiceCounter: counter })
      .where(eq(gstSettings.id, platformSettings.id));
  }
  
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, "0");
  const paddedCounter = String(counter).padStart(6, "0");
  
  return `${prefix}/${year}${month}/${paddedCounter}`;
}

/**
 * Calculate GST amounts
 */
function calculateGst(
  taxableAmountPaise: number,
  gstPercentage: number,
  isInterState: boolean
): { cgst: number; sgst: number; igst: number; totalTax: number } {
  const totalTax = Math.round((taxableAmountPaise * gstPercentage) / 100);
  
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: totalTax, totalTax };
  }
  
  const halfTax = Math.round(totalTax / 2);
  return { cgst: halfTax, sgst: halfTax, igst: 0, totalTax };
}

/**
 * Format price for display
 */
export function formatPricePaise(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format date for invoice
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ============================================================================
// INVOICE GENERATION
// ============================================================================

/**
 * Create a new invoice
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResult> {
  try {
    const { userId, organizationId, subscriptionId, periodStart, periodEnd, lineItems, notes } = params;

    if (!userId && !organizationId) {
      return { success: false, message: "Either userId or organizationId is required" };
    }

    if (lineItems.length === 0) {
      return { success: false, message: "At least one line item is required" };
    }

    // Get platform GST settings
    const platformGst = await getPlatformGstSettings();
    if (!platformGst) {
      return { success: false, message: "Platform GST settings not configured" };
    }

    // Get customer details
    let customerName = "";
    let customerEmail: string | null = null;
    let customerPhone: string | null = null;
    let customerGstin: string | null = null;
    let customerAddress: string | null = null;
    let customerStateCode: string | null = null;

    if (organizationId) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
      if (org) {
        customerName = org.name;
        customerEmail = org.email;
        customerPhone = org.phone;
        customerAddress = org.address;
        
        // Get org GST settings
        const orgGst = await getOrgGstSettings(organizationId);
        if (orgGst) {
          customerGstin = orgGst.gstin;
          customerStateCode = orgGst.stateCode;
        }
      }
    } else if (userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) {
        customerName = user.username;
        customerEmail = user.email;
        customerPhone = user.phone;
      }
    }

    if (!customerName) {
      return { success: false, message: "Customer not found" };
    }

    // Calculate totals
    let subtotalPaise = 0;
    for (const item of lineItems) {
      subtotalPaise += item.quantity * item.unitPricePaise;
    }

    const discountPaise = 0; // Future: Add discount support
    const taxableAmountPaise = subtotalPaise - discountPaise;
    
    // Determine if inter-state (different state codes)
    const isInterState = customerStateCode !== null && 
                         platformGst.stateCode !== null && 
                         customerStateCode !== platformGst.stateCode;

    const gstPercentage = platformGst.defaultGstRate || 18;
    const { cgst, sgst, igst, totalTax } = calculateGst(taxableAmountPaise, gstPercentage, isInterState);

    const totalAmountPaise = taxableAmountPaise + totalTax;

    // Generate invoice number
    const invoiceNumber = await getNextInvoiceNumber();

    // Calculate due date (15 days from now)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 15);

    // Create invoice
    const [invoice] = await db.insert(invoices).values({
      invoiceNumber,
      userId,
      organizationId,
      subscriptionId,
      periodStart,
      periodEnd,
      subtotalPaise,
      discountPaise,
      taxableAmountPaise,
      cgstPaise: cgst,
      sgstPaise: sgst,
      igstPaise: igst,
      totalTaxPaise: totalTax,
      totalAmountPaise,
      currency: "INR",
      gstPercentage,
      placeOfSupply: platformGst.placeOfSupply,
      isInterState,
      customerName,
      customerEmail,
      customerPhone,
      customerGstin,
      customerAddress,
      sellerName: platformGst.legalName,
      sellerGstin: platformGst.gstin,
      sellerAddress: platformGst.registeredAddress,
      status: "pending",
      dueDate,
      notes,
    }).returning();

    // Create line items
    for (const item of lineItems) {
      await db.insert(invoiceLineItems).values({
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity,
        unitPricePaise: item.unitPricePaise,
        totalPaise: item.quantity * item.unitPricePaise,
        usageRecordId: item.usageRecordId,
        planId: item.planId,
        hsnCode: item.hsnCode || platformGst.hsnCode,
      });
    }

    logger.info("Invoice", `Invoice created: ${invoiceNumber} for ${customerName}`);

    return { success: true, invoice };
  } catch (err) {
    logger.error("Invoice", "Failed to create invoice", err as Error);
    return { success: false, message: "Failed to create invoice" };
  }
}

/**
 * Create invoice for subscription purchase
 */
export async function createSubscriptionInvoice(subscriptionId: number): Promise<InvoiceResult> {
  try {
    // Get subscription with plan
    const [subscription] = await db.select({
      subscription: subscriptions,
      plan: billingPlans,
    })
      .from(subscriptions)
      .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
      .where(eq(subscriptions.id, subscriptionId));

    if (!subscription) {
      return { success: false, message: "Subscription not found" };
    }

    const { subscription: sub, plan } = subscription;

    return createInvoice({
      userId: sub.userId || undefined,
      organizationId: sub.organizationId || undefined,
      subscriptionId: sub.id,
      periodStart: sub.startDate!,
      periodEnd: sub.endDate!,
      lineItems: [
        {
          description: `${plan.name} - ${plan.duration} subscription`,
          quantity: 1,
          unitPricePaise: plan.priceInPaise,
          planId: plan.id,
        },
      ],
    });
  } catch (err) {
    logger.error("Invoice", "Failed to create subscription invoice", err as Error);
    return { success: false, message: "Failed to create subscription invoice" };
  }
}

/**
 * Create invoice for postpaid usage
 */
export async function createUsageInvoice(
  organizationId: number,
  periodStart: Date,
  periodEnd: Date
): Promise<InvoiceResult> {
  try {
    // Get unbilled usage records
    const usageItems = await db.select()
      .from(usageRecords)
      .where(and(
        eq(usageRecords.organizationId, organizationId),
        eq(usageRecords.billed, false),
        gte(usageRecords.usageDate, periodStart),
        lte(usageRecords.usageDate, periodEnd)
      ));

    if (usageItems.length === 0) {
      return { success: false, message: "No unbilled usage found" };
    }

    // Create line items from usage
    const lineItems = usageItems.map(usage => {
      const billingSnapshot = usage.billingSnapshot as Record<string, unknown> | null;
      const invoiceableAmountPaise = typeof billingSnapshot?.invoiceableAmountPaise === "number"
        ? Math.max(0, billingSnapshot.invoiceableAmountPaise)
        : Math.max(0, usage.totalCostPaise || 0);

      return {
      description: `${usage.callType || "voice"} usage - ${usage.minutesConsumed} minutes (${formatDate(usage.usageDate!)})`,
      quantity: 1,
      unitPricePaise: invoiceableAmountPaise,
      usageRecordId: usage.id,
      };
    });

    const result = await createInvoice({
      organizationId,
      periodStart,
      periodEnd,
      lineItems,
    });

    // Mark usage as billed
    if (result.success && result.invoice) {
      for (const usage of usageItems) {
        await db.update(usageRecords)
          .set({ 
            billed: true, 
            invoiceId: result.invoice.id 
          })
          .where(eq(usageRecords.id, usage.id));
      }
    }

    return result;
  } catch (err) {
    logger.error("Invoice", "Failed to create usage invoice", err as Error);
    return { success: false, message: "Failed to create usage invoice" };
  }
}

/**
 * Mark invoice as paid
 */
export async function markInvoicePaid(invoiceId: number, paymentId?: number): Promise<InvoiceResult> {
  try {
    const [invoice] = await db.update(invoices)
      .set({
        status: "paid",
        paidAt: new Date(),
        paymentId,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoiceId))
      .returning();

    logger.info("Invoice", `Invoice marked paid: ${invoice.invoiceNumber}`);

    return { success: true, invoice };
  } catch (err) {
    logger.error("Invoice", "Failed to mark invoice paid", err as Error);
    return { success: false, message: "Failed to mark invoice paid" };
  }
}

// ============================================================================
// PDF GENERATION
// ============================================================================

/**
 * Generate HTML for invoice (can be converted to PDF)
 */
export async function generateInvoiceHtml(invoiceId: number): Promise<string | null> {
  try {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) return null;

    const lineItems = await db.select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId));

    const platformGst = await getPlatformGstSettings();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', sans-serif; color: #333; background: #fff; padding: 40px; }
    .invoice { max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; border-bottom: 2px solid #0891b2; padding-bottom: 20px; }
    .company-name { font-size: 24px; font-weight: bold; color: #0891b2; }
    .invoice-title { font-size: 32px; font-weight: bold; color: #333; }
    .invoice-meta { text-align: right; }
    .invoice-meta p { margin: 4px 0; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .party { width: 45%; }
    .party-label { font-weight: bold; color: #666; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; }
    .party-name { font-size: 18px; font-weight: bold; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f8fafc; text-align: left; padding: 12px; border-bottom: 2px solid #e2e8f0; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #e2e8f0; }
    .text-right { text-align: right; }
    .totals { margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .totals-row.total { font-size: 18px; font-weight: bold; border-top: 2px solid #0891b2; border-bottom: none; padding-top: 16px; }
    .footer { margin-top: 60px; text-align: center; color: #666; font-size: 12px; }
    .status { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-paid { background: #d1fae5; color: #065f46; }
    .gst-info { margin-top: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div>
        <div class="company-name">${invoice.sellerName}</div>
        <p style="margin-top: 8px;">GSTIN: ${invoice.sellerGstin || "Not Registered"}</p>
        <p>${invoice.sellerAddress || ""}</p>
      </div>
      <div class="invoice-meta">
        <div class="invoice-title">TAX INVOICE</div>
        <p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>
        <p><strong>Date:</strong> ${formatDate(invoice.createdAt!)}</p>
        <p><strong>Due Date:</strong> ${invoice.dueDate ? formatDate(invoice.dueDate) : "N/A"}</p>
        <p style="margin-top: 8px;">
          <span class="status ${invoice.status === "paid" ? "status-paid" : "status-pending"}">
            ${invoice.status?.toUpperCase()}
          </span>
        </p>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">Bill To</div>
        <div class="party-name">${invoice.customerName}</div>
        ${invoice.customerEmail ? `<p>Email: ${invoice.customerEmail}</p>` : ""}
        ${invoice.customerPhone ? `<p>Phone: ${invoice.customerPhone}</p>` : ""}
        ${invoice.customerGstin ? `<p>GSTIN: ${invoice.customerGstin}</p>` : ""}
        ${invoice.customerAddress ? `<p>${invoice.customerAddress}</p>` : ""}
      </div>
      <div class="party" style="text-align: right;">
        <div class="party-label">Invoice Period</div>
        <p>${formatDate(invoice.periodStart!)} - ${formatDate(invoice.periodEnd!)}</p>
        <p style="margin-top: 8px;"><strong>Place of Supply:</strong> ${invoice.placeOfSupply || "N/A"}</p>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width: 50%;">Description</th>
          <th>HSN/SAC</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(item => `
          <tr>
            <td>${item.description}</td>
            <td>${item.hsnCode || platformGst?.hsnCode || ""}</td>
            <td class="text-right">${item.quantity}</td>
            <td class="text-right">${formatPricePaise(item.unitPricePaise)}</td>
            <td class="text-right">${formatPricePaise(item.totalPaise)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formatPricePaise(invoice.subtotalPaise)}</span>
      </div>
      ${invoice.discountPaise && invoice.discountPaise > 0 ? `
        <div class="totals-row">
          <span>Discount</span>
          <span>-${formatPricePaise(invoice.discountPaise)}</span>
        </div>
      ` : ""}
      <div class="totals-row">
        <span>Taxable Amount</span>
        <span>${formatPricePaise(invoice.taxableAmountPaise)}</span>
      </div>
      ${invoice.cgstPaise && invoice.cgstPaise > 0 ? `
        <div class="totals-row">
          <span>CGST (${(invoice.gstPercentage || 18) / 2}%)</span>
          <span>${formatPricePaise(invoice.cgstPaise)}</span>
        </div>
        <div class="totals-row">
          <span>SGST (${(invoice.gstPercentage || 18) / 2}%)</span>
          <span>${formatPricePaise(invoice.sgstPaise || 0)}</span>
        </div>
      ` : ""}
      ${invoice.igstPaise && invoice.igstPaise > 0 ? `
        <div class="totals-row">
          <span>IGST (${invoice.gstPercentage || 18}%)</span>
          <span>${formatPricePaise(invoice.igstPaise)}</span>
        </div>
      ` : ""}
      <div class="totals-row total">
        <span>Total Amount</span>
        <span>${formatPricePaise(invoice.totalAmountPaise)}</span>
      </div>
    </div>

    <div class="gst-info">
      <p><strong>Amount in Words:</strong> ${numberToWords(invoice.totalAmountPaise / 100)} Rupees Only</p>
      ${invoice.notes ? `<p style="margin-top: 8px;"><strong>Notes:</strong> ${invoice.notes}</p>` : ""}
    </div>

    <div class="footer">
      <p>This is a computer-generated invoice and does not require a signature.</p>
      <p style="margin-top: 8px;">For any queries, please contact support@neuratalk.in</p>
    </div>
  </div>
</body>
</html>
    `;

    return html;
  } catch (err) {
    logger.error("Invoice", "Failed to generate invoice HTML", err as Error);
    return null;
  }
}

/**
 * Convert number to words for invoice
 */
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

  if (num === 0) return 'Zero';

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return '';
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    }
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '');
  };

  const convertToIndianSystem = (n: number): string => {
    if (n === 0) return '';
    
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    
    let result = '';
    if (crore > 0) result += convertLessThanThousand(crore) + ' Crore ';
    if (lakh > 0) result += convertLessThanThousand(lakh) + ' Lakh ';
    if (thousand > 0) result += convertLessThanThousand(thousand) + ' Thousand ';
    if (n > 0) result += convertLessThanThousand(n);
    
    return result.trim();
  };

  const dollars = Math.floor(num);
  const cents = Math.round((num - dollars) * 100);

  let result = convertToIndianSystem(dollars);
  if (cents > 0) {
    result += ' and ' + convertLessThanThousand(cents) + ' Cents';
  }

  return result;
}
