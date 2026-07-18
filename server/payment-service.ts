import crypto from "crypto";
import Razorpay from "razorpay";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  billingPlans,
  paymentGateways,
  paymentTransactions,
  paymentRefunds,
  platformSettings,
  subscriptions,
  type BillingPlan,
  type PaymentGateway,
  type PaymentTransaction,
  type PaymentRefund,
  PAYMENT_STATUS,
  PAYMENT_REFUND_STATUS,
  USER_ROLES,
} from "@shared/schema";
import { logger } from "./observability";
import { logAuditEvent } from "./audit-logging";
import { recordPaymentCounter } from "./payment-metrics";
import { runWithTrace } from "./request-context";
import { summarizeBillingPlan } from "./billing-plan-utils";
import { BillingEngine } from "./billing-engine";
import { createSubscriptionInvoice, markInvoicePaid } from "./invoice-service";
import { withRedisLock, isRedisDegraded } from "./redis";

const PAYMENT_TOPUP_CATALOG_KEY = "billing_wallet_topup_catalog";

const walletTopupPackageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  amountPaise: z.number().int().positive(),
  bonusPaise: z.number().int().nonnegative().default(0),
  currency: z.string().default("INR"),
  enabled: z.boolean().default(true),
});

type WalletTopupPackage = z.infer<typeof walletTopupPackageSchema>;

type PaymentTransactionMetadata = {
  kind?: "subscription" | "wallet_topup";
  billingScope?: "user" | "organization";
  planId?: number;
  packageId?: string;
  label?: string;
  subtotalPaise?: number;
  taxPaise?: number;
  totalPaise?: number;
  walletCreditPaise?: number;
  bonusPaise?: number;
  provisionedAt?: string;
  subscriptionId?: number;
  invoiceId?: number;
  paymentId?: string;
};

export interface PaymentActor {
  id: number;
  organizationId?: number | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  username?: string | null;
}

export interface GatewayStatus {
  configured: boolean;
  enabled: boolean;
  gateway: "razorpay" | null;
  mode: "disabled" | "test" | "live";
  keyId: string | null;
  webhookConfigured: boolean;
}

export interface PaymentOrderRequest {
  actor: PaymentActor;
  planId?: number;
  packageId?: string;
}

export interface PaymentVerificationRequest {
  actor: PaymentActor;
  transactionId?: number;
  orderId?: string;
  paymentId: string;
  signature: string;
}

export interface PaymentProvisionResult {
  kind: "subscription" | "wallet_topup";
  subscriptionId?: number;
  invoiceId?: number;
  organizationId?: number | null;
  walletBalancePaise?: number;
  message: string;
}

export interface RefundRequest {
  actor: PaymentActor;
  transactionId: number;
  /** Omit for a full refund of whatever remains unrefunded on the transaction. */
  amountPaise?: number;
  reason?: string;
  /** Client- or caller-supplied idempotency key. A retried request with the
   *  same key returns the original outcome instead of creating a second refund. */
  idempotencyKey?: string;
}

export interface RefundResult {
  success: true;
  refundId: number;
  gatewayRefundId: string | null;
  status: string;
  amountPaise: number;
  isFullRefund: boolean;
  transactionStatus: string;
  replayed?: boolean;
}

interface ResolvedGatewayConfig {
  gatewayRow: PaymentGateway | null;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  isTestMode: boolean;
}

interface ResolvedPurchase {
  kind: "subscription" | "wallet_topup";
  organizationId: number | null;
  amountPaise: number;
  currency: string;
  label: string;
  metadata: PaymentTransactionMetadata;
}

let razorpayInstance: Razorpay | null = null;
let razorpayCacheKey = "";

function parseTransactionMetadata(value: unknown): PaymentTransactionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as PaymentTransactionMetadata;
}

function mergeTransactionMetadata(
  current: unknown,
  patch: Partial<PaymentTransactionMetadata>,
): PaymentTransactionMetadata {
  return {
    ...parseTransactionMetadata(current),
    ...patch,
  };
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return safeCompare(expected, signature);
}

async function resolveGatewayConfig(): Promise<ResolvedGatewayConfig> {
  const [gatewayRow] = await db.select()
    .from(paymentGateways)
    .where(eq(paymentGateways.name, "razorpay"))
    .limit(1);

  const keyIdEnvVar = gatewayRow?.keyIdEnvVar || "RAZORPAY_KEY_ID";
  const keySecretEnvVar = gatewayRow?.keySecretEnvVar || "RAZORPAY_KEY_SECRET";

  const keyId = process.env[keyIdEnvVar] || process.env.RAZORPAY_KEY_ID || null;
  const keySecret = process.env[keySecretEnvVar] || process.env.RAZORPAY_KEY_SECRET || null;
  const webhookSecret = gatewayRow?.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET || null;
  const isTestMode = gatewayRow?.isTestMode ?? !(keyId?.startsWith("rzp_live"));

  return {
    gatewayRow: gatewayRow ?? null,
    keyId,
    keySecret,
    webhookSecret,
    isTestMode,
  };
}

/**
 * Test-only injection hook. The `razorpay` package is a plain CJS class
 * with no dependency-injection seam of its own, and mocking a `new X()`
 * call from a third-party npm package via vi.mock() proved unreliable in
 * this project's Vitest setup (module-graph externalization inconsistently
 * bypassed the mock depending on call path) — this explicit override is a
 * standard, reliable alternative. Never set outside tests.
 */
let testRazorpayClientOverride: Razorpay | null | undefined;
export function __setTestRazorpayClient(client: Razorpay | null | undefined): void {
  testRazorpayClientOverride = client;
}

async function getRazorpayClient(config: ResolvedGatewayConfig): Promise<Razorpay | null> {
  if (testRazorpayClientOverride !== undefined) {
    return testRazorpayClientOverride;
  }

  if (!config.keyId || !config.keySecret) {
    return null;
  }

  const cacheKey = `${config.keyId}:${config.keySecret}`;
  if (!razorpayInstance || razorpayCacheKey !== cacheKey) {
    razorpayInstance = new Razorpay({
      key_id: config.keyId,
      key_secret: config.keySecret,
    });
    razorpayCacheKey = cacheKey;
  }

  return razorpayInstance;
}

/** Returns true for errors worth retrying (network failures, 5xx) — not for
 *  definitive business-logic rejections (4xx) like "already refunded". */
function isRetryableGatewayError(error: unknown): boolean {
  const status = (error as { statusCode?: number; status?: number } | null)?.statusCode
    ?? (error as { statusCode?: number; status?: number } | null)?.status;
  if (status == null) return true; // no status = network/transport-level failure
  return status >= 500;
}

async function withGatewayRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseDelayMs = 200): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableGatewayError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function getWalletTopupCatalog(): Promise<WalletTopupPackage[]> {
  const [row] = await db.select()
    .from(platformSettings)
    .where(eq(platformSettings.key, PAYMENT_TOPUP_CATALOG_KEY))
    .limit(1);

  const result = z.array(walletTopupPackageSchema).catch([]).parse(row?.value ?? []);
  return result.filter((item) => item.enabled !== false);
}

async function getPlanById(planId: number): Promise<BillingPlan | null> {
  const [plan] = await db.select()
    .from(billingPlans)
    .where(and(eq(billingPlans.id, planId), eq(billingPlans.isEnabled, true)))
    .limit(1);

  return plan ?? null;
}

async function resolvePurchase(input: PaymentOrderRequest): Promise<ResolvedPurchase> {
  if (input.planId) {
    const plan = await getPlanById(input.planId);
    if (!plan) {
      throw new Error("PLAN_NOT_FOUND");
    }

    if (plan.planType === "b2b" && !input.actor.organizationId) {
      throw new Error("ORGANIZATION_REQUIRED");
    }

    const gstPercentage = plan.gstPercentage ?? 0;
    const taxPaise = Math.round((plan.priceInPaise * gstPercentage) / 100);
    const amountPaise = plan.priceInPaise + taxPaise;
    const scope = plan.planType === "b2b" ? "organization" : "user";

    return {
      kind: "subscription",
      organizationId: scope === "organization" ? input.actor.organizationId ?? null : null,
      amountPaise,
      currency: plan.currency || "INR",
      label: plan.name,
      metadata: {
        kind: "subscription",
        billingScope: scope,
        planId: plan.id,
        label: plan.name,
        subtotalPaise: plan.priceInPaise,
        taxPaise,
        totalPaise: amountPaise,
      },
    };
  }

  if (input.packageId) {
    const packages = await getWalletTopupCatalog();
    const topupPackage = packages.find((item) => item.id === input.packageId);

    if (!topupPackage) {
      throw new Error("PACKAGE_NOT_FOUND");
    }

    if (!input.actor.organizationId) {
      throw new Error("ORGANIZATION_REQUIRED");
    }

    const walletCreditPaise = topupPackage.amountPaise + topupPackage.bonusPaise;

    return {
      kind: "wallet_topup",
      organizationId: input.actor.organizationId,
      amountPaise: topupPackage.amountPaise,
      currency: topupPackage.currency || "INR",
      label: topupPackage.label,
      metadata: {
        kind: "wallet_topup",
        billingScope: "organization",
        packageId: topupPackage.id,
        label: topupPackage.label,
        totalPaise: topupPackage.amountPaise,
        bonusPaise: topupPackage.bonusPaise,
        walletCreditPaise,
      },
    };
  }

  throw new Error("PAYMENT_TARGET_REQUIRED");
}

async function getViewerActiveSubscription(actor: PaymentActor) {
  const clauses = actor.organizationId
    ? and(eq(subscriptions.organizationId, actor.organizationId), eq(subscriptions.status, "active"))
    : and(eq(subscriptions.userId, actor.id), eq(subscriptions.status, "active"));

  const [subscription] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .leftJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(clauses)
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return subscription ?? null;
}

async function provisionSubscriptionTransaction(
  transaction: PaymentTransaction,
  metadata: PaymentTransactionMetadata,
): Promise<PaymentProvisionResult> {
  const planId = metadata.planId;
  if (!planId) {
    throw new Error("PLAN_ID_MISSING");
  }

  const plan = await getPlanById(planId);
  if (!plan) {
    throw new Error("PLAN_NOT_FOUND");
  }

  const scope = metadata.billingScope === "organization" ? "organization" : "user";
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + Math.max(1, plan.durationDays || 30));

  await db.update(subscriptions)
    .set({
      status: "cancelled",
      endDate: now,
      updatedAt: now,
    })
    .where(
      scope === "organization"
        ? and(eq(subscriptions.organizationId, transaction.organizationId ?? -1), eq(subscriptions.status, "active"))
        : and(eq(subscriptions.userId, transaction.userId ?? -1), eq(subscriptions.status, "active")),
    );

  const [subscription] = await db.insert(subscriptions).values({
    userId: scope === "user" ? transaction.userId : null,
    organizationId: scope === "organization" ? transaction.organizationId : null,
    planId: plan.id,
    status: "active",
    billingModel: plan.billingModel || "prepaid",
    startDate: now,
    endDate,
    minutesRemaining: plan.includedMinutes || 0,
    currentUsage: 0,
    autoRenew: false,
    lastPaymentId: transaction.id,
    nextBillingDate: endDate,
  }).returning();

  if (transaction.organizationId) {
    await BillingEngine.assignPlanToOrganization({
      organizationId: transaction.organizationId,
      assignedPlanId: plan.id,
      billingType: (plan.billingModel || "prepaid") as "prepaid" | "postpaid" | "hybrid",
    }).catch((error) => {
      logger.error("PaymentService", "Failed to assign plan to billing account", error as Error);
    });
  }

  let invoiceId: number | undefined;
  const invoiceResult = await createSubscriptionInvoice(subscription.id);
  if (invoiceResult.success && invoiceResult.invoice) {
    invoiceId = invoiceResult.invoice.id;
    await markInvoicePaid(invoiceResult.invoice.id, transaction.id).catch((error) => {
      logger.error("PaymentService", "Failed to mark subscription invoice paid", error as Error);
    });
  }

  await db.update(paymentTransactions)
    .set({
      metadata: mergeTransactionMetadata(transaction.metadata, {
        provisionedAt: new Date().toISOString(),
        subscriptionId: subscription.id,
        invoiceId,
      }),
    })
    .where(eq(paymentTransactions.id, transaction.id));

  return {
    kind: "subscription",
    subscriptionId: subscription.id,
    invoiceId,
    organizationId: transaction.organizationId,
    message: `${plan.name} plan activated successfully`,
  };
}

async function provisionWalletTopupTransaction(
  transaction: PaymentTransaction,
  metadata: PaymentTransactionMetadata,
): Promise<PaymentProvisionResult> {
  if (!transaction.organizationId || !transaction.userId) {
    throw new Error("ORGANIZATION_REQUIRED");
  }

  // Atomically claim the provision slot before touching any money.
  // If another process already set provisionedAt, this update matches 0 rows
  // and we return early — preventing double-credit.
  const provisionedAt = new Date().toISOString();
  const [claimed] = await db.update(paymentTransactions)
    .set({
      metadata: mergeTransactionMetadata(transaction.metadata, { provisionedAt }),
    })
    .where(
      and(
        eq(paymentTransactions.id, transaction.id),
        sql`(metadata->>'provisionedAt') IS NULL`,
      ),
    )
    .returning();

  if (!claimed) {
    // Another process already claimed the provision slot — idempotent return
    logger.warn("PaymentService", "Wallet top-up already claimed by another process", {
      transactionId: transaction.id,
    });
    return {
      kind: "wallet_topup",
      organizationId: transaction.organizationId,
      message: "Wallet top-up already finalized",
    };
  }

  const creditAmountPaise = Math.max(0, metadata.walletCreditPaise ?? transaction.amount);
  const updatedAccount = await BillingEngine.adjustOrganizationBalance({
    organizationId: transaction.organizationId,
    amountPaise: creditAmountPaise,
    type: "wallet_credit",
    actorUserId: transaction.userId,
    description: metadata.label || "Wallet top-up",
  });

  return {
    kind: "wallet_topup",
    organizationId: transaction.organizationId,
    walletBalancePaise: updatedAccount.walletBalancePaise,
    message: "Wallet topped up successfully",
  };
}

async function provisionCompletedTransaction(transaction: PaymentTransaction): Promise<PaymentProvisionResult> {
  const metadata = parseTransactionMetadata(transaction.metadata);

  if (metadata.provisionedAt) {
    return {
      kind: metadata.kind === "wallet_topup" ? "wallet_topup" : "subscription",
      subscriptionId: metadata.subscriptionId,
      invoiceId: metadata.invoiceId,
      organizationId: transaction.organizationId,
      message: metadata.kind === "wallet_topup"
        ? "Wallet top-up already finalized"
        : "Subscription already finalized",
    };
  }

  if (metadata.kind === "wallet_topup") {
    return provisionWalletTopupTransaction(transaction, metadata);
  }

  return provisionSubscriptionTransaction(transaction, metadata);
}

async function finalizeTransactionSuccess(
  transaction: PaymentTransaction,
  paymentId: string,
  signature?: string | null,
): Promise<PaymentProvisionResult> {
  const lockKey = `payment-provision:${transaction.id}`;

  if (isRedisDegraded()) {
    logger.warn("PaymentService", "Redis degraded — provision lock may not be cross-process", {
      transactionId: transaction.id,
      lockKey,
    });
  }

  return withRedisLock(lockKey, async () => {
    // Re-fetch inside the lock to get the latest persisted state
    const [fresh] = await db.select().from(paymentTransactions)
      .where(eq(paymentTransactions.id, transaction.id))
      .limit(1);

    const current = fresh ?? transaction;

    if (current.status === PAYMENT_STATUS.COMPLETED) {
      const existingProvision = await provisionCompletedTransaction(current);
      return existingProvision;
    }

    const [updatedTransaction] = await db.update(paymentTransactions)
      .set({
        status: PAYMENT_STATUS.COMPLETED,
        gatewayPaymentId: paymentId,
        gatewaySignature: signature || current.gatewaySignature,
        completedAt: new Date(),
        metadata: mergeTransactionMetadata(current.metadata, { paymentId }),
      })
      .where(eq(paymentTransactions.id, current.id))
      .returning();

    const result = await provisionCompletedTransaction(updatedTransaction ?? current);
    recordPaymentCounter("payments_succeeded");

    await logAuditEvent({
      action: result.kind === "wallet_topup" ? "billing_recharge" : "billing_subscription_purchase",
      userId: current.userId ?? undefined,
      organizationId: current.organizationId ?? undefined,
      details: {
        kind: result.kind,
        amountPaise: current.amount,
        gatewayPaymentId: paymentId,
        transactionId: String(current.id),
        source: "razorpay_webhook",
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write payment audit log", err instanceof Error ? err : new Error(String(err))));

    // Send in-app + push notification for successful payment
    if (current.userId) {
      import("./notification-routes").then(({ createNotification }) => {
        const amountInr = ((current.amount ?? 0) / 100).toFixed(2);
        const isWallet = result.kind === "wallet_topup";
        void createNotification({
          userId: current.userId!,
          type: "payment_success",
          title: isWallet ? "Wallet Recharged ✅" : "Subscription Activated ✅",
          body: isWallet
            ? `₹${amountInr} added to your wallet.`
            : `Your plan has been activated. Payment of ₹${amountInr} received.`,
          data: { transactionId: String(current.id), amountPaise: String(current.amount ?? 0) },
        });
      }).catch(() => {});
    }

    return result;
  }, { ttlMs: 60_000, retries: 3, retryDelayMs: 200 });
}

export async function getGatewayStatus(): Promise<GatewayStatus> {
  const config = await resolveGatewayConfig();
  const configured = Boolean(config.keyId && config.keySecret);

  return {
    configured,
    enabled: configured,
    gateway: configured ? "razorpay" : null,
    mode: configured ? (config.isTestMode ? "test" : "live") : "disabled",
    keyId: config.keyId,
    webhookConfigured: Boolean(config.webhookSecret),
  };
}

export async function listPaymentPlans() {
  const plans = await db.select()
    .from(billingPlans)
    .where(eq(billingPlans.isEnabled, true))
    .orderBy(billingPlans.displayOrder, billingPlans.priceInPaise);

  return plans.map((plan) => ({
    ...plan,
    ...summarizeBillingPlan(plan),
  }));
}

export async function listWalletTopups() {
  const packages = await getWalletTopupCatalog();
  return packages.map((item) => ({
    ...item,
    walletCreditPaise: item.amountPaise + item.bonusPaise,
  }));
}

export async function getPaymentMethods() {
  const status = await getGatewayStatus();
  const topups = await listWalletTopups();

  return {
    gateways: status.configured
      ? [
          {
            id: "razorpay",
            name: "Razorpay",
            mode: status.mode,
            supports: ["subscription", "wallet_topup"],
          },
        ]
      : [],
    walletTopupsAvailable: topups.length,
  };
}

export async function createCheckoutOrder(input: PaymentOrderRequest) {
  try {
    const config = await resolveGatewayConfig();
    const razorpay = await getRazorpayClient(config);
    if (!razorpay || !config.keyId) {
      throw new Error("PAYMENT_GATEWAY_NOT_CONFIGURED");
    }

    const purchase = await resolvePurchase(input);
    const receipt = `pay_${input.actor.id}_${Date.now()}`;

    const [transaction] = await db.insert(paymentTransactions).values({
      userId: input.actor.id,
      organizationId: purchase.organizationId,
      gatewayId: config.gatewayRow?.id ?? null,
      amount: purchase.amountPaise,
      currency: purchase.currency,
      status: PAYMENT_STATUS.PENDING,
      metadata: purchase.metadata,
    }).returning();

    const order = await razorpay.orders.create({
      amount: purchase.amountPaise,
      currency: purchase.currency,
      receipt,
      notes: {
        transactionId: String(transaction.id),
        kind: purchase.kind,
        label: purchase.label,
        organizationId: purchase.organizationId ? String(purchase.organizationId) : "",
        actorId: String(input.actor.id),
      },
    });

    await db.update(paymentTransactions)
      .set({
        gatewayOrderId: order.id,
        metadata: mergeTransactionMetadata(transaction.metadata, {
          totalPaise: purchase.amountPaise,
        }),
      })
      .where(eq(paymentTransactions.id, transaction.id));

    recordPaymentCounter("orders_created");
    await logAuditEvent({
      action: "payment_order_created",
      userId: input.actor.id,
      organizationId: purchase.organizationId ?? undefined,
      details: {
        transactionId: String(transaction.id),
        gatewayOrderId: order.id,
        amountPaise: purchase.amountPaise,
        kind: purchase.kind,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write order-created audit log", err instanceof Error ? err : new Error(String(err))));

    return {
      success: true,
      transactionId: transaction.id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: config.keyId,
      mode: config.isTestMode ? "test" : "live",
      kind: purchase.kind,
      label: purchase.label,
      planId: purchase.metadata.planId,
      packageId: purchase.metadata.packageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordPaymentCounter("orders_failed");
    await logAuditEvent({
      action: "payment_order_failed",
      userId: input.actor.id,
      organizationId: input.actor.organizationId ?? undefined,
      details: {
        reason: message,
        planId: input.planId,
        packageId: input.packageId,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write order-failed audit log", err instanceof Error ? err : new Error(String(err))));
    throw error;
  }
}

export async function confirmCheckoutPayment(input: PaymentVerificationRequest) {
  const config = await resolveGatewayConfig();
  if (!config.keySecret) {
    throw new Error("PAYMENT_GATEWAY_NOT_CONFIGURED");
  }

  let transaction: PaymentTransaction | undefined;
  if (input.transactionId) {
    [transaction] = await db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, input.transactionId))
      .limit(1);
  } else if (input.orderId) {
    [transaction] = await db.select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.gatewayOrderId, input.orderId))
      .limit(1);
  }

  if (!transaction) {
    recordPaymentCounter("verifications_failed");
    await logAuditEvent({
      action: "payment_verification_failed",
      userId: input.actor.id,
      organizationId: input.actor.organizationId ?? undefined,
      details: { reason: "TRANSACTION_NOT_FOUND", transactionId: input.transactionId, orderId: input.orderId, timestamp: new Date().toISOString() },
    }).catch(() => {});
    throw new Error("TRANSACTION_NOT_FOUND");
  }

  const sameOrganization = Boolean(
    transaction.organizationId
    && input.actor.organizationId
    && transaction.organizationId === input.actor.organizationId,
  );
  const sameUser = transaction.userId === input.actor.id;
  if (!sameOrganization && !sameUser) {
    recordPaymentCounter("verifications_failed");
    await logAuditEvent({
      action: "payment_verification_failed",
      userId: input.actor.id,
      organizationId: input.actor.organizationId ?? undefined,
      details: { reason: "UNAUTHORIZED_TRANSACTION", transactionId: String(transaction.id), timestamp: new Date().toISOString() },
    }).catch(() => {});
    throw new Error("UNAUTHORIZED_TRANSACTION");
  }

  if (!transaction.gatewayOrderId) {
    throw new Error("ORDER_ID_MISSING");
  }

  // Idempotent replay: a duplicate client-side submission (double-click,
  // network retry after the success response was lost) shouldn't be treated
  // as an error or re-verified — just hand back the already-provisioned result.
  if (transaction.status === PAYMENT_STATUS.COMPLETED) {
    recordPaymentCounter("duplicate_attempts");
    await logAuditEvent({
      action: "payment_duplicate_attempt",
      userId: input.actor.id,
      organizationId: transaction.organizationId ?? undefined,
      details: { transactionId: String(transaction.id), gatewayPaymentId: input.paymentId, timestamp: new Date().toISOString() },
    }).catch(() => {});
    const provision = await provisionCompletedTransaction(transaction);
    return { success: true, transactionId: transaction.id, provision, duplicate: true };
  }

  if (!verifySignature(transaction.gatewayOrderId, input.paymentId, input.signature, config.keySecret)) {
    await db.update(paymentTransactions)
      .set({
        status: PAYMENT_STATUS.FAILED,
        failureReason: "Invalid payment signature",
      })
      .where(eq(paymentTransactions.id, transaction.id));
    recordPaymentCounter("signature_failures");
    await logAuditEvent({
      action: "payment_signature_verification_failed",
      userId: input.actor.id,
      organizationId: transaction.organizationId ?? undefined,
      details: {
        transactionId: String(transaction.id),
        gatewayOrderId: transaction.gatewayOrderId,
        gatewayPaymentId: input.paymentId,
        source: "checkout_verify",
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write signature-failure audit log", err instanceof Error ? err : new Error(String(err))));
    throw new Error("INVALID_SIGNATURE");
  }

  const provision = await finalizeTransactionSuccess(transaction, input.paymentId, input.signature);
  return {
    success: true,
    transactionId: transaction.id,
    provision,
  };
}

/** True if `actor` may refund `transaction` — owner, same-org member, or admin override. */
export function canRefundTransaction(actor: PaymentActor, transaction: Pick<PaymentTransaction, "userId" | "organizationId">): boolean {
  if (actor.role === USER_ROLES.SUPER_ADMIN) return true; // platform-wide override
  if (
    actor.role === USER_ROLES.COMPANY_ADMIN
    && actor.organizationId != null
    && transaction.organizationId === actor.organizationId
  ) return true; // org-scoped admin override
  if (transaction.userId === actor.id) return true; // ownership
  if (
    transaction.organizationId != null
    && actor.organizationId != null
    && transaction.organizationId === actor.organizationId
  ) return true; // same-org member
  return false;
}

/**
 * Initiates a refund for a completed (or already partially-refunded)
 * transaction. Exercises the complete production flow — RBAC, ownership,
 * idempotency, duplicate-refund protection, amount validation, refund-ledger
 * persistence, and audit logging — up to the point of the actual Razorpay
 * API call. That call itself cannot be demonstrated end-to-end without a
 * live Razorpay account (none is configured in this environment); on
 * PAYMENT_GATEWAY_NOT_CONFIGURED the refund is recorded as FAILED and the
 * error is surfaced honestly rather than reporting a fabricated success.
 */
export async function initiateRefund(input: RefundRequest): Promise<RefundResult> {
  return runWithTrace("payments", `refund:${input.transactionId}`, () => initiateRefundTraced(input));
}

async function initiateRefundTraced(input: RefundRequest): Promise<RefundResult> {
  const [transaction] = await db.select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, input.transactionId))
    .limit(1);

  if (!transaction) {
    throw new Error("TRANSACTION_NOT_FOUND");
  }

  if (!canRefundTransaction(input.actor, transaction)) {
    await logAuditEvent({
      action: "payment_verification_failed",
      userId: input.actor.id,
      organizationId: input.actor.organizationId ?? undefined,
      details: { reason: "UNAUTHORIZED_REFUND_ATTEMPT", transactionId: String(transaction.id), timestamp: new Date().toISOString() },
      severity: "warning",
    }).catch(() => {});
    throw new Error("UNAUTHORIZED_TRANSACTION");
  }

  if (transaction.status !== PAYMENT_STATUS.COMPLETED && transaction.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
    throw new Error("TRANSACTION_NOT_REFUNDABLE");
  }

  if (!transaction.gatewayPaymentId) {
    throw new Error("PAYMENT_ID_MISSING");
  }

  // Idempotent replay: the same idempotency key always returns the original
  // outcome (including a prior failure) rather than re-attempting the gateway
  // call — this is what lets a client safely retry a network timeout without
  // risking a second real-world refund.
  if (input.idempotencyKey) {
    const [existing] = await db.select().from(paymentRefunds)
      .where(eq(paymentRefunds.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.transactionId !== transaction.id) {
        throw new Error("IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_TRANSACTION");
      }
      if (existing.status === PAYMENT_REFUND_STATUS.FAILED) {
        throw new Error("REFUND_GATEWAY_ERROR");
      }
      return {
        success: true,
        refundId: existing.id,
        gatewayRefundId: existing.gatewayRefundId,
        status: existing.status ?? PAYMENT_REFUND_STATUS.PROCESSING,
        amountPaise: existing.amountPaise,
        isFullRefund: existing.isFullRefund ?? false,
        transactionStatus: transaction.status,
        replayed: true,
      };
    }
  }

  // Duplicate-in-progress protection for concurrent requests that didn't
  // supply an idempotency key (e.g. a double-click on the refund button).
  const [inProgress] = await db.select().from(paymentRefunds)
    .where(and(eq(paymentRefunds.transactionId, transaction.id), eq(paymentRefunds.status, PAYMENT_REFUND_STATUS.PROCESSING)))
    .limit(1);
  if (inProgress) {
    throw new Error("REFUND_ALREADY_IN_PROGRESS");
  }

  const [{ alreadyRefunded }] = await db.select({
    alreadyRefunded: sql<number>`coalesce(sum(${paymentRefunds.amountPaise}), 0)`,
  }).from(paymentRefunds)
    .where(and(eq(paymentRefunds.transactionId, transaction.id), eq(paymentRefunds.status, PAYMENT_REFUND_STATUS.COMPLETED)));

  const remainingRefundable = transaction.amount - Number(alreadyRefunded);
  if (remainingRefundable <= 0) {
    throw new Error("ALREADY_FULLY_REFUNDED");
  }

  const requestedAmount = input.amountPaise ?? remainingRefundable;
  if (requestedAmount <= 0) {
    throw new Error("INVALID_REFUND_AMOUNT");
  }
  if (requestedAmount > remainingRefundable) {
    throw new Error("REFUND_AMOUNT_EXCEEDS_REMAINING");
  }
  const isFullRefund = requestedAmount === remainingRefundable && Number(alreadyRefunded) === 0;

  recordPaymentCounter("refunds_requested");
  await logAuditEvent({
    action: "billing_refund_requested",
    userId: input.actor.id,
    organizationId: transaction.organizationId ?? undefined,
    details: {
      transactionId: String(transaction.id),
      requestedAmountPaise: requestedAmount,
      isFullRefund,
      reason: input.reason ?? null,
      initiatedBy: input.actor.id,
      timestamp: new Date().toISOString(),
    },
  }).catch((err) => logger.error("PaymentService", "Failed to write refund-requested audit log", err instanceof Error ? err : new Error(String(err))));

  const [refundRow] = await db.insert(paymentRefunds).values({
    transactionId: transaction.id,
    amountPaise: requestedAmount,
    currency: transaction.currency ?? "INR",
    isFullRefund,
    status: PAYMENT_REFUND_STATUS.PROCESSING,
    reason: input.reason ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    initiatedBy: input.actor.id,
  }).returning();

  const config = await resolveGatewayConfig();
  const razorpay = await getRazorpayClient(config);
  if (!razorpay) {
    await db.update(paymentRefunds)
      .set({ status: PAYMENT_REFUND_STATUS.FAILED, failureReason: "Payment gateway not configured" })
      .where(eq(paymentRefunds.id, refundRow.id));
    recordPaymentCounter("refunds_failed");
    await logAuditEvent({
      action: "billing_refund_failed",
      userId: input.actor.id,
      organizationId: transaction.organizationId ?? undefined,
      details: {
        transactionId: String(transaction.id),
        refundId: String(refundRow.id),
        reason: "PAYMENT_GATEWAY_NOT_CONFIGURED",
        timestamp: new Date().toISOString(),
      },
    }).catch(() => {});
    throw new Error("PAYMENT_GATEWAY_NOT_CONFIGURED");
  }

  try {
    // External Dependency — Cannot Be Completed by Engineering Alone: this
    // call cannot be exercised end-to-end without a live Razorpay account.
    // Everything above (RBAC, idempotency, amount validation, ledger write,
    // audit trail) is real and already executed by this point.
    const gatewayRefund = await withGatewayRetry(() => razorpay.payments.refund(transaction.gatewayPaymentId!, {
      amount: requestedAmount,
      speed: "normal",
      notes: {
        transactionId: String(transaction.id),
        reason: input.reason ?? "",
        initiatedBy: String(input.actor.id),
      },
    }));

    const [updatedRefund] = await db.update(paymentRefunds)
      .set({ status: PAYMENT_REFUND_STATUS.COMPLETED, gatewayRefundId: gatewayRefund.id, completedAt: new Date() })
      .where(eq(paymentRefunds.id, refundRow.id))
      .returning();

    const newTotalRefunded = Number(alreadyRefunded) + requestedAmount;
    const [updatedTx] = await db.update(paymentTransactions)
      .set({ status: newTotalRefunded >= transaction.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED })
      .where(eq(paymentTransactions.id, transaction.id))
      .returning();

    recordPaymentCounter("refunds_completed");
    await logAuditEvent({
      action: "billing_refund",
      userId: input.actor.id,
      organizationId: transaction.organizationId ?? undefined,
      details: {
        transactionId: String(transaction.id),
        refundId: String(refundRow.id),
        gatewayRefundId: gatewayRefund.id,
        amountPaise: requestedAmount,
        totalRefundedPaise: newTotalRefunded,
        source: "refund_api",
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write refund-completed audit log", err instanceof Error ? err : new Error(String(err))));

    return {
      success: true,
      refundId: updatedRefund.id,
      gatewayRefundId: updatedRefund.gatewayRefundId,
      status: updatedRefund.status ?? PAYMENT_REFUND_STATUS.COMPLETED,
      amountPaise: requestedAmount,
      isFullRefund,
      transactionStatus: updatedTx?.status ?? transaction.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(paymentRefunds)
      .set({ status: PAYMENT_REFUND_STATUS.FAILED, failureReason: message })
      .where(eq(paymentRefunds.id, refundRow.id));

    recordPaymentCounter("refunds_failed");
    await logAuditEvent({
      action: "billing_refund_failed",
      userId: input.actor.id,
      organizationId: transaction.organizationId ?? undefined,
      details: {
        transactionId: String(transaction.id),
        refundId: String(refundRow.id),
        reason: message,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => logger.error("PaymentService", "Failed to write refund-failed audit log", err instanceof Error ? err : new Error(String(err))));

    throw new Error("REFUND_GATEWAY_ERROR");
  }
}

export async function getViewerPaymentHistory(actor: PaymentActor) {
  const whereClause = actor.organizationId
    ? or(eq(paymentTransactions.userId, actor.id), eq(paymentTransactions.organizationId, actor.organizationId))
    : eq(paymentTransactions.userId, actor.id);

  const transactions = await db.select()
    .from(paymentTransactions)
    .where(whereClause)
    .orderBy(desc(paymentTransactions.createdAt));

  return transactions;
}

export async function cancelViewerSubscription(actor: PaymentActor) {
  const activeSubscription = await getViewerActiveSubscription(actor);
  if (!activeSubscription?.subscription) {
    return { success: false, message: "No active subscription found" };
  }

  const [updated] = await db.update(subscriptions)
    .set({
      status: "cancelled",
      endDate: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, activeSubscription.subscription.id))
    .returning();

  return {
    success: true,
    subscription: updated,
  };
}

export async function getViewerSubscription(actor: PaymentActor) {
  const activeSubscription = await getViewerActiveSubscription(actor);
  if (!activeSubscription) {
    return null;
  }

  return {
    ...activeSubscription.subscription,
    planName: activeSubscription.plan?.name || null,
    planPrice: activeSubscription.plan?.priceInPaise || 0,
    currency: activeSubscription.plan?.currency || "INR",
  };
}

export async function handleRazorpayWebhook(rawBody: string, signature: string | undefined, event: any) {
  return runWithTrace("payments", `webhook:${event?.event ?? "unknown"}:${Date.now()}`, () => handleRazorpayWebhookTraced(rawBody, signature, event));
}

async function handleRazorpayWebhookTraced(rawBody: string, signature: string | undefined, event: any) {
  const config = await resolveGatewayConfig();

  if (!config.webhookSecret) {
    throw new Error("WEBHOOK_SECRET_NOT_CONFIGURED");
  }

  if (!rawBody || !signature) {
    throw new Error("WEBHOOK_SIGNATURE_REQUIRED");
  }

  const expected = crypto
    .createHmac("sha256", config.webhookSecret)
    .update(rawBody)
    .digest("hex");
  if (!safeCompare(expected, signature)) {
    recordPaymentCounter("webhook_signature_failures");
    await logAuditEvent({
      action: "payment_signature_verification_failed",
      details: {
        source: "razorpay_webhook",
        eventType: event?.event ?? "unknown",
        timestamp: new Date().toISOString(),
      },
      severity: "critical",
    }).catch((err) => logger.error("PaymentService", "Failed to write webhook signature-failure audit log", err instanceof Error ? err : new Error(String(err))));
    throw new Error("INVALID_WEBHOOK_SIGNATURE");
  }

  switch (event?.event) {
    case "payment.captured": {
      const orderId = event?.payload?.payment?.entity?.order_id;
      const paymentId = event?.payload?.payment?.entity?.id;
      if (!orderId || !paymentId) {
        return;
      }

      const [transaction] = await db.select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.gatewayOrderId, orderId))
        .limit(1);

      if (!transaction) {
        return;
      }

      await finalizeTransactionSuccess(transaction, paymentId, null);
      return;
    }
    case "payment.failed": {
      const orderId = event?.payload?.payment?.entity?.order_id;
      const failureReason = event?.payload?.payment?.entity?.error_description || "Payment failed";
      if (!orderId) {
        return;
      }

      const [failedTx] = await db.update(paymentTransactions)
        .set({
          status: PAYMENT_STATUS.FAILED,
          failureReason,
        })
        .where(eq(paymentTransactions.gatewayOrderId, orderId))
        .returning();

      recordPaymentCounter("payments_failed");
      await logAuditEvent({
        action: "payment_failed",
        userId: failedTx?.userId ?? undefined,
        organizationId: failedTx?.organizationId ?? undefined,
        details: {
          gatewayOrderId: orderId,
          transactionId: failedTx ? String(failedTx.id) : null,
          reason: failureReason,
          source: "razorpay_webhook",
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => logger.error("PaymentService", "Failed to write payment-failed audit log", err instanceof Error ? err : new Error(String(err))));
      return;
    }
    case "refund.processed": {
      const gatewayRefundId: string | undefined = event?.payload?.refund?.entity?.id;
      const paymentId = event?.payload?.refund?.entity?.payment_id;
      const refundAmount = event?.payload?.refund?.entity?.amount;
      if (!paymentId) {
        return;
      }

      const [transaction] = await db.select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.gatewayPaymentId, paymentId))
        .limit(1);
      if (!transaction) {
        return;
      }

      // Reconcile with a locally-initiated refund (via initiateRefund) if one
      // exists — this webhook can arrive either before or after that API
      // call's own synchronous Razorpay response, so both paths must be
      // idempotent against each other rather than assuming ordering.
      let localRefund: PaymentRefund | undefined;
      if (gatewayRefundId) {
        [localRefund] = await db.select().from(paymentRefunds)
          .where(eq(paymentRefunds.gatewayRefundId, gatewayRefundId))
          .limit(1);
      }
      if (!localRefund) {
        [localRefund] = await db.select().from(paymentRefunds)
          .where(and(eq(paymentRefunds.transactionId, transaction.id), eq(paymentRefunds.status, PAYMENT_REFUND_STATUS.PROCESSING)))
          .limit(1);
      }

      if (localRefund?.status === PAYMENT_REFUND_STATUS.COMPLETED) {
        return; // already reconciled by the synchronous API-call path — no-op
      }

      if (localRefund) {
        await db.update(paymentRefunds)
          .set({ status: PAYMENT_REFUND_STATUS.COMPLETED, gatewayRefundId: gatewayRefundId ?? localRefund.gatewayRefundId, completedAt: new Date() })
          .where(eq(paymentRefunds.id, localRefund.id));
      } else {
        // No local refund row — this refund was initiated outside this
        // codebase (e.g. directly from the Razorpay dashboard). Record it
        // anyway so the ledger stays authoritative.
        await db.insert(paymentRefunds).values({
          transactionId: transaction.id,
          gatewayRefundId: gatewayRefundId ?? null,
          amountPaise: refundAmount ?? transaction.amount,
          isFullRefund: (refundAmount ?? transaction.amount) >= transaction.amount,
          status: PAYMENT_REFUND_STATUS.COMPLETED,
          reason: "Initiated outside NeuraTalk (Razorpay dashboard or external process)",
          completedAt: new Date(),
        });
      }

      const [{ totalRefunded }] = await db.select({
        totalRefunded: sql<number>`coalesce(sum(${paymentRefunds.amountPaise}), 0)`,
      }).from(paymentRefunds)
        .where(and(eq(paymentRefunds.transactionId, transaction.id), eq(paymentRefunds.status, PAYMENT_REFUND_STATUS.COMPLETED)));

      const [refundedTx] = await db.update(paymentTransactions)
        .set({ status: Number(totalRefunded) >= transaction.amount ? PAYMENT_STATUS.REFUNDED : PAYMENT_STATUS.PARTIALLY_REFUNDED })
        .where(eq(paymentTransactions.id, transaction.id))
        .returning();

      recordPaymentCounter("refunds_completed");
      await logAuditEvent({
        action: "billing_refund",
        userId: refundedTx?.userId ?? undefined,
        organizationId: refundedTx?.organizationId ?? undefined,
        details: {
          gatewayPaymentId: paymentId,
          gatewayRefundId: gatewayRefundId ?? null,
          transactionId: refundedTx ? String(refundedTx.id) : null,
          amountPaise: refundAmount ?? null,
          totalRefundedPaise: Number(totalRefunded),
          source: "razorpay_webhook",
          timestamp: new Date().toISOString(),
        },
      }).catch((err) => logger.error("PaymentService", "Failed to write refund audit log", err instanceof Error ? err : new Error(String(err))));
      return;
    }
    default:
      return;
  }
}
