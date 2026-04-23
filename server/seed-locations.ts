/**
 * SEED INITIAL LOCATION DATA
 * 
 * Seeds essential location data for the platform:
 * - Countries with dial codes
 * - States for India (primary market)
 * - Sample districts, cities for key states
 * 
 * Run with: npx tsx server/seed-locations.ts
 */

import { db } from "./db";
import { countries, states, districts, cities, supportedLanguages } from "@shared/schema";
import { eq, and } from "drizzle-orm";

async function seedLocations() {
  console.log("Seeding location data...");

  // Seed countries
  const countryData = [
    { code: "IN", name: "India", dialCode: "+91", currency: "INR", isEnabled: true, flagEmoji: "🇮🇳" },
    { code: "US", name: "United States", dialCode: "+1", currency: "USD", isEnabled: true, flagEmoji: "🇺🇸" },
    { code: "GB", name: "United Kingdom", dialCode: "+44", currency: "GBP", isEnabled: true, flagEmoji: "🇬🇧" },
    { code: "AE", name: "United Arab Emirates", dialCode: "+971", currency: "AED", isEnabled: true, flagEmoji: "🇦🇪" },
    { code: "SG", name: "Singapore", dialCode: "+65", currency: "SGD", isEnabled: true, flagEmoji: "🇸🇬" },
    { code: "AU", name: "Australia", dialCode: "+61", currency: "AUD", isEnabled: true, flagEmoji: "🇦🇺" },
    { code: "CA", name: "Canada", dialCode: "+1", currency: "CAD", isEnabled: true, flagEmoji: "🇨🇦" },
    { code: "DE", name: "Germany", dialCode: "+49", currency: "EUR", isEnabled: true, flagEmoji: "🇩🇪" },
  ];

  for (const country of countryData) {
    await db.insert(countries).values(country).onConflictDoNothing();
  }
  console.log(`Seeded ${countryData.length} countries`);

  // Get India for state seeding
  const [india] = await db.select().from(countries).where(eq(countries.code, "IN")).limit(1);
  
  if (india) {
    // Seed Indian states
    const stateData = [
      { countryId: india.id, code: "TS", name: "Telangana" },
      { countryId: india.id, code: "AP", name: "Andhra Pradesh" },
      { countryId: india.id, code: "KA", name: "Karnataka" },
      { countryId: india.id, code: "TN", name: "Tamil Nadu" },
      { countryId: india.id, code: "KL", name: "Kerala" },
      { countryId: india.id, code: "MH", name: "Maharashtra" },
      { countryId: india.id, code: "DL", name: "Delhi" },
      { countryId: india.id, code: "GJ", name: "Gujarat" },
      { countryId: india.id, code: "WB", name: "West Bengal" },
      { countryId: india.id, code: "RJ", name: "Rajasthan" },
      { countryId: india.id, code: "UP", name: "Uttar Pradesh" },
      { countryId: india.id, code: "MP", name: "Madhya Pradesh" },
      { countryId: india.id, code: "BR", name: "Bihar" },
      { countryId: india.id, code: "PB", name: "Punjab" },
      { countryId: india.id, code: "HR", name: "Haryana" },
    ];

    for (const state of stateData) {
      await db.insert(states).values(state).onConflictDoNothing();
    }
    console.log(`Seeded ${stateData.length} Indian states`);

    // Get Telangana for district/city seeding
    const [telangana] = await db.select().from(states)
      .where(and(eq(states.code, "TS"), eq(states.countryId, india.id))).limit(1);

    if (telangana) {
      // Seed Telangana districts
      const districtData = [
        { stateId: telangana.id, name: "Hyderabad" },
        { stateId: telangana.id, name: "Rangareddy" },
        { stateId: telangana.id, name: "Medchal-Malkajgiri" },
        { stateId: telangana.id, name: "Sangareddy" },
        { stateId: telangana.id, name: "Warangal Urban" },
        { stateId: telangana.id, name: "Karimnagar" },
        { stateId: telangana.id, name: "Nizamabad" },
        { stateId: telangana.id, name: "Khammam" },
      ];

      for (const district of districtData) {
        await db.insert(districts).values(district).onConflictDoNothing();
      }
      console.log(`Seeded ${districtData.length} Telangana districts`);

      // Get Hyderabad district for city seeding
      const [hyd] = await db.select().from(districts)
        .where(and(eq(districts.name, "Hyderabad"), eq(districts.stateId, telangana.id))).limit(1);

      if (hyd) {
        const cityData = [
          { districtId: hyd.id, name: "Hyderabad", isTier1: true },
          { districtId: hyd.id, name: "Secunderabad", isTier1: false },
        ];

        for (const city of cityData) {
          await db.insert(cities).values(city).onConflictDoNothing();
        }
        console.log(`Seeded cities`);
      }
    }
  }

  console.log("Location seeding complete!");
}

async function seedLanguages() {
  console.log("Seeding supported languages...");

  const languageData = [
    { code: "en", name: "English", nativeName: "English", isEnabled: true, isDefault: true, displayOrder: 1 },
    { code: "te", name: "Telugu", nativeName: "తెలుగు", isEnabled: true, isDefault: false, displayOrder: 2 },
    { code: "ta", name: "Tamil", nativeName: "தமிழ்", isEnabled: true, isDefault: false, displayOrder: 3 },
    { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", isEnabled: true, isDefault: false, displayOrder: 4 },
    { code: "hi", name: "Hindi", nativeName: "हिंदी", isEnabled: true, isDefault: false, displayOrder: 5 },
  ];

  for (const lang of languageData) {
    await db.insert(supportedLanguages).values(lang).onConflictDoNothing();
  }
  console.log(`Seeded ${languageData.length} languages`);
}

async function main() {
  try {
    await seedLocations();
    await seedLanguages();
    console.log("All seeding complete!");
    process.exit(0);
  } catch (err) {
    console.error("Seeding failed:", err);
    process.exit(1);
  }
}

main();
