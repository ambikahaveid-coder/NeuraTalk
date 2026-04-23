import { storage } from "./storage";
import { db } from "./db";
import { users, USER_ROLES, billingPlans, gstSettings, supportedLanguages } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "./password-utils";

/**
 * Seed default billing plans.
 * Creates modern B2C and B2B tiers if they do not exist yet.
 */
export async function seedBillingPlans(): Promise<void> {
  const existingPlans = await db.select().from(billingPlans).limit(1);
  if (existingPlans.length > 0) {
    console.log("Billing plans already seeded");
    return;
  }

  const b2cPlans = [
    {
      name: "Free Trial",
      description: "15 minutes free - try voice, video, and face-to-face translation",
      planType: "b2c",
      duration: "weekly",
      durationDays: 7,
      includedMinutes: 15,
      priceInPaise: 0,
      features: { translation: true, emotionPreservation: true },
      displayOrder: 1,
    },
    {
      name: "Starter",
      description: "7-day access with 120 minutes for short personal calls",
      planType: "b2c",
      duration: "weekly",
      durationDays: 7,
      includedMinutes: 120,
      priceInPaise: 4900,
      features: { translation: true, emotionPreservation: true },
      displayOrder: 2,
    },
    {
      name: "Premium",
      description: "30-day access with 600 minutes for regular multilingual calling",
      planType: "b2c",
      duration: "monthly",
      durationDays: 30,
      includedMinutes: 600,
      priceInPaise: 14900,
      isFeatured: true,
      features: { translation: true, emotionPreservation: true, prioritySupport: true },
      displayOrder: 3,
    },
    {
      name: "Gold",
      description: "90-day access with 2000 minutes for frequent voice and video sessions",
      planType: "b2c",
      duration: "quarterly",
      durationDays: 90,
      includedMinutes: 2000,
      priceInPaise: 34900,
      features: { translation: true, emotionPreservation: true, prioritySupport: true },
      displayOrder: 4,
    },
    {
      name: "Platinum",
      description: "365-day access with 10000 minutes and the best effective per-second rate",
      planType: "b2c",
      duration: "yearly",
      durationDays: 365,
      includedMinutes: 10000,
      priceInPaise: 99900,
      features: { translation: true, emotionPreservation: true, prioritySupport: true, apiAccess: true },
      displayOrder: 5,
    },
    {
      name: "Enterprise",
      description: "Unlimited usage, custom integrations, dedicated support, and SLA options",
      planType: "b2c",
      duration: "yearly",
      durationDays: 365,
      includedMinutes: 99999,
      priceInPaise: 0,
      features: {
        translation: true,
        emotionPreservation: true,
        contactSales: true,
        dedicatedSupport: true,
        customIntegrations: true,
        apiAccess: true,
      },
      displayOrder: 6,
    },
  ];

  const b2bPlans = [
    {
      name: "Starter",
      description: "For small teams - 500 minutes/month, up to 5 agents",
      planType: "b2b",
      billingModel: "prepaid",
      duration: "monthly",
      durationDays: 30,
      includedMinutes: 500,
      priceInPaise: 49900,
      features: { translation: true, emotionPreservation: true, prioritySupport: true },
      displayOrder: 1,
    },
    {
      name: "Premium Team",
      description: "For growing teams - 2000 minutes/month, up to 20 agents",
      planType: "b2b",
      billingModel: "prepaid",
      duration: "monthly",
      durationDays: 30,
      includedMinutes: 2000,
      priceInPaise: 149900,
      isFeatured: true,
      features: { translation: true, emotionPreservation: true, prioritySupport: true, apiAccess: true },
      displayOrder: 2,
    },
    {
      name: "Gold Team",
      description: "For mid-size businesses - 5000 minutes/month with analytics and priority support",
      planType: "b2b",
      billingModel: "prepaid",
      duration: "monthly",
      durationDays: 30,
      includedMinutes: 5000,
      priceInPaise: 299900,
      features: { translation: true, emotionPreservation: true, prioritySupport: true, apiAccess: true },
      displayOrder: 3,
    },
    {
      name: "Enterprise",
      description: "Unlimited usage, SLA guarantee, dedicated account manager, and private deployments",
      planType: "b2b",
      billingModel: "prepaid",
      duration: "monthly",
      durationDays: 30,
      includedMinutes: 99999,
      priceInPaise: 0,
      features: {
        translation: true,
        emotionPreservation: true,
        contactSales: true,
        dedicatedSupport: true,
        sla: true,
        apiAccess: true,
        customIntegrations: true,
      },
      displayOrder: 4,
    },
  ];

  for (const plan of b2cPlans) {
    await db.insert(billingPlans).values({
      ...plan,
      billingModel: "prepaid",
      currency: "INR",
      gstPercentage: 18,
      isEnabled: true,
      isFeatured: plan.isFeatured || false,
      features: plan.features || { translation: true, emotionPreservation: true, prioritySupport: false },
    });
  }

  for (const plan of b2bPlans) {
    await db.insert(billingPlans).values({
      ...plan,
      currency: "INR",
      gstPercentage: 18,
      isEnabled: true,
      isFeatured: plan.isFeatured || false,
      features: plan.features || { translation: true, emotionPreservation: true, prioritySupport: true, apiAccess: true },
    });
  }

  console.log("Seeded default billing plans");
}

/**
 * Seed platform GST settings.
 */
export async function seedGstSettings(): Promise<void> {
  const [existing] = await db.select()
    .from(gstSettings)
    .where(sql`${gstSettings.organizationId} IS NULL`);

  if (existing) {
    console.log("Platform GST settings already exist");
    return;
  }

  await db.insert(gstSettings).values({
    legalName: "NeuraTalk Technologies Private Limited",
    tradeName: "NeuraTalk",
    invoicePrefix: "NT",
    invoiceCounter: 1,
    hsnCode: "998314",
    defaultGstRate: 18,
    stateCode: "36",
    placeOfSupply: "Telangana",
  });

  console.log("Seeded platform GST settings");
}

/**
 * Seed production super admin account.
 */
export async function seedSuperAdmin(): Promise<void> {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL;
  const superAdminPhone = process.env.SUPER_ADMIN_PHONE;

  if (!superAdminEmail && !superAdminPhone) {
    console.log("Skipping super admin seed - SUPER_ADMIN_EMAIL or SUPER_ADMIN_PHONE not configured");
    return;
  }

  const existingSuperAdmin = await db.query.users.findFirst({
    where: eq(users.role, USER_ROLES.SUPER_ADMIN),
  });

  if (existingSuperAdmin) {
    console.log("Super admin already exists:", existingSuperAdmin.username);
    return;
  }

  const [superAdmin] = await db.insert(users).values({
    username: "superadmin",
    email: superAdminEmail,
    phone: superAdminPhone,
    role: USER_ROLES.SUPER_ADMIN,
    emailVerified: !!superAdminEmail,
    phoneVerified: !!superAdminPhone,
    isActive: true,
  }).returning();

  console.log("Created production super admin:", superAdmin.username);
  console.log("Super admin can login via OTP using:", superAdminEmail || superAdminPhone);
}

/**
 * Seed supported languages for translation.
 */
export async function seedSupportedLanguages(): Promise<void> {
  const existing = await db.select().from(supportedLanguages).limit(1);
  if (existing.length > 0) {
    console.log("Supported languages already seeded");
    return;
  }

  const languages = [
    { code: "en", name: "English", nativeName: "English", isDefault: true, displayOrder: 1 },
    { code: "hi", name: "Hindi", nativeName: "हिंदी", displayOrder: 2 },
    { code: "te", name: "Telugu", nativeName: "తెలుగు", displayOrder: 3 },
    { code: "ta", name: "Tamil", nativeName: "தமிழ்", displayOrder: 4 },
    { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", displayOrder: 5 },
    { code: "ml", name: "Malayalam", nativeName: "മലയാളം", displayOrder: 6 },
    { code: "mr", name: "Marathi", nativeName: "मराठी", displayOrder: 7 },
    { code: "bn", name: "Bengali", nativeName: "বাংলা", displayOrder: 8 },
    { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", displayOrder: 9 },
    { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", displayOrder: 10 },
    { code: "ur", name: "Urdu", nativeName: "اردو", displayOrder: 11 },
    { code: "es", name: "Spanish", nativeName: "Español", displayOrder: 12 },
    { code: "fr", name: "French", nativeName: "Français", displayOrder: 13 },
    { code: "de", name: "German", nativeName: "Deutsch", displayOrder: 14 },
    { code: "ja", name: "Japanese", nativeName: "日本語", displayOrder: 15 },
    { code: "ko", name: "Korean", nativeName: "한국어", displayOrder: 16 },
    { code: "zh", name: "Chinese", nativeName: "中文", displayOrder: 17 },
    { code: "ar", name: "Arabic", nativeName: "العربية", displayOrder: 18 },
    { code: "pt", name: "Portuguese", nativeName: "Português", displayOrder: 19 },
    { code: "ru", name: "Russian", nativeName: "Русский", displayOrder: 20 },
  ];

  for (const lang of languages) {
    await db.insert(supportedLanguages).values({
      ...lang,
      isEnabled: true,
      isDefault: lang.isDefault || false,
    });
  }

  console.log(`Seeded ${languages.length} supported languages`);
}

export async function seed() {
  await seedSuperAdmin();
  await seedBillingPlans();
  await seedGstSettings();
  await seedSupportedLanguages();

  if (process.env.NODE_ENV === "production") {
    console.log("Skipping demo user in production mode");
    return;
  }

  const existingUser = await storage.getUserByUsername("demo");
  let userId: number;

  if (!existingUser) {
    const user = await storage.createUser({
      username: "demo",
      password: hashPassword("demo123secure"),
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=demo",
    });
    userId = user.id;
    console.log("Seeded user: demo");
  } else {
    userId = existingUser.id;
  }

  const profiles = await storage.getVoiceProfiles(userId);
  if (profiles.length === 0) {
    await storage.createVoiceProfile({
      userId,
      name: "Neo (Default)",
      voiceId: "alloy",
      settings: { speed: 1.0, pitch: 1.0 },
      isCustom: false,
    });
    console.log("Seeded default voice profile");
  }
}
