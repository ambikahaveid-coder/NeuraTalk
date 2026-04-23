/**
 * DYNAMIC LOCATION SYSTEM API
 * 
 * Provides hierarchical location data:
 * Country → State → District → City → Village → Pincode
 * 
 * All data is database-driven, no hardcoded values.
 * Works worldwide (not India-only).
 */

import { Express } from "express";
import { db } from "./db";
import { 
  countries, states, districts, cities, villages, pincodes,
  insertCountrySchema, insertStateSchema, insertDistrictSchema,
  insertCitySchema, insertVillageSchema, insertPincodeSchema
} from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "./observability";
import { requireAuth, requireSuperAdmin } from "./role-middleware";

export function registerLocationRoutes(app: Express) {
  // ============================================================================
  // PUBLIC LOCATION ROUTES (No auth required for form dropdowns)
  // ============================================================================

  /**
   * Get all enabled countries
   */
  app.get("/api/locations/countries", async (req, res) => {
    try {
      const result = await db.select()
        .from(countries)
        .where(eq(countries.isEnabled, true))
        .orderBy(asc(countries.name));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch countries", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch countries" });
    }
  });

  /**
   * Get states for a country
   */
  app.get("/api/locations/countries/:countryId/states", async (req, res) => {
    try {
      const countryId = parseInt(req.params.countryId);
      if (isNaN(countryId)) {
        return res.status(400).json({ success: false, message: "Invalid country ID" });
      }

      const result = await db.select()
        .from(states)
        .where(and(
          eq(states.countryId, countryId),
          eq(states.isEnabled, true)
        ))
        .orderBy(asc(states.name));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch states", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch states" });
    }
  });

  /**
   * Get districts for a state
   */
  app.get("/api/locations/states/:stateId/districts", async (req, res) => {
    try {
      const stateId = parseInt(req.params.stateId);
      if (isNaN(stateId)) {
        return res.status(400).json({ success: false, message: "Invalid state ID" });
      }

      const result = await db.select()
        .from(districts)
        .where(and(
          eq(districts.stateId, stateId),
          eq(districts.isEnabled, true)
        ))
        .orderBy(asc(districts.name));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch districts", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch districts" });
    }
  });

  /**
   * Get cities for a district
   */
  app.get("/api/locations/districts/:districtId/cities", async (req, res) => {
    try {
      const districtId = parseInt(req.params.districtId);
      if (isNaN(districtId)) {
        return res.status(400).json({ success: false, message: "Invalid district ID" });
      }

      const result = await db.select()
        .from(cities)
        .where(and(
          eq(cities.districtId, districtId),
          eq(cities.isEnabled, true)
        ))
        .orderBy(asc(cities.name));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch cities", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch cities" });
    }
  });

  /**
   * Get villages for a city
   */
  app.get("/api/locations/cities/:cityId/villages", async (req, res) => {
    try {
      const cityId = parseInt(req.params.cityId);
      if (isNaN(cityId)) {
        return res.status(400).json({ success: false, message: "Invalid city ID" });
      }

      const result = await db.select()
        .from(villages)
        .where(and(
          eq(villages.cityId, cityId),
          eq(villages.isEnabled, true)
        ))
        .orderBy(asc(villages.name));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch villages", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch villages" });
    }
  });

  /**
   * Get pincodes for a city or village
   */
  app.get("/api/locations/pincodes", async (req, res) => {
    try {
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : null;
      const villageId = req.query.villageId ? parseInt(req.query.villageId as string) : null;

      if (!cityId && !villageId) {
        return res.status(400).json({ success: false, message: "Provide cityId or villageId" });
      }

      let conditions: any[] = [eq(pincodes.isEnabled, true)];
      if (cityId) conditions.push(eq(pincodes.cityId, cityId));
      if (villageId) conditions.push(eq(pincodes.villageId, villageId));

      const result = await db.select()
        .from(pincodes)
        .where(and(...conditions))
        .orderBy(asc(pincodes.code));
      
      res.json({ success: true, data: result });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to fetch pincodes", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch pincodes" });
    }
  });

  /**
   * Search pincodes by code
   */
  app.get("/api/locations/pincodes/search", async (req, res) => {
    try {
      const code = req.query.code as string;
      if (!code || code.length < 2) {
        return res.status(400).json({ success: false, message: "Provide at least 2 characters" });
      }

      const result = await db.select()
        .from(pincodes)
        .where(eq(pincodes.isEnabled, true))
        .orderBy(asc(pincodes.code))
        .limit(20);

      // Filter by code prefix in memory (Drizzle doesn't have startsWith)
      const filtered = result.filter(p => p.code.startsWith(code));
      
      res.json({ success: true, data: filtered });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to search pincodes", err as Error);
      res.status(500).json({ success: false, message: "Failed to search pincodes" });
    }
  });

  // ============================================================================
  // ADMIN LOCATION MANAGEMENT (Super Admin only)
  // ============================================================================

  /**
   * Add a new country
   */
  app.post("/api/admin/locations/countries", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertCountrySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [country] = await db.insert(countries).values(parsed.data).returning();
      res.json({ success: true, data: country });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add country", err as Error);
      res.status(500).json({ success: false, message: "Failed to add country" });
    }
  });

  /**
   * Add a new state
   */
  app.post("/api/admin/locations/states", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertStateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [state] = await db.insert(states).values(parsed.data).returning();
      res.json({ success: true, data: state });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add state", err as Error);
      res.status(500).json({ success: false, message: "Failed to add state" });
    }
  });

  /**
   * Add a new district
   */
  app.post("/api/admin/locations/districts", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertDistrictSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [district] = await db.insert(districts).values(parsed.data).returning();
      res.json({ success: true, data: district });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add district", err as Error);
      res.status(500).json({ success: false, message: "Failed to add district" });
    }
  });

  /**
   * Add a new city
   */
  app.post("/api/admin/locations/cities", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertCitySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [city] = await db.insert(cities).values(parsed.data).returning();
      res.json({ success: true, data: city });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add city", err as Error);
      res.status(500).json({ success: false, message: "Failed to add city" });
    }
  });

  /**
   * Add a new village
   */
  app.post("/api/admin/locations/villages", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertVillageSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [village] = await db.insert(villages).values(parsed.data).returning();
      res.json({ success: true, data: village });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add village", err as Error);
      res.status(500).json({ success: false, message: "Failed to add village" });
    }
  });

  /**
   * Add a new pincode
   */
  app.post("/api/admin/locations/pincodes", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const parsed = insertPincodeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: parsed.error.errors });
      }

      const [pincode] = await db.insert(pincodes).values(parsed.data).returning();
      res.json({ success: true, data: pincode });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to add pincode", err as Error);
      res.status(500).json({ success: false, message: "Failed to add pincode" });
    }
  });

  /**
   * Bulk import locations (for initial data seeding)
   */
  app.post("/api/admin/locations/bulk-import", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { type, data } = req.body;
      
      if (!type || !data || !Array.isArray(data)) {
        return res.status(400).json({ success: false, message: "Provide type and data array" });
      }

      let inserted = 0;
      switch (type) {
        case "countries":
          await db.insert(countries).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        case "states":
          await db.insert(states).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        case "districts":
          await db.insert(districts).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        case "cities":
          await db.insert(cities).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        case "villages":
          await db.insert(villages).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        case "pincodes":
          await db.insert(pincodes).values(data).onConflictDoNothing();
          inserted = data.length;
          break;
        default:
          return res.status(400).json({ success: false, message: "Invalid type" });
      }

      res.json({ success: true, message: `Imported ${inserted} ${type}` });
    } catch (err) {
      logger.error("LocationRoutes", "Failed to bulk import", err as Error);
      res.status(500).json({ success: false, message: "Failed to bulk import" });
    }
  });

  logger.info("LocationRoutes", "Location routes registered");
}
