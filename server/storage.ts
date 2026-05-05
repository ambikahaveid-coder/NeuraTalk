import { 
  users, 
  voiceProfiles, 
  organizations,
  orgMembers,
  type User, 
  type InsertUser, 
  type VoiceProfile, 
  type InsertVoiceProfile,
  type Organization,
  type InsertOrganization,
  type OrgMember,
  type InsertOrgMember,
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import { normalizePhoneNumber } from "@shared/phone";

export interface IStorage {
  // User Auth
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByPhone(phone: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersByOrg(orgId: number): Promise<User[]>;

  // Organizations
  getOrganization(id: number): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getAllOrganizations(): Promise<Organization[]>;
  createOrganization(org: InsertOrganization): Promise<Organization>;
  updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization | undefined>;

  // Org Members
  getOrgMembers(orgId: number): Promise<OrgMember[]>;
  addOrgMember(member: InsertOrgMember): Promise<OrgMember>;
  removeOrgMember(orgId: number, userId: number): Promise<void>;

  // Voice Profiles
  getVoiceProfiles(userId: number): Promise<VoiceProfile[]>;
  getOrgVoiceProfiles(orgId: number): Promise<VoiceProfile[]>;
  createVoiceProfile(profile: InsertVoiceProfile): Promise<VoiceProfile>;
}

export class DatabaseStorage implements IStorage {
  private normalizeInsertUser<T extends Partial<InsertUser>>(payload: T): T {
    if (typeof payload.phone === "string") {
      const normalized = normalizePhoneNumber(payload.phone);
      return { ...payload, phone: normalized || null } as T;
    }

    return payload;
  }

  // === USERS ===
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByPhone(phone: string): Promise<User | undefined> {
    const normalized = normalizePhoneNumber(phone);
    const [user] = await db.select().from(users).where(eq(users.phone, normalized));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(this.normalizeInsertUser(insertUser)).returning();
    return user;
  }

  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users).set(this.normalizeInsertUser(updates)).where(eq(users.id, id)).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUsersByOrg(orgId: number): Promise<User[]> {
    return db.select().from(users).where(eq(users.organizationId, orgId));
  }

  // === ORGANIZATIONS ===
  async getOrganization(id: number): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  }

  async getAllOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations);
  }

  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(org).returning();
    return created;
  }

  async updateOrganization(id: number, updates: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [updated] = await db.update(organizations).set(updates).where(eq(organizations.id, id)).returning();
    return updated;
  }

  // === ORG MEMBERS ===
  async getOrgMembers(orgId: number): Promise<OrgMember[]> {
    return db.select().from(orgMembers).where(eq(orgMembers.organizationId, orgId));
  }

  async addOrgMember(member: InsertOrgMember): Promise<OrgMember> {
    const [created] = await db.insert(orgMembers).values(member).returning();
    return created;
  }

  async removeOrgMember(orgId: number, userId: number): Promise<void> {
    await db.delete(orgMembers).where(
      and(eq(orgMembers.organizationId, orgId), eq(orgMembers.userId, userId))
    );
  }

  // === VOICE PROFILES ===
  async getVoiceProfiles(userId: number): Promise<VoiceProfile[]> {
    return db.select().from(voiceProfiles).where(eq(voiceProfiles.userId, userId));
  }

  async getOrgVoiceProfiles(orgId: number): Promise<VoiceProfile[]> {
    return db.select().from(voiceProfiles).where(eq(voiceProfiles.organizationId, orgId));
  }

  async createVoiceProfile(profile: InsertVoiceProfile): Promise<VoiceProfile> {
    const [res] = await db.insert(voiceProfiles).values(profile).returning();
    return res;
  }
}

export const storage = new DatabaseStorage();
