import type { Express, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "./role-middleware";
import {
  paymentCreateLimiter,
  paymentVerifyLimiter,
  paymentWebhookLimiter,
} from "./rate-limit";
import {
  cancelViewerSubscription,
  confirmCheckoutPayment,
  createCheckoutOrder,
  getGatewayStatus,
  getPaymentMethods,
  getViewerPaymentHistory,
  handleRazorpayWebhook,
  listPaymentPlans,
  listWalletTopups,
} from "./payment-service";
import { logger } from "./observability";

const createOrderSchema = z.object({
  planId: z.coerce.number().int().positive().optional(),
  packageId: z.string().min(1).optional(),
}).refine((value) => Boolean(value.planId || value.packageId), {
  message: "planId or packageId is required",
});

const verifyPaymentSchema = z.object({
  transactionId: z.coerce.number().int().positive().optional(),
  razorpay_order_id: z.string().min(1).optional(),
  razorpay_payment_id: z.string().min(1).optional(),
  razorpay_signature: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
  paymentId: z.string().min(1).optional(),
  signature: z.string().min(1).optional(),
}).refine((value) => Boolean(value.razorpay_payment_id || value.paymentId), {
  message: "Payment ID is required",
}).refine((value) => Boolean(value.razorpay_signature || value.signature), {
  message: "Signature is required",
});

const cancelSubscriptionSchema = z.object({
  subscriptionId: z.string().optional(),
});

export function registerPaymentRoutes(app: Express) {
  const verifyCheckoutHandler = async (req: Request, res: Response) => {
    try {
      const validation = verifyPaymentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification payload",
          errors: validation.error.errors,
        });
      }

      const result = await confirmCheckoutPayment({
        actor: req.user!,
        transactionId: validation.data.transactionId,
        orderId: validation.data.razorpay_order_id || validation.data.orderId,
        paymentId: validation.data.razorpay_payment_id || validation.data.paymentId!,
        signature: validation.data.razorpay_signature || validation.data.signature!,
      });

      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to verify payment";
      const status = message === "PAYMENT_GATEWAY_NOT_CONFIGURED"
        ? 503
        : message === "TRANSACTION_NOT_FOUND"
          ? 404
          : message === "UNAUTHORIZED_TRANSACTION"
            ? 403
            : message === "INVALID_SIGNATURE"
              ? 400
              : 500;

      res.status(status).json({
        success: false,
        message: message.replaceAll("_", " ").toLowerCase(),
      });
    }
  };

  app.get("/api/payments/status", async (_req, res) => {
    try {
      const status = await getGatewayStatus();
      res.json({
        success: true,
        enabled: status.enabled,
        configured: status.configured,
        gateway: status.gateway,
        isTestMode: status.mode === "test",
        mode: status.mode,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch payment status", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment status" });
    }
  });

  app.get("/api/payments/config", async (_req, res) => {
    try {
      const status = await getGatewayStatus();
      res.json({
        success: true,
        configured: status.configured,
        enabled: status.enabled,
        razorpayKeyId: status.keyId,
        gateway: status.gateway,
        mode: status.mode,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch payment config", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment config" });
    }
  });

  app.get("/api/payments/methods", async (_req, res) => {
    try {
      const methods = await getPaymentMethods();
      res.json({
        success: true,
        methods,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch payment methods", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment methods" });
    }
  });

  app.get("/api/payments/plans", async (_req, res) => {
    try {
      const plans = await listPaymentPlans();
      res.json({
        success: true,
        plans,
        data: plans,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch payment plans", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment plans" });
    }
  });

  app.get("/api/payments/packages", async (_req, res) => {
    try {
      const packages = await listWalletTopups();
      res.json({
        success: true,
        data: packages,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch wallet top-up packages", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment packages" });
    }
  });

  app.post("/api/payments/create-order", requireAuth, paymentCreateLimiter, async (req, res) => {
    try {
      const validation = createOrderSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment request",
          errors: validation.error.errors,
        });
      }

      const order = await createCheckoutOrder({
        actor: req.user!,
        planId: validation.data.planId,
        packageId: validation.data.packageId,
      });

      res.json({
        ...order,
        planName: order.label,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create payment order";
      const status = message === "PAYMENT_GATEWAY_NOT_CONFIGURED" ? 503 : 400;
      res.status(status).json({
        success: false,
        message: message.replaceAll("_", " ").toLowerCase(),
      });
    }
  });

  app.post("/api/payments/verify", requireAuth, paymentVerifyLimiter, verifyCheckoutHandler);
  app.post("/api/payments/confirm", requireAuth, paymentVerifyLimiter, verifyCheckoutHandler);
  app.post("/api/payments/verify-payment", requireAuth, paymentVerifyLimiter, verifyCheckoutHandler);

  app.get("/api/payments/history", requireAuth, async (req, res) => {
    try {
      const history = await getViewerPaymentHistory(req.user!);
      res.json({
        success: true,
        data: history,
        payments: history,
      });
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to fetch payment history", error as Error);
      res.status(500).json({ success: false, message: "Failed to fetch payment history" });
    }
  });

  app.post("/api/payments/cancel-subscription", requireAuth, async (req, res) => {
    try {
      const validation = cancelSubscriptionSchema.safeParse(req.body ?? {});
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid cancel request" });
      }

      const result = await cancelViewerSubscription(req.user!);
      res.status(result.success ? 200 : 404).json(result);
    } catch (error) {
      logger.error("PaymentRoutes", "Failed to cancel subscription", error as Error);
      res.status(500).json({ success: false, message: "Failed to cancel subscription" });
    }
  });

  app.post("/api/payments/webhook/razorpay", paymentWebhookLimiter, async (req, res) => {
    try {
      const raw = (req as typeof req & { rawBody?: unknown }).rawBody;
      const rawBody = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : typeof raw === "string"
          ? raw
          : JSON.stringify(req.body ?? {});

      await handleRazorpayWebhook(
        rawBody,
        req.headers["x-razorpay-signature"] as string | undefined,
        req.body,
      );

      res.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Razorpay webhook failed";
      logger.error("PaymentRoutes", "Razorpay webhook failed", error as Error);
      const status = message === "WEBHOOK_SIGNATURE_REQUIRED" || message === "INVALID_WEBHOOK_SIGNATURE"
        ? 401
        : 500;
      res.status(status).json({ success: false, message });
    }
  });

  logger.info("PaymentRoutes", "Payment routes registered");
}
