/**
 * Business Customers -- Phase 4 API surface, extended in Phase 8 (doc 34)
 * with the marketing-consent write path. See
 * docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md
 * and docs/neura-ecosystem/34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md.
 * No campaign/OTP/marketing SEND route exists here or anywhere in this
 * module -- consent is a customer-relationship fact, not a send action.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerCustomerRoutes(app: Express): void {
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.CUSTOMERS_MANAGE)];
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.CUSTOMERS_MANAGE, PERMISSIONS.CUSTOMERS_VIEW)];

  app.post("/api/business/:businessId/customers", ...manage, ctrl.postCustomer);
  app.get("/api/business/:businessId/customers", ...view, ctrl.getCustomers);
  app.get("/api/business/:businessId/customers/:customerId", ...view, ctrl.getCustomerById);
  app.put("/api/business/:businessId/customers/:customerId", ...manage, ctrl.putCustomer);
  app.post("/api/business/:businessId/customers/:customerId/archive", ...manage, ctrl.postArchiveCustomer);

  // Consent write path -- grant/revoke reuses CUSTOMERS_MANAGE (no new
  // permission, doc 34 section 9); view reuses the existing view gate.
  app.post("/api/business/:businessId/customers/:customerId/consent", ...manage, ctrl.postConsent);
  app.get("/api/business/:businessId/customers/:customerId/consent", ...view, ctrl.getConsents);
}
