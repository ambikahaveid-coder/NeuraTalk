/**
 * Business Customers -- Phase 4 API surface.
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 * No campaign/OTP/marketing send route exists here or anywhere in this
 * module -- out of scope, future phase.
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
}
