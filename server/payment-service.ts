import crypto from "crypto";
import Razorpay from "razorpay";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  billingPlans,
  paymentGateways,
  paymentTransactions,
  platformSettings,
  subscriptions,
  type BillingPlan,
  type PaymentGateway,
  type PaymentTransaction,
  PAYMENT_STATUS,
} from "@shared/schema";
import { logger } from "./observability";
import { summarizeBillingPlan } from "./billing-plan-utils";
import { BillingEngine } from "./billing-engine";
import { createSubscriptionInvoice, markInvoicePaid } from "./invoice-service";

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

async function getRazorpayClient(config: ResolvedGatewayConfig): Promise<Razorpay | null> {
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

  const creditAmountPaise = Math.max(0, metadata.walletCreditPaise ?? transaction.amount);
  const updatedAccount = await BillingEngine.adjustOrganizationBalance({
    organizationId: transaction.organizationId,
    amountPaise: creditAmountPaise,
    type: "wallet_credit",
    actorUserId: transaction.userId,
    description: metadata.label || "Wallet top-up",
  });

  await db.update(paymentTransactions)
    .set({
      metadata: mergeTransactionMetadata(transaction.metadata, {
        provisionedAt: new Date().toISOString(),
      }),
    })
    .where(eq(paymentTransactions.id, transaction.id));

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
  if (transaction.status === PAYMENT_STATUS.COMPLETED) {
    const existingProvision = await provisionCompletedTransaction(transaction);
    return existingProvision;
  }

  const [updatedTransaction] = await db.update(paymentTransactions)
    .set({
      status: PAYMENT_STATUS.COMPLETED,
      gatewayPaymentId: paymentId,
      gatewaySignature: signature || transaction.gatewaySignature,
      completedAt: new Date(),
      metadata: mergeTransactionMetadata(transaction.metadata, { paymentId }),
    })
    .where(eq(paymentTransactions.id, transaction.id))
    .returning();

  return provisionCompletedTransaction(updatedTransaction ?? transaction);
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
    throw new Error("TRANSACTION_NOT_FOUND");
  }

  const sameOrganization = Boolean(
    transaction.organizationId
    && input.actor.organizationId
    && transaction.organizationId === input.actor.organizationId,
  );
  const sameUser = transaction.userId === input.actor.id;
  if (!sameOrganization && !sameUser) {
    throw new Error("UNAUTHORIZED_TRANSACTION");
  }

  if (!transaction.gatewayOrderId) {
    throw new Error("ORDER_ID_MISSING");
  }

  if (!verifySignature(transaction.gatewayOrderId, input.paymentId, input.signature, config.keySecret)) {
    await db.update(paymentTransactions)
      .set({
        status: PAYMENT_STATUS.FAILED,
        failureReason: "Invalid payment signature",
      })
      .where(eq(paymentTransactions.id, transaction.id));
    throw new Error("INVALID_SIGNATURE");
  }

  const provision = await finalizeTransactionSuccess(transaction, input.paymentId, input.signature);
  return {
    success: true,
    transactionId: transaction.id,
    provision,
  };
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
  const config = await resolveGatewayConfig();

  if (config.webhookSecret) {
    if (!rawBody || !signature) {
      throw new Error("WEBHOOK_SIGNATURE_REQUIRED");
    }
    const expected = crypto
      .createHmac("sha256", config.webhookSecret)
      .update(rawBody)
      .digest("hex");
    if (!safeCompare(expected, signature)) {
      throw new Error("INVALID_WEBHOOK_SIGNATURE");
    }
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

      await db.update(paymentTransactions)
        .set({
          status: PAYMENT_STATUS.FAILED,
          failureReason,
        })
        .where(eq(paymentTransactions.gatewayOrderId, orderId));
      return;
    }
    case "refund.processed": {
      const paymentId = event?.payload?.refund?.entity?.payment_id;
      if (!paymentId) {
        return;
      }

      await db.update(paymentTransactions)
        .set({
          status: PAYMENT_STATUS.REFUNDED,
        })
        .where(eq(paymentTransactions.gatewayPaymentId, paymentId));
      return;
    }
    default:
      return;
  }
}
