import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === ROLE DEFINITIONS ===
export const USER_ROLES = {
  SUPER_ADMIN: "super_admin",     // Platform owner (NeuraTalk team)
  COMPANY_ADMIN: "company_admin", // B2B company admin
  AGENT: "agent",                 // B2B agent/staff
  CONSUMER: "consumer",           // B2C user (individual)
  INVESTOR: "investor",           // Investor with platform analytics access
  // Legacy mappings for backward compatibility
  ADMIN: "super_admin",
  BUSINESS: "company_admin",
} as const;

export type UserRole = "super_admin" | "company_admin" | "agent" | "consumer" | "investor";

// === COMPANY STATUS ===
export const COMPANY_STATUS = {
  PENDING: "pending",       // Waiting for Super Admin approval
  APPROVED: "approved",     // Approved and active
  REJECTED: "rejected",     // Rejected by Super Admin
  SUSPENDED: "suspended",   // Temporarily suspended
} as const;

export type CompanyStatus = typeof COMPANY_STATUS[keyof typeof COMPANY_STATUS];

// === OTP CHANNEL ===
export const OTP_CHANNEL = {
  EMAIL: "email",
  MOBILE: "mobile",
} as const;

export type OtpChannel = typeof OTP_CHANNEL[keyof typeof OTP_CHANNEL];

// === TABLE DEFINITIONS ===

// Companies (for B2B) - Extended organizations with approval workflow
export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // URL-friendly identifier
  logoUrl: text("logo_url"),
  plan: text("plan").default("free"), // free, pro, enterprise
  settings: jsonb("settings").default({}), // Custom org settings
  isActive: boolean("is_active").default(true),
  dataRetentionDays: integer("data_retention_days").default(30), // Founder's Roadmap: Privacy compliance
  // B2B Onboarding fields
  status: text("status").default("pending"), // pending, approved, rejected, suspended
  email: text("email"), // Company contact email
  phone: text("phone"), // Company phone
  industry: text("industry"), // Industry type
  website: text("website"),
  address: text("address"),
  // Approval workflow
  approvedAt: timestamp("approved_at"),
  approvedBy: integer("approved_by"), // Super Admin user ID
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  // Language configuration
  primaryLanguage: text("primary_language").default("en"),
  supportedLanguages: jsonb("supported_languages").default(["en"]),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("organizations_status_idx").on(table.status),
  uniqueIndex("organizations_email_unique_idx").on(table.email).where(sql`email IS NOT NULL`),
]);

// OTP Challenges for authentication
export const otpChallenges = pgTable("otp_challenges", {
  id: serial("id").primaryKey(),
  identifier: text("identifier").notNull(), // Email or phone number
  channel: text("channel").notNull(), // "email" or "mobile"
  codeHash: text("code_hash").notNull(), // Hashed OTP code
  isDummy: boolean("is_dummy").default(false), // For testing mode
  attempts: integer("attempts").default(0),
  maxAttempts: integer("max_attempts").default(3),
  expiresAt: timestamp("expires_at").notNull(),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("otp_identifier_channel_idx").on(table.identifier, table.channel),
  index("otp_expires_idx").on(table.expiresAt),
]);

// Platform Settings (Super Admin configurable)
export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: jsonb("value").default({}),
  description: text("description"),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Sessions (database-backed for production)
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: integer("user_id").notNull(),
  organizationId: integer("organization_id"),
  tenantSlug: text("tenant_slug"),
  sessionScope: text("session_scope").default("platform"), // platform, tenant
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  mfaVerifiedAt: timestamp("mfa_verified_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  lastActivityAt: timestamp("last_activity_at").defaultNow(),
}, (table) => [
  index("sessions_user_idx").on(table.userId),
  index("sessions_org_idx").on(table.organizationId),
  index("sessions_tenant_idx").on(table.tenantSlug),
  index("sessions_expires_idx").on(table.expiresAt),
]);

// Feature Flags (persisted for production)
export const featureFlagsDb = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  enabled: boolean("enabled").default(false),
  description: text("description"),
  rolloutPercentage: integer("rollout_percentage").default(100),
  enabledForUsers: jsonb("enabled_for_users").default([]),
  disabledForUsers: jsonb("disabled_for_users").default([]),
  killSwitch: boolean("kill_switch").default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Users with roles
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password"), // Optional - OTP users may not have password
  email: text("email"),
  phone: text("phone"), // For OTP auth
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("consumer"), // super_admin, company_admin, agent, consumer
  organizationId: integer("organization_id"), // For B2B users
  isActive: boolean("is_active").default(true),
  // OTP auth fields
  emailVerified: boolean("email_verified").default(false),
  phoneVerified: boolean("phone_verified").default(false),
  lastLoginAt: timestamp("last_login_at"),
  // Compliance & Legal (Founder's Roadmap)
  consentTerms: boolean("consent_terms").default(false),
  consentTranslation: boolean("consent_translation").default(false),
  consentRecording: boolean("consent_recording").default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  // Global Routing & Latency
  preferredRegion: text("preferred_region").default("ap-south-1"), // Default to Mumbai for India presence
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("users_email_unique_idx").on(table.email).where(sql`email IS NOT NULL`),
  uniqueIndex("users_phone_unique_idx").on(table.phone).where(sql`phone IS NOT NULL`),
  index("users_org_idx").on(table.organizationId),
  index("users_role_idx").on(table.role),
]);

// Organization Members (for team management in B2B)
export const orgMembers = pgTable("org_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  memberRole: text("member_role").notNull().default("member"), // owner, admin, member
  permissions: jsonb("permissions").default([]), // Specific permissions
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("org_members_user_org_unique_idx").on(table.userId, table.organizationId),
  index("org_members_org_idx").on(table.organizationId),
]);

// Custom Roles (for enterprise granular permissions)
export const customRoles = pgTable("custom_roles", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: jsonb("permissions").default([]), // List of permission strings
  isDefault: boolean("is_default").default(false), // Default role for new users
  priority: integer("priority").default(0), // Role priority for conflicts
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("custom_roles_org_idx").on(table.organizationId),
  uniqueIndex("custom_roles_org_name_idx").on(table.organizationId, table.name),
]);

export const insertCustomRoleSchema = createInsertSchema(customRoles).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomRole = z.infer<typeof insertCustomRoleSchema>;
export type CustomRole = typeof customRoles.$inferSelect;

// Permission definitions (reference table)
export const PERMISSIONS = {
  // Call management
  CALLS_INITIATE: "calls:initiate",
  CALLS_RECEIVE: "calls:receive",
  CALLS_RECORD: "calls:record",
  CALLS_TRANSFER: "calls:transfer",
  CALLS_VIEW_HISTORY: "calls:view_history",
  CALLS_VIEW_ALL: "calls:view_all",
  
  // User management
  USERS_VIEW: "users:view",
  USERS_CREATE: "users:create",
  USERS_EDIT: "users:edit",
  USERS_DELETE: "users:delete",
  USERS_ASSIGN_ROLES: "users:assign_roles",
  
  // Organization settings
  ORG_VIEW_SETTINGS: "org:view_settings",
  ORG_EDIT_SETTINGS: "org:edit_settings",
  ORG_MANAGE_BILLING: "org:manage_billing",
  ORG_VIEW_ANALYTICS: "org:view_analytics",
  ORG_MANAGE_INTEGRATIONS: "org:manage_integrations",
  
  // AI features
  AI_CHAT: "ai:chat",
  AI_VOICE: "ai:voice",
  AI_IMAGE: "ai:image",
  AI_TRANSLATION: "ai:translation",
  
  // Security
  SECURITY_VIEW_AUDIT: "security:view_audit",
  SECURITY_MANAGE_IP: "security:manage_ip",
  SECURITY_MANAGE_SESSIONS: "security:manage_sessions",
  
  // API access
  API_READ: "api:read",
  API_WRITE: "api:write",
  API_MANAGE_KEYS: "api:manage_keys",
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Voice Profiles (for "Cloning" configuration)
export const voiceProfiles = pgTable("voice_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  organizationId: integer("organization_id"), // Org-level voice profiles for B2B
  name: text("name").notNull(),
  voiceId: text("voice_id").notNull(),
  settings: jsonb("settings").default({}),
  isCustom: boolean("is_custom").default(false),
  isShared: boolean("is_shared").default(false), // Share across org
  isEnabled: boolean("is_enabled").default(true), // User can enable/disable
  trainingStatus: text("training_status").default("pending"), // pending, training, ready, failed
  createdAt: timestamp("created_at").defaultNow(),
});

// Voice Samples (for voice training)
export const voiceSamples = pgTable("voice_samples", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  voiceProfileId: integer("voice_profile_id"),
  objectPath: text("object_path").notNull(), // Encrypted path in object storage
  duration: integer("duration"), // Duration in seconds
  transcript: text("transcript"), // What was spoken in the sample
  status: text("status").default("pending"), // pending, processed, failed
  consentGiven: boolean("consent_given").default(false),
  consentTimestamp: timestamp("consent_timestamp"),
  metadata: jsonb("metadata").default({}), // Audio format, quality, etc.
  createdAt: timestamp("created_at").defaultNow(),
});

// Conversations
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  organizationId: integer("organization_id"), // For B2B context
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Messages
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  audioUrl: text("audio_url"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// === VOICE MEMOS (Translated Voice Messages) ===
export const voiceMemos = pgTable("voice_memos", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: integer("recipient_id").references(() => users.id, { onDelete: "set null" }),
  groupChatId: integer("group_chat_id"), // For group messages
  
  // Original audio
  originalAudioPath: text("original_audio_path").notNull(), // Encrypted path in object storage
  originalLanguage: text("original_language").notNull().default("en"),
  originalTranscript: text("original_transcript"),
  
  // Translated versions (stored as JSON: { "es": { audioPath, transcript }, "hi": {...} })
  translations: jsonb("translations").default({}),
  
  // Voice cloning settings
  useVoiceCloning: boolean("use_voice_cloning").default(false),
  voiceProfileId: integer("voice_profile_id"),
  
  // Metadata
  duration: integer("duration"), // Duration in seconds
  status: text("status").default("pending"), // pending, transcribing, translating, ready, failed
  emotionTags: text("emotion_tags").array(), // ['happy', 'excited']
  
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// === GROUP CHATS (Multi-Language Groups) ===
export const groupChats = pgTable("group_chats", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdById: integer("created_by_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  
  // Settings
  avatarUrl: text("avatar_url"),
  isTranslationEnabled: boolean("is_translation_enabled").default(true),
  defaultLanguage: text("default_language").default("en"),
  
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Group Chat Members
export const groupChatMembers = pgTable("group_chat_members", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").notNull().references(() => groupChats.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Member settings
  preferredLanguage: text("preferred_language").notNull().default("en"), // User's language in this group
  nickname: text("nickname"), // Optional display name in group
  role: text("role").default("member"), // admin, moderator, member
  
  // Notifications
  isMuted: boolean("is_muted").default(false),
  lastReadAt: timestamp("last_read_at"),
  
  joinedAt: timestamp("joined_at").defaultNow(),
}, (table) => ({
  uniqueMember: uniqueIndex("group_chat_members_unique").on(table.groupChatId, table.userId),
}));

// Group Chat Messages (text + voice)
export const groupChatMessages = pgTable("group_chat_messages", {
  id: serial("id").primaryKey(),
  groupChatId: integer("group_chat_id").notNull().references(() => groupChats.id, { onDelete: "cascade" }),
  senderId: integer("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  
  // Message content
  messageType: text("message_type").notNull().default("text"), // text, voice, image
  originalContent: text("original_content"), // Original text or transcript
  originalLanguage: text("original_language").notNull().default("en"),
  
  // Voice message specific
  audioPath: text("audio_path"), // For voice messages
  duration: integer("duration"), // For voice messages
  
  // Translations cache: { "es": "Hola", "hi": "नमस्ते" }
  translations: jsonb("translations").default({}),
  
  // Voice translations: { "es": { audioPath, voiceId }, "hi": {...} }
  voiceTranslations: jsonb("voice_translations").default({}),
  
  // Metadata
  emotionTags: text("emotion_tags").array(),
  replyToId: integer("reply_to_id"), // For reply threads
  
  isEdited: boolean("is_edited").default(false),
  isDeleted: boolean("is_deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === MEETING ROOMS (Video Conferencing) ===

// Meeting room status
export const MEETING_STATUS = {
  SCHEDULED: "scheduled",
  ACTIVE: "active",
  ENDED: "ended",
  CANCELLED: "cancelled",
} as const;

export type MeetingStatus = typeof MEETING_STATUS[keyof typeof MEETING_STATUS];

// Meeting Rooms - Multi-party video/audio calls
export const meetingRooms = pgTable("meeting_rooms", {
  id: serial("id").primaryKey(),
  roomCode: text("room_code").notNull().unique(), // 6-char invite code
  name: text("name").notNull(),
  hostUserId: integer("host_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  status: text("status").notNull().default("scheduled"),
  // Meeting settings
  maxParticipants: integer("max_participants").default(10),
  isVideoEnabled: boolean("is_video_enabled").default(true),
  isTranslationEnabled: boolean("is_translation_enabled").default(true),
  defaultLanguage: text("default_language").default("en"),
  isRecordingEnabled: boolean("is_recording_enabled").default(false),
  isWaitingRoomEnabled: boolean("is_waiting_room_enabled").default(true),
  // Timing
  scheduledAt: timestamp("scheduled_at"),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  duration: integer("duration"), // Duration in seconds
  createdAt: timestamp("created_at").defaultNow(),
});

// Meeting Participants
export const meetingParticipants = pgTable("meeting_participants", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetingRooms.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => users.id),
  displayName: text("display_name").notNull(),
  language: text("language").default("en"),
  role: text("role").notNull().default("participant"), // host, co-host, participant
  isVideoOn: boolean("is_video_on").default(true),
  isAudioOn: boolean("is_audio_on").default(true),
  isScreenSharing: boolean("is_screen_sharing").default(false),
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
});

// === CALL BRIDGING TABLES ===

// Call status enum-like values
export const CALL_STATUS = {
  PENDING: "pending",       // Call initiated, waiting for connection
  RINGING: "ringing",       // Outbound call ringing
  ACTIVE: "active",         // Call in progress
  ON_HOLD: "on_hold",       // Call on hold
  COMPLETED: "completed",   // Call ended normally
  FAILED: "failed",         // Call failed to connect
  MISSED: "missed",         // Call not answered
  BUSY: "busy",             // Recipient busy
} as const;

export type CallStatus = typeof CALL_STATUS[keyof typeof CALL_STATUS];

// Bridged Calls - Self-hosted proprietary call system (NO third-party telecom)
// NOTE: Field names (callSid, outboundCallSid) are kept for backward compatibility
// but now represent internal session IDs, NOT third-party service identifiers.
// New code should use the type aliases: signalingSessionId, mediaSessionId
export const bridgedCalls = pgTable("bridged_calls", {
  id: serial("id").primaryKey(),
  callSid: text("call_sid").unique(),                       // Signaling session ID (internal)
  outboundCallSid: text("outbound_call_sid"),               // Media session ID (internal)
  callerNumber: text("caller_number").notNull(),            // User A phone/identifier
  callerUserId: integer("caller_user_id"),                  // Optional linked user
  receiverNumber: text("receiver_number").notNull(),        // User B phone/identifier
  receiverUserId: integer("receiver_user_id"),              // Optional linked user
  gatewayNumber: text("gateway_number").notNull(),          // Self-hosted gateway identifier
  providerId: text("provider_id").default("primary"),       // msg91, twilio, backup
  status: text("status").notNull().default("pending"),      // CallStatus
  callerLanguage: text("caller_language").default("auto"),  // Detected/set language
  receiverLanguage: text("receiver_language").default("auto"),
  translationEnabled: boolean("translation_enabled").default(true),
  emotionPreservation: boolean("emotion_preservation").default(true),
  startedAt: timestamp("started_at"),
  connectedAt: timestamp("connected_at"),                   // When both parties connected
  endedAt: timestamp("ended_at"),
  duration: integer("duration"),                            // Call duration in seconds
  metadata: jsonb("metadata").default({}),                  // Quality metrics, signaling info
  createdAt: timestamp("created_at").defaultNow(),
});

// Call Translations (stores translation segments for a call)
export const callTranslations = pgTable("call_translations", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull(),
  direction: text("direction").notNull(),                   // "caller_to_receiver" or "receiver_to_caller"
  originalText: text("original_text").notNull(),
  originalLanguage: text("original_language").notNull(),
  translatedText: text("translated_text").notNull(),
  translatedLanguage: text("translated_language").notNull(),
  emotionDetected: text("emotion_detected"),                // happy, calm, stressed, etc.
  emotionIntensity: integer("emotion_intensity"),           // 0-100
  latencyMs: integer("latency_ms"),                         // Translation latency
  timestamp: timestamp("timestamp").defaultNow(),
});

// Call Participants (for potential multi-party calls)
export const callParticipants = pgTable("call_participants", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  userId: integer("user_id"),                               // Optional linked user
  role: text("role").notNull().default("participant"),      // caller, receiver, participant
  language: text("language").default("auto"),
  joinedAt: timestamp("joined_at").defaultNow(),
  leftAt: timestamp("left_at"),
  isMuted: boolean("is_muted").default(false),
  metadata: jsonb("metadata").default({}),
});

// Call Consent (privacy and compliance)
export const callConsents = pgTable("call_consents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  translationProcessing: boolean("translation_processing").default(true),
  audioRecording: boolean("audio_recording").default(false),
  emotionAnalysis: boolean("emotion_analysis").default(true),
  dataRetention: text("data_retention").default("none"),    // none, session, 7days, 30days
  consentVersion: text("consent_version").notNull(),
  consentTimestamp: timestamp("consent_timestamp").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

// IP Whitelist (for enterprise security)
export const ipWhitelists = pgTable("ip_whitelists", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  ipAddress: text("ip_address").notNull(),        // Single IP or CIDR range (e.g., 192.168.1.0/24)
  description: text("description"),                // Human-readable description
  isActive: boolean("is_active").default(true),
  createdBy: integer("created_by"),               // User who added this IP
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("ip_whitelist_org_idx").on(table.organizationId),
  index("ip_whitelist_ip_idx").on(table.ipAddress),
]);

export const insertIpWhitelistSchema = createInsertSchema(ipWhitelists).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIpWhitelist = z.infer<typeof insertIpWhitelistSchema>;
export type IpWhitelist = typeof ipWhitelists.$inferSelect;

// Registered Devices (for mobile app push notifications and call routing)
export const registeredDevices = pgTable("registered_devices", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  deviceId: text("device_id").notNull(),                  // Unique device identifier
  platform: text("platform").notNull(),                   // android, ios, web
  pushToken: text("push_token"),                          // FCM/APNs token for push notifications
  voipToken: text("voip_token"),                          // iOS VoIP push token (for CallKit)
  deviceName: text("device_name"),                        // Human-readable device name
  appVersion: text("app_version"),                        // App version for compatibility
  osVersion: text("os_version"),                          // OS version
  capabilities: jsonb("capabilities").default({}),        // Device capabilities (SIM, WebRTC, etc.)
  isActive: boolean("is_active").default(true),           // Whether device is active
  lastSeenAt: timestamp("last_seen_at").defaultNow(),     // Last activity timestamp
  registeredAt: timestamp("registered_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  userDeviceIdx: uniqueIndex("user_device_idx").on(table.userId, table.deviceId),
  platformIdx: index("device_platform_idx").on(table.platform),
}));

// Call Telemetry (for monitoring and debugging call quality)
export const callTelemetry = pgTable("call_telemetry", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull(),
  userId: integer("user_id"),                             // Optional: which user's perspective
  deviceId: text("device_id"),                            // Which device reported this
  timestamp: timestamp("timestamp").defaultNow(),
  // Audio quality metrics
  audioJitter: integer("audio_jitter"),                   // Jitter in ms
  audioPacketLoss: integer("audio_packet_loss"),          // Packet loss percentage * 100
  audioRtt: integer("audio_rtt"),                         // Round-trip time in ms
  audioCodec: text("audio_codec"),                        // Codec used (opus, etc.)
  // Translation metrics
  translationLatency: integer("translation_latency"),     // Translation latency in ms
  speechToTextLatency: integer("stt_latency"),            // STT latency in ms
  textToSpeechLatency: integer("tts_latency"),            // TTS latency in ms
  // Connection metrics
  connectionType: text("connection_type"),                // wifi, cellular, ethernet
  signalStrength: integer("signal_strength"),             // Signal quality 0-100
  // Error tracking
  errorType: text("error_type"),                          // Type of error if any
  errorMessage: text("error_message"),                    // Error details
  // Metadata
  metadata: jsonb("metadata").default({}),                // Additional metrics
}, (table) => ({
  callIdIdx: index("telemetry_call_idx").on(table.callId),
  userIdIdx: index("telemetry_user_idx").on(table.userId),
  timestampIdx: index("telemetry_timestamp_idx").on(table.timestamp),
}));

// === RELATIONS ===
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  users: many(users),
  voiceProfiles: many(voiceProfiles),
  conversations: many(conversations),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  voiceProfiles: many(voiceProfiles),
  conversations: many(conversations),
  memberships: many(orgMembers),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [orgMembers.userId],
    references: [users.id],
  }),
}));

export const voiceProfilesRelations = relations(voiceProfiles, ({ one, many }) => ({
  user: one(users, {
    fields: [voiceProfiles.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [voiceProfiles.organizationId],
    references: [organizations.id],
  }),
  samples: many(voiceSamples),
}));

export const voiceSamplesRelations = relations(voiceSamples, ({ one }) => ({
  user: one(users, {
    fields: [voiceSamples.userId],
    references: [users.id],
  }),
  voiceProfile: one(voiceProfiles, {
    fields: [voiceSamples.voiceProfileId],
    references: [voiceProfiles.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, {
    fields: [conversations.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [conversations.organizationId],
    references: [organizations.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

// Voice Memos Relations
export const voiceMemosRelations = relations(voiceMemos, ({ one }) => ({
  sender: one(users, {
    fields: [voiceMemos.senderId],
    references: [users.id],
  }),
  recipient: one(users, {
    fields: [voiceMemos.recipientId],
    references: [users.id],
  }),
  groupChat: one(groupChats, {
    fields: [voiceMemos.groupChatId],
    references: [groupChats.id],
  }),
  voiceProfile: one(voiceProfiles, {
    fields: [voiceMemos.voiceProfileId],
    references: [voiceProfiles.id],
  }),
}));

// Group Chats Relations
export const groupChatsRelations = relations(groupChats, ({ one, many }) => ({
  creator: one(users, {
    fields: [groupChats.createdById],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [groupChats.organizationId],
    references: [organizations.id],
  }),
  members: many(groupChatMembers),
  messages: many(groupChatMessages),
  voiceMemos: many(voiceMemos),
}));

export const groupChatMembersRelations = relations(groupChatMembers, ({ one }) => ({
  groupChat: one(groupChats, {
    fields: [groupChatMembers.groupChatId],
    references: [groupChats.id],
  }),
  user: one(users, {
    fields: [groupChatMembers.userId],
    references: [users.id],
  }),
}));

export const groupChatMessagesRelations = relations(groupChatMessages, ({ one }) => ({
  groupChat: one(groupChats, {
    fields: [groupChatMessages.groupChatId],
    references: [groupChats.id],
  }),
  sender: one(users, {
    fields: [groupChatMessages.senderId],
    references: [users.id],
  }),
  replyTo: one(groupChatMessages, {
    fields: [groupChatMessages.replyToId],
    references: [groupChatMessages.id],
  }),
}));

export const bridgedCallsRelations = relations(bridgedCalls, ({ one, many }) => ({
  callerUser: one(users, {
    fields: [bridgedCalls.callerUserId],
    references: [users.id],
  }),
  receiverUser: one(users, {
    fields: [bridgedCalls.receiverUserId],
    references: [users.id],
  }),
  translations: many(callTranslations),
  participants: many(callParticipants),
}));

export const callTranslationsRelations = relations(callTranslations, ({ one }) => ({
  call: one(bridgedCalls, {
    fields: [callTranslations.callId],
    references: [bridgedCalls.id],
  }),
}));

export const callParticipantsRelations = relations(callParticipants, ({ one }) => ({
  call: one(bridgedCalls, {
    fields: [callParticipants.callId],
    references: [bridgedCalls.id],
  }),
  user: one(users, {
    fields: [callParticipants.userId],
    references: [users.id],
  }),
}));

export const callConsentsRelations = relations(callConsents, ({ one }) => ({
  user: one(users, {
    fields: [callConsents.userId],
    references: [users.id],
  }),
}));

export const registeredDevicesRelations = relations(registeredDevices, ({ one }) => ({
  user: one(users, {
    fields: [registeredDevices.userId],
    references: [users.id],
  }),
}));

export const callTelemetryRelations = relations(callTelemetry, ({ one }) => ({
  call: one(bridgedCalls, {
    fields: [callTelemetry.callId],
    references: [bridgedCalls.id],
  }),
  user: one(users, {
    fields: [callTelemetry.userId],
    references: [users.id],
  }),
}));

// === MEETING ROOM RELATIONS ===
export const meetingRoomsRelations = relations(meetingRooms, ({ one, many }) => ({
  host: one(users, {
    fields: [meetingRooms.hostUserId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [meetingRooms.organizationId],
    references: [organizations.id],
  }),
  participants: many(meetingParticipants),
}));

export const meetingParticipantsRelations = relations(meetingParticipants, ({ one }) => ({
  meeting: one(meetingRooms, {
    fields: [meetingParticipants.meetingId],
    references: [meetingRooms.id],
  }),
  user: one(users, {
    fields: [meetingParticipants.userId],
    references: [users.id],
  }),
}));

// === DYNAMIC LOCATION SYSTEM ===
// Hierarchical location data: Country → State → District → City → Village → Pincode
// All data is database-driven, no hardcoded values

export const countries = pgTable("countries", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // ISO 3166-1 alpha-2 (IN, US, GB)
  name: text("name").notNull(),
  dialCode: text("dial_code"), // +91, +1, etc.
  currency: text("currency"), // INR, USD, etc.
  isEnabled: boolean("is_enabled").default(true),
  flagEmoji: text("flag_emoji"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("countries_enabled_idx").on(table.isEnabled),
]);

export const states = pgTable("states", {
  id: serial("id").primaryKey(),
  countryId: integer("country_id").notNull().references(() => countries.id, { onDelete: "cascade" }),
  code: text("code").notNull(), // State code (TS, AP, KA)
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("states_country_idx").on(table.countryId),
  uniqueIndex("states_country_code_unique_idx").on(table.countryId, table.code),
]);

export const districts = pgTable("districts", {
  id: serial("id").primaryKey(),
  stateId: integer("state_id").notNull().references(() => states.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("districts_state_idx").on(table.stateId),
]);

export const cities = pgTable("cities", {
  id: serial("id").primaryKey(),
  districtId: integer("district_id").notNull().references(() => districts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isTier1: boolean("is_tier1").default(false), // Metro city
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("cities_district_idx").on(table.districtId),
]);

export const villages = pgTable("villages", {
  id: serial("id").primaryKey(),
  cityId: integer("city_id").notNull().references(() => cities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("villages_city_idx").on(table.cityId),
]);

export const pincodes = pgTable("pincodes", {
  id: serial("id").primaryKey(),
  cityId: integer("city_id").references(() => cities.id, { onDelete: "cascade" }),
  villageId: integer("village_id").references(() => villages.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  areaName: text("area_name"),
  isEnabled: boolean("is_enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("pincodes_city_idx").on(table.cityId),
  index("pincodes_village_idx").on(table.villageId),
  index("pincodes_code_idx").on(table.code),
]);

// === AUDIT LOGGING ===
// Track admin changes and critical actions (Super Admin view only)
// Do NOT log sensitive data (passwords, OTPs, call content)

export const AUDIT_ACTION = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  APPROVE: "approve",
  REJECT: "reject",
  SUSPEND: "suspend",
  LOGIN: "login",
  LOGOUT: "logout",
  SETTINGS_CHANGE: "settings_change",
  CREDIT_ADJUSTMENT: "credit_adjustment",
  ROLE_CHANGE: "role_change",
} as const;

export type AuditAction = typeof AUDIT_ACTION[keyof typeof AUDIT_ACTION];

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // Who performed the action
  organizationId: integer("organization_id").references(() => organizations.id),
  action: text("action").notNull(), // AuditAction
  entityType: text("entity_type").notNull(), // user, organization, setting, etc.
  entityId: integer("entity_id"), // ID of affected entity
  oldValue: jsonb("old_value"), // Previous state (sanitized)
  newValue: jsonb("new_value"), // New state (sanitized)
  metadata: jsonb("metadata").default({}), // Additional context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("audit_logs_user_idx").on(table.userId),
  index("audit_logs_org_idx").on(table.organizationId),
  index("audit_logs_action_idx").on(table.action),
  index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  index("audit_logs_created_idx").on(table.createdAt),
]);

// === SUPPORTED LANGUAGES ===
// Database-driven language configuration

export const supportedLanguages = pgTable("supported_languages", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // en, te, ta, kn, hi
  name: text("name").notNull(), // English, Telugu, Tamil, Kannada, Hindi
  nativeName: text("native_name").notNull(), // English, తెలుగు, தமிழ், ಕನ್ನಡ, हिंदी
  isEnabled: boolean("is_enabled").default(true),
  isDefault: boolean("is_default").default(false),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// === TENANT DATA ISOLATION & DEDICATED DATABASES ===
export const tenantDatabases = pgTable("tenant_databases", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  mode: text("mode").notNull().default("shared"), // shared, dedicated
  status: text("status").notNull().default("active"), // active, provisioning, suspended
  databaseUrl: text("database_url"),
  readReplicaUrl: text("read_replica_url"),
  schemaName: text("schema_name"),
  region: text("region").default("ap-south-1"),
  poolMax: integer("pool_max").default(10),
  enforceIsolationGuards: boolean("enforce_isolation_guards").default(true),
  metadata: jsonb("metadata").default({}),
  lastHealthStatus: text("last_health_status").default("unknown"),
  lastHealthCheckedAt: timestamp("last_health_checked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("tenant_databases_org_unique_idx").on(table.organizationId),
  index("tenant_databases_status_idx").on(table.status),
]);

export const tenantSecurityPolicies = pgTable("tenant_security_policies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  requireTenantHeader: boolean("require_tenant_header").default(true),
  enforceSessionTenantBinding: boolean("enforce_session_tenant_binding").default(true),
  allowMultipleSessions: boolean("allow_multiple_sessions").default(true),
  sessionTimeoutMinutes: integer("session_timeout_minutes").default(1440),
  requireMfaForAdmins: boolean("require_mfa_for_admins").default(false),
  allowedEmailDomains: jsonb("allowed_email_domains").default([]),
  allowedIpRanges: jsonb("allowed_ip_ranges").default([]),
  ssoEnabled: boolean("sso_enabled").default(false),
  ssoProvider: text("sso_provider"),
  ssoMetadata: jsonb("sso_metadata").default({}),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("tenant_security_policies_org_unique_idx").on(table.organizationId),
  index("tenant_security_policies_mfa_idx").on(table.requireMfaForAdmins),
]);

// === PAYMENT CONFIGURATIONS ===
// Store payment gateway configurations (keys are encrypted/stored securely)

export const paymentGateways = pgTable("payment_gateways", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // razorpay, etc.
  displayName: text("display_name").notNull(),
  isEnabled: boolean("is_enabled").default(false),
  isTestMode: boolean("is_test_mode").default(true),
  configJson: jsonb("config_json").default({}), // Non-sensitive config
  // Sensitive keys stored separately in env/secrets, referenced by key name
  keyIdEnvVar: text("key_id_env_var"), // ENV variable name for key ID
  keySecretEnvVar: text("key_secret_env_var"), // ENV variable name for secret
  webhookSecret: text("webhook_secret"),
  supportedCurrencies: jsonb("supported_currencies").default(["INR"]),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// === BILLING PLANS ===
// Dynamic pricing plans for B2B and B2C

export const PLAN_TYPE = {
  B2B: "b2b",
  B2C: "b2c",
} as const;

export type PlanType = typeof PLAN_TYPE[keyof typeof PLAN_TYPE];

export const BILLING_MODEL = {
  PREPAID: "prepaid",
  POSTPAID: "postpaid",
  HYBRID: "hybrid",
} as const;

export type BillingModel = typeof BILLING_MODEL[keyof typeof BILLING_MODEL];

export const PLAN_DURATION = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  YEARLY: "yearly",
  CUSTOM: "custom",
} as const;

export type PlanDuration = typeof PLAN_DURATION[keyof typeof PLAN_DURATION];

export const billingPlans = pgTable("billing_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  planCode: text("plan_code"),
  description: text("description"),
  planType: text("plan_type").notNull(), // b2b, b2c
  billingModel: text("billing_model").notNull().default("prepaid"), // prepaid, postpaid
  duration: text("duration").notNull(), // daily, weekly, monthly, quarterly, yearly
  durationDays: integer("duration_days").notNull(), // Exact days for validity
  includedMinutes: integer("included_minutes").notNull(), // Voice minutes included
  priceInPaise: integer("price_in_paise").notNull(), // Price in smallest unit (paise)
  currency: text("currency").default("INR"),
  gstPercentage: integer("gst_percentage").default(18), // GST % (e.g., 18)
  features: jsonb("features").default({}), // { translation: true, emotion: true, etc. }
  perSecondBilling: boolean("per_second_billing").default(true),
  rates: jsonb("rates").default({
    voicePerMinutePaise: 0,
    videoPerMinutePaise: 0,
    translationPerMinutePaise: 0,
    recordingPerMinutePaise: 0,
  }),
  freeUnits: jsonb("free_units").default({
    minutes: 0,
    credits: 0,
  }),
  limits: jsonb("limits").default({
    maxConcurrentCalls: 0,
    dailyUsageLimit: 0,
  }),
  featuresEnabled: jsonb("features_enabled").default([]),
  isDefault: boolean("is_default").default(false),
  isEnabled: boolean("is_enabled").default(true),
  isFeatured: boolean("is_featured").default(false), // Show as recommended
  displayOrder: integer("display_order").default(0),
  effectiveFrom: timestamp("effective_from"),
  effectiveUntil: timestamp("effective_until"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("billing_plans_type_idx").on(table.planType),
  index("billing_plans_enabled_idx").on(table.isEnabled),
  uniqueIndex("billing_plans_code_unique_idx").on(table.planCode).where(sql`plan_code IS NOT NULL`),
]);

// === SUBSCRIPTIONS ===
// User/Org subscriptions to plans

export const SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  SUSPENDED: "suspended",
  PENDING_PAYMENT: "pending_payment",
} as const;

export type SubscriptionStatus = typeof SUBSCRIPTION_STATUS[keyof typeof SUBSCRIPTION_STATUS];

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id), // For B2C
  organizationId: integer("organization_id").references(() => organizations.id), // For B2B
  planId: integer("plan_id").notNull().references(() => billingPlans.id),
  status: text("status").notNull().default("active"),
  billingModel: text("billing_model").notNull().default("prepaid"),
  // Time-based tracking
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  // Usage tracking
  minutesUsed: integer("minutes_used").default(0),
  minutesRemaining: integer("minutes_remaining").default(0),
  // For postpaid
  creditLimit: integer("credit_limit"), // Max usage before block
  currentUsage: integer("current_usage").default(0), // Current postpaid usage in paise
  // Renewal
  autoRenew: boolean("auto_renew").default(false),
  renewalReminder: boolean("renewal_reminder").default(true),
  lastRenewalAt: timestamp("last_renewal_at"),
  // Payment tracking
  gatewaySubscriptionId: text("gateway_subscription_id"), // Razorpay/Stripe ID
  lastPaymentId: integer("last_payment_id"),
  nextBillingDate: timestamp("next_billing_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("subscriptions_user_idx").on(table.userId),
  index("subscriptions_org_idx").on(table.organizationId),
  index("subscriptions_status_idx").on(table.status),
  index("subscriptions_plan_idx").on(table.planId),
]);

// === USAGE RECORDS ===
// Track usage per call/minute

export const usageRecords = pgTable("usage_records", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  userId: integer("user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  callId: integer("call_id"), // Reference to bridgedCalls
  externalCallId: text("external_call_id"),
  meetingId: integer("meeting_id"), // Reference to meetingRooms
  // Usage details
  usageType: text("usage_type").notNull(), // voice_call, meeting, translation, etc.
  callType: text("call_type"),
  durationSeconds: integer("duration_seconds").notNull(),
  minutesConsumed: integer("minutes_consumed").notNull(), // Rounded up
  // Features used
  translationUsed: boolean("translation_used").default(false),
  emotionAnalysisUsed: boolean("emotion_analysis_used").default(false),
  // Cost calculation
  baseCostPaise: integer("base_cost_paise").default(0),
  featureCostPaise: integer("feature_cost_paise").default(0),
  totalCostPaise: integer("total_cost_paise").default(0),
  costBreakdown: jsonb("cost_breakdown").default({}),
  billingSnapshot: jsonb("billing_snapshot").default({}),
  // Billing
  billed: boolean("billed").default(false),
  invoiceId: integer("invoice_id"),
  usageDate: timestamp("usage_date").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("usage_records_subscription_idx").on(table.subscriptionId),
  index("usage_records_user_idx").on(table.userId),
  index("usage_records_org_idx").on(table.organizationId),
  index("usage_records_date_idx").on(table.usageDate),
  index("usage_records_billed_idx").on(table.billed),
]);

// === INVOICES ===
// GST-compliant invoices

export const INVOICE_STATUS = {
  DRAFT: "draft",
  PENDING: "pending",
  PAID: "paid",
  OVERDUE: "overdue",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
} as const;

export type InvoiceStatus = typeof INVOICE_STATUS[keyof typeof INVOICE_STATUS];

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  userId: integer("user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  // Invoice period
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  // Amounts (all in paise)
  subtotalPaise: integer("subtotal_paise").notNull(),
  discountPaise: integer("discount_paise").default(0),
  taxableAmountPaise: integer("taxable_amount_paise").notNull(),
  cgstPaise: integer("cgst_paise").default(0),
  sgstPaise: integer("sgst_paise").default(0),
  igstPaise: integer("igst_paise").default(0),
  totalTaxPaise: integer("total_tax_paise").notNull(),
  totalAmountPaise: integer("total_amount_paise").notNull(),
  currency: text("currency").default("INR"),
  // GST details
  gstPercentage: integer("gst_percentage").default(18),
  placeOfSupply: text("place_of_supply"),
  isInterState: boolean("is_inter_state").default(false),
  // Customer details (snapshot at invoice time)
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  customerGstin: text("customer_gstin"),
  customerAddress: text("customer_address"),
  // Seller details (snapshot)
  sellerName: text("seller_name").notNull(),
  sellerGstin: text("seller_gstin"),
  sellerAddress: text("seller_address"),
  // Status and dates
  status: text("status").notNull().default("pending"),
  dueDate: timestamp("due_date"),
  paidAt: timestamp("paid_at"),
  paymentId: integer("payment_id"),
  // PDF
  pdfUrl: text("pdf_url"),
  // Notes
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("invoices_user_idx").on(table.userId),
  index("invoices_org_idx").on(table.organizationId),
  index("invoices_status_idx").on(table.status),
  index("invoices_number_idx").on(table.invoiceNumber),
]);

// === INVOICE LINE ITEMS ===
export const invoiceLineItems = pgTable("invoice_line_items", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPricePaise: integer("unit_price_paise").notNull(),
  totalPaise: integer("total_paise").notNull(),
  usageRecordId: integer("usage_record_id"),
  planId: integer("plan_id"),
  hsnCode: text("hsn_code"), // HSN/SAC code for GST
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("invoice_line_items_invoice_idx").on(table.invoiceId),
]);

// === GST SETTINGS ===
// Platform and organization GST configuration

export const gstSettings = pgTable("gst_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = platform settings
  gstin: text("gstin"), // GST Identification Number
  panNumber: text("pan_number"),
  legalName: text("legal_name").notNull(),
  tradeName: text("trade_name"),
  registeredAddress: text("registered_address"),
  stateCode: text("state_code"), // For CGST/SGST calculation
  placeOfSupply: text("place_of_supply"),
  invoicePrefix: text("invoice_prefix").default("INV"),
  invoiceCounter: integer("invoice_counter").default(1),
  hsnCode: text("hsn_code").default("998314"), // Telecom services
  defaultGstRate: integer("default_gst_rate").default(18),
  isVerified: boolean("is_verified").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("gst_settings_org_idx").on(table.organizationId),
]);

// === BILLING SETTINGS ===
// Organization-level billing preferences

export const billingSettings = pgTable("billing_settings", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id).unique(),
  // Billing model preferences
  allowedBillingModels: jsonb("allowed_billing_models").default(["prepaid"]), // ["prepaid", "postpaid"]
  currentBillingModel: text("current_billing_model").default("prepaid"),
  // Postpaid settings
  postpaidEnabled: boolean("postpaid_enabled").default(false),
  postpaidApproved: boolean("postpaid_approved").default(false),
  postpaidApprovedBy: integer("postpaid_approved_by"),
  postpaidApprovedAt: timestamp("postpaid_approved_at"),
  creditLimitPaise: integer("credit_limit_paise").default(0),
  currentOutstandingPaise: integer("current_outstanding_paise").default(0),
  // Billing cycle
  billingCycleDay: integer("billing_cycle_day").default(1), // Day of month for invoicing
  paymentTermsDays: integer("payment_terms_days").default(15), // Days to pay invoice
  // Low credit warnings
  lowCreditThreshold: integer("low_credit_threshold").default(100), // Minutes
  lowCreditAlertSent: boolean("low_credit_alert_sent").default(false),
  // Auto-pay
  autoPayEnabled: boolean("auto_pay_enabled").default(false),
  autoPayPaymentMethodId: integer("auto_pay_payment_method_id"),
  // Block settings
  blockOnZeroCredits: boolean("block_on_zero_credits").default(true),
  blockOnCreditLimitExceeded: boolean("block_on_credit_limit_exceeded").default(true),
  isBlocked: boolean("is_blocked").default(false),
  blockedReason: text("blocked_reason"),
  blockedAt: timestamp("blocked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("billing_settings_org_idx").on(table.organizationId),
]);

// === STRICT BILLING ACCOUNTS ===
// Tenant-level wallet, credit, plan assignment, and guard rails

export const billingAccounts = pgTable("billing_accounts", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id).unique(),
  assignedPlanId: integer("assigned_plan_id").references(() => billingPlans.id),
  billingType: text("billing_type").notNull().default("prepaid"),
  customPricingOverride: jsonb("custom_pricing_override").default({}),
  walletBalancePaise: integer("wallet_balance_paise").notNull().default(0),
  lockedBalancePaise: integer("locked_balance_paise").notNull().default(0),
  includedSecondsRemaining: integer("included_seconds_remaining").notNull().default(0),
  includedCreditsRemaining: integer("included_credits_remaining").notNull().default(0),
  creditLimitPaise: integer("credit_limit_paise").notNull().default(0),
  outstandingPostpaidPaise: integer("outstanding_postpaid_paise").notNull().default(0),
  maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(0),
  dailyUsageLimitSeconds: integer("daily_usage_limit_seconds").notNull().default(0),
  currentDayUsageSeconds: integer("current_day_usage_seconds").notNull().default(0),
  usageDayAnchor: timestamp("usage_day_anchor").defaultNow(),
  currency: text("currency").default("INR"),
  status: text("status").notNull().default("active"),
  isBlocked: boolean("is_blocked").default(false),
  blockedReason: text("blocked_reason"),
  blockedAt: timestamp("blocked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("billing_accounts_org_idx").on(table.organizationId),
  index("billing_accounts_status_idx").on(table.status),
]);

// === BILLING RESERVATIONS ===
// Funds or credit reserved against an active call session

export const billingReservations = pgTable("billing_reservations", {
  id: serial("id").primaryKey(),
  reservationId: text("reservation_id").notNull().unique(),
  billingAccountId: integer("billing_account_id").references(() => billingAccounts.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  userId: integer("user_id").references(() => users.id),
  callId: text("call_id").notNull(),
  callType: text("call_type").notNull(),
  translationEnabled: boolean("translation_enabled").default(false),
  recordingEnabled: boolean("recording_enabled").default(false),
  reservedAmountPaise: integer("reserved_amount_paise").notNull().default(0),
  consumedAmountPaise: integer("consumed_amount_paise").notNull().default(0),
  releasedAmountPaise: integer("released_amount_paise").notNull().default(0),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  finalizedAt: timestamp("finalized_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("billing_reservations_reservation_idx").on(table.reservationId),
  index("billing_reservations_call_idx").on(table.callId),
  index("billing_reservations_org_idx").on(table.organizationId),
  index("billing_reservations_status_idx").on(table.status),
]);

// === BILLING LEDGER ENTRIES ===
// Immutable money movement trail for audits and reconciliation

export const billingLedgerEntries = pgTable("billing_ledger_entries", {
  id: serial("id").primaryKey(),
  billingAccountId: integer("billing_account_id").references(() => billingAccounts.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  reservationId: text("reservation_id"),
  callId: text("call_id"),
  userId: integer("user_id").references(() => users.id),
  entryType: text("entry_type").notNull(),
  direction: text("direction").notNull(),
  amountPaise: integer("amount_paise").notNull(),
  balanceAfterPaise: integer("balance_after_paise"),
  metadata: jsonb("metadata").default({}),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("billing_ledger_entries_account_idx").on(table.billingAccountId),
  index("billing_ledger_entries_org_idx").on(table.organizationId),
  index("billing_ledger_entries_call_idx").on(table.callId),
  index("billing_ledger_entries_type_idx").on(table.entryType),
]);

// === CALL BILLING RECORDS ===
// Exact per-call money breakdown used for audit, analytics, and invoice generation

export const callBillingRecords = pgTable("call_billing_records", {
  id: serial("id").primaryKey(),
  callId: text("call_id").notNull().unique(),
  organizationId: integer("organization_id").references(() => organizations.id),
  billingAccountId: integer("billing_account_id").references(() => billingAccounts.id),
  subscriptionId: integer("subscription_id").references(() => subscriptions.id),
  reservationId: text("reservation_id"),
  userId: integer("user_id").references(() => users.id),
  callType: text("call_type").notNull(),
  joinMethod: text("join_method"),
  translationUsed: boolean("translation_used").default(false),
  recordingUsed: boolean("recording_used").default(false),
  voiceSeconds: integer("voice_seconds").notNull().default(0),
  videoSeconds: integer("video_seconds").notNull().default(0),
  translationSeconds: integer("translation_seconds").notNull().default(0),
  recordingSeconds: integer("recording_seconds").notNull().default(0),
  includedFreeSecondsUsed: integer("included_free_seconds_used").notNull().default(0),
  includedFreeCreditsUsed: integer("included_free_credits_used").notNull().default(0),
  prepaidDebitPaise: integer("prepaid_debit_paise").notNull().default(0),
  postpaidAccrualPaise: integer("postpaid_accrual_paise").notNull().default(0),
  totalCostPaise: integer("total_cost_paise").notNull().default(0),
  effectivePricing: jsonb("effective_pricing").default({}),
  costBreakdown: jsonb("cost_breakdown").default({}),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at").defaultNow(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("call_billing_records_org_idx").on(table.organizationId),
  index("call_billing_records_user_idx").on(table.userId),
  index("call_billing_records_status_idx").on(table.status),
  index("call_billing_records_started_idx").on(table.startedAt),
]);

// === PAYMENT TRANSACTIONS ===
// Track all payment transactions

export const PAYMENT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
  CANCELLED: "cancelled",
} as const;

export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS];

export const paymentTransactions = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  gatewayId: integer("gateway_id").references(() => paymentGateways.id),
  gatewayOrderId: text("gateway_order_id"), // Razorpay order_id
  gatewayPaymentId: text("gateway_payment_id"), // Razorpay payment_id
  gatewaySignature: text("gateway_signature"), // For verification
  amount: integer("amount").notNull(), // Amount in smallest unit (paise)
  currency: text("currency").default("INR"),
  creditsToAdd: integer("credits_to_add"), // Credits to add on success
  status: text("status").default("pending"),
  failureReason: text("failure_reason"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("payment_transactions_user_idx").on(table.userId),
  index("payment_transactions_org_idx").on(table.organizationId),
  index("payment_transactions_status_idx").on(table.status),
  index("payment_transactions_gateway_order_idx").on(table.gatewayOrderId),
]);

// === LEGAL CONTENT ===
// Store legal page content (Privacy Policy, Terms, etc.)

export const legalContent = pgTable("legal_content", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(), // privacy_policy, terms_conditions, etc.
  languageCode: text("language_code").notNull().default("en"),
  title: text("title").notNull(),
  content: text("content").notNull(), // HTML or Markdown content
  version: integer("version").default(1),
  isActive: boolean("is_active").default(true),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("legal_content_key_lang_unique_idx").on(table.key, table.languageCode),
]);

// === SUPPORT CONTACTS ===
// Store support contact information

export const supportContacts = pgTable("support_contacts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // email, phone, whatsapp, address
  label: text("label").notNull(), // "General Support", "Sales", etc.
  value: text("value").notNull(), // The actual contact info
  languageCode: text("language_code").default("en"),
  isEnabled: boolean("is_enabled").default(true),
  displayOrder: integer("display_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

// === PRODUCTION READINESS TABLES ===

// App Versions - For forced updates and version management
export const APP_VERSION_STATUS = {
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  DISCONTINUED: "discontinued",
} as const;

export type AppVersionStatus = typeof APP_VERSION_STATUS[keyof typeof APP_VERSION_STATUS];

export const appVersions = pgTable("app_versions", {
  id: serial("id").primaryKey(),
  platform: text("platform").notNull(), // ios, android, web
  version: text("version").notNull(), // semver: 1.0.0
  buildNumber: integer("build_number"),
  minSupportedVersion: text("min_supported_version"), // Force update if below this
  status: text("status").default("active"),
  releaseNotes: text("release_notes"),
  releaseDate: timestamp("release_date"),
  forceUpdate: boolean("force_update").default(false),
  downloadUrl: text("download_url"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("app_versions_platform_idx").on(table.platform),
  uniqueIndex("app_versions_platform_version_unique_idx").on(table.platform, table.version),
]);

// Rate Limit Configuration - Per-endpoint rate limiting rules
export const rateLimitRules = pgTable("rate_limit_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  endpoint: text("endpoint").notNull(), // /api/auth/*, /api/call/*, etc.
  method: text("method").default("*"), // GET, POST, *, etc.
  windowMs: integer("window_ms").notNull().default(60000), // 1 minute default
  maxRequests: integer("max_requests").notNull().default(100),
  keyType: text("key_type").default("ip"), // ip, user, org, global
  isEnabled: boolean("is_enabled").default(true),
  bypassRoles: jsonb("bypass_roles").default([]), // Roles that bypass this limit
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("rate_limit_rules_endpoint_idx").on(table.endpoint),
]);

// Rate Limit Tracking - In-memory preferred, DB as fallback for persistence
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").references(() => rateLimitRules.id, { onDelete: "cascade" }),
  key: text("key").notNull(), // IP address, user ID, etc.
  requestCount: integer("request_count").default(0),
  windowStart: timestamp("window_start").defaultNow(),
  blockedUntil: timestamp("blocked_until"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("rate_limit_buckets_key_idx").on(table.key),
  index("rate_limit_buckets_rule_idx").on(table.ruleId),
]);

// Abuse Reports - User-submitted reports of abusive content/behavior
export const REPORT_STATUS = {
  PENDING: "pending",
  REVIEWING: "reviewing",
  RESOLVED: "resolved",
  DISMISSED: "dismissed",
} as const;

export type ReportStatus = typeof REPORT_STATUS[keyof typeof REPORT_STATUS];

export const abuseReports = pgTable("abuse_reports", {
  id: serial("id").primaryKey(),
  reporterUserId: integer("reporter_user_id").references(() => users.id),
  reportedUserId: integer("reported_user_id").references(() => users.id),
  reportedEntityType: text("reported_entity_type"), // user, message, call, meeting
  reportedEntityId: integer("reported_entity_id"),
  category: text("category").notNull(), // harassment, spam, fraud, inappropriate, other
  description: text("description"),
  evidence: jsonb("evidence").default([]), // Screenshots, logs (sanitized)
  status: text("status").default("pending"),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  reviewNotes: text("review_notes"),
  resolution: text("resolution"),
  createdAt: timestamp("created_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("abuse_reports_status_idx").on(table.status),
  index("abuse_reports_reporter_idx").on(table.reporterUserId),
  index("abuse_reports_reported_idx").on(table.reportedUserId),
]);

// User Suspensions - Account suspension tracking
export const SUSPENSION_STATUS = {
  ACTIVE: "active",
  LIFTED: "lifted",
  EXPIRED: "expired",
} as const;

export type SuspensionStatus = typeof SUSPENSION_STATUS[keyof typeof SUSPENSION_STATUS];

export const userSuspensions = pgTable("user_suspensions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  category: text("category"), // abuse, fraud, policy_violation, etc.
  suspendedBy: integer("suspended_by").references(() => users.id),
  status: text("status").default("active"),
  startsAt: timestamp("starts_at").defaultNow(),
  expiresAt: timestamp("expires_at"), // null = permanent
  liftedAt: timestamp("lifted_at"),
  liftedBy: integer("lifted_by").references(() => users.id),
  notes: text("notes"),
  relatedReportId: integer("related_report_id").references(() => abuseReports.id),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("user_suspensions_user_idx").on(table.userId),
  index("user_suspensions_status_idx").on(table.status),
]);

// User Consents - Explicit consent tracking for GDPR/privacy
export const CONSENT_TYPE = {
  VOICE_RECORDING: "voice_recording",
  VIDEO_RECORDING: "video_recording",
  CALL_TRANSLATION: "call_translation",
  EMOTION_ANALYSIS: "emotion_analysis",
  DATA_PROCESSING: "data_processing",
  MARKETING: "marketing",
  ANALYTICS: "analytics",
} as const;

export type ConsentType = typeof CONSENT_TYPE[keyof typeof CONSENT_TYPE];

export const userConsents = pgTable("user_consents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  consentType: text("consent_type").notNull(), // ConsentType
  granted: boolean("granted").notNull(),
  version: text("version").notNull(), // Policy version consented to
  scope: text("scope"), // all, specific_call, specific_meeting, etc.
  scopeId: integer("scope_id"), // ID of the specific scope
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  grantedAt: timestamp("granted_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("user_consents_user_idx").on(table.userId),
  index("user_consents_type_idx").on(table.consentType),
]);

// Data Subject Requests - GDPR/privacy compliance
export const DATA_REQUEST_TYPE = {
  EXPORT: "export",
  DELETION: "deletion",
  RECTIFICATION: "rectification",
  RESTRICTION: "restriction",
  PORTABILITY: "portability",
} as const;

export type DataRequestType = typeof DATA_REQUEST_TYPE[keyof typeof DATA_REQUEST_TYPE];

export const DATA_REQUEST_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type DataRequestStatus = typeof DATA_REQUEST_STATUS[keyof typeof DATA_REQUEST_STATUS];

export const dataSubjectRequests = pgTable("data_subject_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  requestType: text("request_type").notNull(), // DataRequestType
  status: text("status").default("pending"),
  requestDetails: jsonb("request_details").default({}),
  processedBy: integer("processed_by").references(() => users.id),
  resultUrl: text("result_url"), // For export requests
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"), // When result file expires
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("data_subject_requests_user_idx").on(table.userId),
  index("data_subject_requests_status_idx").on(table.status),
]);

// Backup Jobs - Track backup operations for DR
export const BACKUP_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type BackupStatus = typeof BACKUP_STATUS[keyof typeof BACKUP_STATUS];

export const backupJobs = pgTable("backup_jobs", {
  id: serial("id").primaryKey(),
  backupType: text("backup_type").notNull(), // full, incremental, differential
  dataScope: text("data_scope").notNull(), // database, files, all
  status: text("status").default("pending"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  sizeBytes: integer("size_bytes"),
  storagePath: text("storage_path"),
  retentionDays: integer("retention_days").default(30),
  expiresAt: timestamp("expires_at"),
  triggeredBy: text("triggered_by"), // scheduled, manual, pre-deploy
  errorMessage: text("error_message"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("backup_jobs_status_idx").on(table.status),
  index("backup_jobs_created_idx").on(table.createdAt),
]);

// System Health Checks - Track platform health
export const HEALTH_STATUS = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNHEALTHY: "unhealthy",
  UNKNOWN: "unknown",
} as const;

export type HealthStatus = typeof HEALTH_STATUS[keyof typeof HEALTH_STATUS];

export const systemHealthLogs = pgTable("system_health_logs", {
  id: serial("id").primaryKey(),
  service: text("service").notNull(), // database, signaling, media, ai, storage
  status: text("status").notNull(),
  responseTimeMs: integer("response_time_ms"),
  errorMessage: text("error_message"),
  details: jsonb("details").default({}),
  checkedAt: timestamp("checked_at").defaultNow(),
}, (table) => [
  index("system_health_logs_service_idx").on(table.service),
  index("system_health_logs_checked_idx").on(table.checkedAt),
]);

// User Accessibility Preferences
export const userAccessibilityPrefs = pgTable("user_accessibility_prefs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  highContrast: boolean("high_contrast").default(false),
  reducedMotion: boolean("reduced_motion").default(false),
  fontSize: text("font_size").default("medium"), // small, medium, large, x-large
  screenReaderOptimized: boolean("screen_reader_optimized").default(false),
  colorBlindMode: text("color_blind_mode"), // protanopia, deuteranopia, tritanopia
  keyboardNavigation: boolean("keyboard_navigation").default(true),
  captionsEnabled: boolean("captions_enabled").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Data Residency Configuration - Region-based storage
export const DATA_REGION = {
  INDIA: "in",
  US: "us",
  EU: "eu",
  ASIA_PACIFIC: "apac",
} as const;

export type DataRegion = typeof DATA_REGION[keyof typeof DATA_REGION];

export const dataResidencyPolicies = pgTable("data_residency_policies", {
  id: serial("id").primaryKey(),
  region: text("region").notNull().unique(), // DataRegion
  displayName: text("display_name").notNull(),
  storageEndpoint: text("storage_endpoint"),
  databaseRegion: text("database_region"),
  isEnabled: boolean("is_enabled").default(true),
  complianceStandards: jsonb("compliance_standards").default([]), // GDPR, HIPAA, etc.
  retentionDays: integer("retention_days").default(365),
  createdAt: timestamp("created_at").defaultNow(),
});

// Environment Configuration
export const ENVIRONMENT_TYPE = {
  DEVELOPMENT: "development",
  STAGING: "staging",
  PRODUCTION: "production",
} as const;

export type EnvironmentType = typeof ENVIRONMENT_TYPE[keyof typeof ENVIRONMENT_TYPE];

export const environmentConfigs = pgTable("environment_configs", {
  id: serial("id").primaryKey(),
  environment: text("environment").notNull().unique(), // EnvironmentType
  displayName: text("display_name").notNull(),
  baseUrl: text("base_url"),
  apiUrl: text("api_url"),
  wsUrl: text("ws_url"),
  features: jsonb("features").default({}), // Feature flags per environment
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// === BILLING FRAUD & ANOMALY DETECTION ===
export const billingAnomalies = pgTable("billing_anomalies", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  type: text("type").notNull(), // frequent_refunds, excessive_usage, session_hijack
  severity: text("severity").default("medium"),
  metadata: jsonb("metadata").default({}),
  isResolved: boolean("is_resolved").default(false),
  manualOverride: boolean("manual_override").default(false), // Allows bypass of anomaly detection
  overrideReason: text("override_reason"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("billing_anomalies_user_idx").on(table.userId),
  index("billing_anomalies_type_idx").on(table.type),
]);

// === ZOD SCHEMAS ===
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertOrgMemberSchema = createInsertSchema(orgMembers).omit({ id: true, createdAt: true });
export const insertVoiceProfileSchema = createInsertSchema(voiceProfiles).omit({ id: true, createdAt: true });
export const insertBridgedCallSchema = createInsertSchema(bridgedCalls).omit({ id: true, createdAt: true });
export const insertCallTranslationSchema = createInsertSchema(callTranslations).omit({ id: true, timestamp: true });
export const insertCallParticipantSchema = createInsertSchema(callParticipants).omit({ id: true, joinedAt: true });
export const insertCallConsentSchema = createInsertSchema(callConsents).omit({ id: true, createdAt: true, consentTimestamp: true });
export const insertRegisteredDeviceSchema = createInsertSchema(registeredDevices).omit({ id: true, createdAt: true, registeredAt: true, lastSeenAt: true });
export const insertCallTelemetrySchema = createInsertSchema(callTelemetry).omit({ id: true, timestamp: true });
export const insertVoiceSampleSchema = createInsertSchema(voiceSamples).omit({ id: true, createdAt: true });
export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true });
export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export const insertVoiceMemoSchema = createInsertSchema(voiceMemos).omit({ id: true, createdAt: true });
export const insertGroupChatSchema = createInsertSchema(groupChats).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGroupChatMemberSchema = createInsertSchema(groupChatMembers).omit({ id: true, joinedAt: true });
export const insertGroupChatMessageSchema = createInsertSchema(groupChatMessages).omit({ id: true, createdAt: true, updatedAt: true });
export const insertOtpChallengeSchema = createInsertSchema(otpChallenges).omit({ id: true, createdAt: true });
export const insertPlatformSettingSchema = createInsertSchema(platformSettings).omit({ id: true, updatedAt: true });
export const insertMeetingRoomSchema = createInsertSchema(meetingRooms).omit({ id: true, createdAt: true });
export const insertMeetingParticipantSchema = createInsertSchema(meetingParticipants).omit({ id: true, joinedAt: true });
export const insertCountrySchema = createInsertSchema(countries).omit({ id: true, createdAt: true });
export const insertStateSchema = createInsertSchema(states).omit({ id: true, createdAt: true });
export const insertDistrictSchema = createInsertSchema(districts).omit({ id: true, createdAt: true });
export const insertCitySchema = createInsertSchema(cities).omit({ id: true, createdAt: true });
export const insertVillageSchema = createInsertSchema(villages).omit({ id: true, createdAt: true });
export const insertPincodeSchema = createInsertSchema(pincodes).omit({ id: true, createdAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export const insertSupportedLanguageSchema = createInsertSchema(supportedLanguages).omit({ id: true, createdAt: true });
export const insertTenantDatabaseSchema = createInsertSchema(tenantDatabases).omit({ id: true, createdAt: true, updatedAt: true, lastHealthCheckedAt: true });
export const insertTenantSecurityPolicySchema = createInsertSchema(tenantSecurityPolicies).omit({ id: true, createdAt: true, updatedAt: true });

// Billing schemas
export const insertBillingPlanSchema = createInsertSchema(billingPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUsageRecordSchema = createInsertSchema(usageRecords).omit({ id: true, createdAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceLineItemSchema = createInsertSchema(invoiceLineItems).omit({ id: true, createdAt: true });
export const insertGstSettingsSchema = createInsertSchema(gstSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBillingSettingsSchema = createInsertSchema(billingSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBillingAccountSchema = createInsertSchema(billingAccounts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBillingReservationSchema = createInsertSchema(billingReservations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBillingLedgerEntrySchema = createInsertSchema(billingLedgerEntries).omit({ id: true, createdAt: true });
export const insertCallBillingRecordSchema = createInsertSchema(callBillingRecords).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentGatewaySchema = createInsertSchema(paymentGateways).omit({ id: true, createdAt: true, updatedAt: true });
export const insertPaymentTransactionSchema = createInsertSchema(paymentTransactions).omit({ id: true, createdAt: true });
export const insertLegalContentSchema = createInsertSchema(legalContent).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSupportContactSchema = createInsertSchema(supportContacts).omit({ id: true, createdAt: true });

// Production readiness schemas
export const insertAppVersionSchema = createInsertSchema(appVersions).omit({ id: true, createdAt: true });
export const insertRateLimitRuleSchema = createInsertSchema(rateLimitRules).omit({ id: true, createdAt: true });
export const insertAbuseReportSchema = createInsertSchema(abuseReports).omit({ id: true, createdAt: true });
export const insertUserSuspensionSchema = createInsertSchema(userSuspensions).omit({ id: true, createdAt: true });
export const insertUserConsentSchema = createInsertSchema(userConsents).omit({ id: true, createdAt: true });
export const insertDataSubjectRequestSchema = createInsertSchema(dataSubjectRequests).omit({ id: true, createdAt: true });
export const insertBackupJobSchema = createInsertSchema(backupJobs).omit({ id: true, createdAt: true });
export const insertSystemHealthLogSchema = createInsertSchema(systemHealthLogs).omit({ id: true });
export const insertUserAccessibilityPrefsSchema = createInsertSchema(userAccessibilityPrefs).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDataResidencyPolicySchema = createInsertSchema(dataResidencyPolicies).omit({ id: true, createdAt: true });
export const insertEnvironmentConfigSchema = createInsertSchema(environmentConfigs).omit({ id: true, createdAt: true });

// === TYPES ===
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type OrgMember = typeof orgMembers.$inferSelect;
export type InsertOrgMember = z.infer<typeof insertOrgMemberSchema>;
export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type InsertVoiceProfile = z.infer<typeof insertVoiceProfileSchema>;
export type VoiceSample = typeof voiceSamples.$inferSelect;
export type InsertVoiceSample = z.infer<typeof insertVoiceSampleSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type VoiceMemo = typeof voiceMemos.$inferSelect;
export type InsertVoiceMemo = z.infer<typeof insertVoiceMemoSchema>;
export type GroupChat = typeof groupChats.$inferSelect;
export type InsertGroupChat = z.infer<typeof insertGroupChatSchema>;
export type GroupChatMember = typeof groupChatMembers.$inferSelect;
export type InsertGroupChatMember = z.infer<typeof insertGroupChatMemberSchema>;
export type GroupChatMessage = typeof groupChatMessages.$inferSelect;
export type InsertGroupChatMessage = z.infer<typeof insertGroupChatMessageSchema>;
export type BridgedCall = typeof bridgedCalls.$inferSelect;
export type InsertBridgedCall = z.infer<typeof insertBridgedCallSchema>;
export type CallTranslation = typeof callTranslations.$inferSelect;
export type InsertCallTranslation = z.infer<typeof insertCallTranslationSchema>;
export type CallParticipant = typeof callParticipants.$inferSelect;
export type InsertCallParticipant = z.infer<typeof insertCallParticipantSchema>;
export type CallConsent = typeof callConsents.$inferSelect;
export type InsertCallConsent = z.infer<typeof insertCallConsentSchema>;
export type RegisteredDevice = typeof registeredDevices.$inferSelect;
export type InsertRegisteredDevice = z.infer<typeof insertRegisteredDeviceSchema>;
export type CallTelemetry = typeof callTelemetry.$inferSelect;
export type InsertCallTelemetry = z.infer<typeof insertCallTelemetrySchema>;
export type OtpChallenge = typeof otpChallenges.$inferSelect;
export type InsertOtpChallenge = z.infer<typeof insertOtpChallengeSchema>;
export type PlatformSetting = typeof platformSettings.$inferSelect;
export type InsertPlatformSetting = z.infer<typeof insertPlatformSettingSchema>;
export type MeetingRoom = typeof meetingRooms.$inferSelect;
export type InsertMeetingRoom = z.infer<typeof insertMeetingRoomSchema>;
export type MeetingParticipant = typeof meetingParticipants.$inferSelect;
export type InsertMeetingParticipant = z.infer<typeof insertMeetingParticipantSchema>;
export type Country = typeof countries.$inferSelect;
export type InsertCountry = z.infer<typeof insertCountrySchema>;
export type State = typeof states.$inferSelect;
export type InsertState = z.infer<typeof insertStateSchema>;
export type District = typeof districts.$inferSelect;
export type InsertDistrict = z.infer<typeof insertDistrictSchema>;
export type City = typeof cities.$inferSelect;
export type InsertCity = z.infer<typeof insertCitySchema>;
export type Village = typeof villages.$inferSelect;
export type InsertVillage = z.infer<typeof insertVillageSchema>;
export type Pincode = typeof pincodes.$inferSelect;
export type InsertPincode = z.infer<typeof insertPincodeSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type TenantDatabase = typeof tenantDatabases.$inferSelect;
export type InsertTenantDatabase = z.infer<typeof insertTenantDatabaseSchema>;
export type TenantSecurityPolicy = typeof tenantSecurityPolicies.$inferSelect;
export type InsertTenantSecurityPolicy = z.infer<typeof insertTenantSecurityPolicySchema>;
export type SupportedLanguage = typeof supportedLanguages.$inferSelect;
export type InsertSupportedLanguage = z.infer<typeof insertSupportedLanguageSchema>;
export type PaymentGateway = typeof paymentGateways.$inferSelect;
export type InsertPaymentGateway = z.infer<typeof insertPaymentGatewaySchema>;
export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type InsertPaymentTransaction = z.infer<typeof insertPaymentTransactionSchema>;
export type LegalContent = typeof legalContent.$inferSelect;
export type InsertLegalContent = z.infer<typeof insertLegalContentSchema>;
export type SupportContact = typeof supportContacts.$inferSelect;
export type InsertSupportContact = z.infer<typeof insertSupportContactSchema>;

// Billing types
export type BillingPlan = typeof billingPlans.$inferSelect;
export type InsertBillingPlan = z.infer<typeof insertBillingPlanSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type UsageRecord = typeof usageRecords.$inferSelect;
export type InsertUsageRecord = z.infer<typeof insertUsageRecordSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type InsertInvoiceLineItem = z.infer<typeof insertInvoiceLineItemSchema>;
export type GstSettings = typeof gstSettings.$inferSelect;
export type InsertGstSettings = z.infer<typeof insertGstSettingsSchema>;
export type BillingSettingsType = typeof billingSettings.$inferSelect;
export type InsertBillingSettings = z.infer<typeof insertBillingSettingsSchema>;
export type BillingAccount = typeof billingAccounts.$inferSelect;
export type InsertBillingAccount = z.infer<typeof insertBillingAccountSchema>;
export type BillingReservation = typeof billingReservations.$inferSelect;
export type InsertBillingReservation = z.infer<typeof insertBillingReservationSchema>;
export type BillingLedgerEntry = typeof billingLedgerEntries.$inferSelect;
export type InsertBillingLedgerEntry = z.infer<typeof insertBillingLedgerEntrySchema>;
export type CallBillingRecord = typeof callBillingRecords.$inferSelect;
export type InsertCallBillingRecord = z.infer<typeof insertCallBillingRecordSchema>;

// Production readiness types
export type AppVersion = typeof appVersions.$inferSelect;
export type InsertAppVersion = z.infer<typeof insertAppVersionSchema>;
export type RateLimitRule = typeof rateLimitRules.$inferSelect;
export type InsertRateLimitRule = z.infer<typeof insertRateLimitRuleSchema>;
export type RateLimitBucket = typeof rateLimitBuckets.$inferSelect;
export type AbuseReport = typeof abuseReports.$inferSelect;
export type InsertAbuseReport = z.infer<typeof insertAbuseReportSchema>;
export type UserSuspension = typeof userSuspensions.$inferSelect;
export type InsertUserSuspension = z.infer<typeof insertUserSuspensionSchema>;
export type UserConsent = typeof userConsents.$inferSelect;
export type InsertUserConsent = z.infer<typeof insertUserConsentSchema>;
export type DataSubjectRequest = typeof dataSubjectRequests.$inferSelect;
export type InsertDataSubjectRequest = z.infer<typeof insertDataSubjectRequestSchema>;
export type BackupJob = typeof backupJobs.$inferSelect;
export type InsertBackupJob = z.infer<typeof insertBackupJobSchema>;
export type SystemHealthLog = typeof systemHealthLogs.$inferSelect;
export type InsertSystemHealthLog = z.infer<typeof insertSystemHealthLogSchema>;
export type UserAccessibilityPrefs = typeof userAccessibilityPrefs.$inferSelect;
export type InsertUserAccessibilityPrefs = z.infer<typeof insertUserAccessibilityPrefsSchema>;
export type DataResidencyPolicy = typeof dataResidencyPolicies.$inferSelect;
export type InsertDataResidencyPolicy = z.infer<typeof insertDataResidencyPolicySchema>;
export type EnvironmentConfig = typeof environmentConfigs.$inferSelect;
export type InsertEnvironmentConfig = z.infer<typeof insertEnvironmentConfigSchema>;

// === PLATFORM SECRETS (encrypted configuration storage) ===
export const platformSecrets = pgTable("platform_secrets", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g., "firebase_api_key", "turn_server_url"
  encryptedValue: text("encrypted_value").notNull(), // AES-256 encrypted value
  iv: text("iv").notNull(), // Initialization vector for decryption
  category: text("category").notNull(), // "firebase", "turn", "other"
  description: text("description"),
  isSet: boolean("is_set").default(true), // Whether a value is configured
  updatedBy: integer("updated_by"), // Super admin who last updated
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("platform_secrets_key_idx").on(table.key),
  index("platform_secrets_category_idx").on(table.category),
]);

export const insertPlatformSecretSchema = createInsertSchema(platformSecrets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PlatformSecret = typeof platformSecrets.$inferSelect;
export type InsertPlatformSecret = z.infer<typeof insertPlatformSecretSchema>;

// === SIGNALING SESSIONS (for multi-instance scaling) ===
export const signalingSessions = pgTable("signaling_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  
  // Client identification
  userId: integer("user_id"),
  phoneNumber: text("phone_number"),
  deviceId: text("device_id"),
  
  // Session state
  isActive: boolean("is_active").default(true),
  activeCallId: text("active_call_id"),
  
  // Capabilities (stored as JSON for flexibility)
  capabilities: jsonb("capabilities").default({}),
  
  // Connection info
  serverInstance: text("server_instance"), // For multi-instance routing
  lastHeartbeat: timestamp("last_heartbeat").defaultNow(),
  
  createdAt: timestamp("created_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("signaling_sessions_session_id_idx").on(table.sessionId),
  index("signaling_sessions_user_id_idx").on(table.userId),
  index("signaling_sessions_phone_idx").on(table.phoneNumber),
  index("signaling_sessions_active_idx").on(table.isActive),
]);

export const insertSignalingSessionSchema = createInsertSchema(signalingSessions).omit({
  id: true,
  createdAt: true,
});

export type SignalingSession = typeof signalingSessions.$inferSelect;
export type InsertSignalingSession = z.infer<typeof insertSignalingSessionSchema>;

// === AI PERSONAS ===
// Custom AI personality profiles for different use cases
export const aiPersonas = pgTable("ai_personas", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  systemPrompt: text("system_prompt").notNull(),
  voiceId: text("voice_id").default("alloy"),
  avatarUrl: text("avatar_url"),
  category: text("category").default("general"),
  personality: text("personality").default("friendly"),
  language: text("language").default("en"),
  isPublic: boolean("is_public").default(false),
  isDefault: boolean("is_default").default(false),
  createdBy: integer("created_by").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  settings: jsonb("settings").default({}),
  usageCount: integer("usage_count").default(0),
  rating: integer("rating").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ai_personas_category_idx").on(table.category),
  index("ai_personas_public_idx").on(table.isPublic),
  index("ai_personas_org_idx").on(table.organizationId),
]);

export const insertAiPersonaSchema = createInsertSchema(aiPersonas).omit({
  id: true,
  usageCount: true,
  rating: true,
  createdAt: true,
});

export type AiPersona = typeof aiPersonas.$inferSelect;
export type InsertAiPersona = z.infer<typeof insertAiPersonaSchema>;

// === USER ANALYTICS ===
export const userAnalytics = pgTable("user_analytics", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  date: timestamp("date").notNull(),
  totalCalls: integer("total_calls").default(0),
  totalMinutes: integer("total_minutes").default(0),
  aiChatMinutes: integer("ai_chat_minutes").default(0),
  phoneCalls: integer("phone_calls").default(0),
  videoCalls: integer("video_calls").default(0),
  groupCalls: integer("group_calls").default(0),
  languagesUsed: jsonb("languages_used").default([]),
  emotionsDetected: jsonb("emotions_detected").default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("user_analytics_user_idx").on(table.userId),
  index("user_analytics_date_idx").on(table.date),
]);

export const insertUserAnalyticsSchema = createInsertSchema(userAnalytics).omit({
  id: true,
  createdAt: true,
});

export type UserAnalytics = typeof userAnalytics.$inferSelect;
export type InsertUserAnalytics = z.infer<typeof insertUserAnalyticsSchema>;

// === API TYPES ===
export type ConversationWithMessages = Conversation & {
  messages: Message[];
};

export type UserWithOrg = User & {
  organization?: Organization | null;
};

export type BridgedCallWithDetails = BridgedCall & {
  translations?: CallTranslation[];
  participants?: CallParticipant[];
};

export type MeetingRoomWithDetails = MeetingRoom & {
  host?: User;
  participants?: MeetingParticipant[];
};

// === PROVIDER-AGNOSTIC TYPE ALIASES ===
// Use these for new code to abstract away legacy field names
export type SignalingSessionId = BridgedCall["callSid"];
export type MediaSessionId = BridgedCall["outboundCallSid"];

// Helper type to access session IDs with semantic names
export interface CallSessionIdentifiers {
  signalingSessionId: SignalingSessionId;
  mediaSessionId: MediaSessionId;
}

// === ENTERPRISE API KEYS ===
export const enterpriseApiKeys = pgTable("enterprise_api_keys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("pending"),
  permissions: jsonb("permissions").default([
    "translate",
    "tts",
    "stt",
    "languages",
    "voice-chat",
    "calls:create",
    "calls:end",
    "calls:read",
    "usage:read",
    "billing:read",
    "ws:subscribe",
    "masking:manage",
    "recording:control",
  ]),
  rateLimitPerMinute: integer("rate_limit_per_minute").default(60),
  dailyQuota: integer("daily_quota").default(1000),
  usageCount: integer("usage_count").default(0),
  usageToday: integer("usage_today").default(0),
  usageResetDate: text("usage_reset_date"),
  lastUsedAt: timestamp("last_used_at"),
  activatedBy: integer("activated_by"),
  activatedAt: timestamp("activated_at"),
  suspendedAt: timestamp("suspended_at"),
  suspendedReason: text("suspended_reason"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("enterprise_api_keys_org_idx").on(table.organizationId),
  index("enterprise_api_keys_hash_idx").on(table.keyHash),
  index("enterprise_api_keys_status_idx").on(table.status),
]);

export const enterpriseApiKeysRelations = relations(enterpriseApiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [enterpriseApiKeys.organizationId],
    references: [organizations.id],
  }),
}));

export const insertEnterpriseApiKeySchema = createInsertSchema(enterpriseApiKeys).omit({
  id: true,
  createdAt: true,
});

export type EnterpriseApiKey = typeof enterpriseApiKeys.$inferSelect;
export type InsertEnterpriseApiKey = z.infer<typeof insertEnterpriseApiKeySchema>;

// === COMMUNICATION API PLATFORM ===
// SaaS-grade app-to-app calling with masking, dynamic pricing, and per-second billing
export const communicationVirtualNumbers = pgTable("communication_virtual_numbers", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("msg91"),
  phoneNumber: text("phone_number").notNull().unique(),
  countryCode: text("country_code").notNull().default("IN"),
  region: text("region").notNull().default("ap-south-1"),
  status: text("status").notNull().default("available"), // available, assigned, maintenance, disabled
  capabilities: jsonb("capabilities").default({ voice: true, pstn: true, sms: false }),
  metadata: jsonb("metadata").default({}),
  lastAssignedAt: timestamp("last_assigned_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("communication_virtual_numbers_status_idx").on(table.status),
  index("communication_virtual_numbers_region_idx").on(table.region),
]);

export const communicationMaskedNumberMappings = pgTable("communication_masked_number_mappings", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  virtualNumberId: integer("virtual_number_id"),
  apiKeyId: integer("api_key_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  callerExternalId: text("caller_external_id"),
  calleeExternalId: text("callee_external_id"),
  callerRealNumber: text("caller_real_number").notNull(),
  calleeRealNumber: text("callee_real_number").notNull(),
  maskedNumber: text("masked_number").notNull(),
  status: text("status").notNull().default("active"), // active, expired, released
  expiresAt: timestamp("expires_at").notNull(),
  releasedAt: timestamp("released_at"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("communication_masked_numbers_api_key_idx").on(table.apiKeyId),
  index("communication_masked_numbers_org_idx").on(table.organizationId),
  index("communication_masked_numbers_status_idx").on(table.status),
  index("communication_masked_numbers_expires_idx").on(table.expiresAt),
]);

export const communicationApiKeyPricing = pgTable("communication_api_key_pricing", {
  id: serial("id").primaryKey(),
  apiKeyId: integer("api_key_id").notNull().unique(),
  organizationId: integer("organization_id").notNull(),
  billingModel: text("billing_model").notNull().default("prepaid"), // prepaid, postpaid
  prepaidBalancePaise: integer("prepaid_balance_paise").notNull().default(0),
  postpaidCreditLimitPaise: integer("postpaid_credit_limit_paise").notNull().default(0),
  currentPostpaidUsagePaise: integer("current_postpaid_usage_paise").notNull().default(0),
  voiceRatePerSecondPaise: integer("voice_rate_per_second_paise"),
  videoRatePerSecondPaise: integer("video_rate_per_second_paise"),
  pstnFallbackRatePerSecondPaise: integer("pstn_fallback_rate_per_second_paise").notNull().default(0),
  connectionFeePaise: integer("connection_fee_paise").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  allowPstnFallback: boolean("allow_pstn_fallback").default(true),
  allowRecording: boolean("allow_recording").default(false),
  maxConcurrentSessions: integer("max_concurrent_sessions").notNull().default(100),
  region: text("region").notNull().default("ap-south-1"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("communication_api_key_pricing_org_idx").on(table.organizationId),
  index("communication_api_key_pricing_billing_idx").on(table.billingModel),
]);

export const communicationSessions = pgTable("communication_sessions", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  apiKeyId: integer("api_key_id").notNull(),
  organizationId: integer("organization_id").notNull(),
  pricingId: integer("pricing_id"),
  subscriptionId: integer("subscription_id"),
  maskedMappingId: integer("masked_mapping_id"),
  livekitRoomName: text("livekit_room_name"),
  callerIdentity: text("caller_identity").notNull(),
  calleeIdentity: text("callee_identity").notNull(),
  callerPhoneNumber: text("caller_phone_number"),
  calleePhoneNumber: text("callee_phone_number"),
  callerDisplayName: text("caller_display_name"),
  calleeDisplayName: text("callee_display_name"),
  callerLanguage: text("caller_language").default("en-IN"),
  calleeLanguage: text("callee_language").default("en-IN"),
  maskedNumber: text("masked_number"),
  callType: text("call_type").notNull().default("voice"), // voice, video
  transport: text("transport").notNull().default("webrtc"),
  joinMethod: text("join_method").notNull().default("app_to_app"),
  status: text("status").notNull().default("created"), // created, ringing, active, ended, failed, cancelled
  recordingEnabled: boolean("recording_enabled").default(false),
  aiAssistantEnabled: boolean("ai_assistant_enabled").default(false),
  maskingEnabled: boolean("masking_enabled").default(true),
  pstnFallbackEnabled: boolean("pstn_fallback_enabled").default(true),
  pstnCallId: text("pstn_call_id"),
  connectedParticipantCount: integer("connected_participant_count").default(0),
  billedSeconds: integer("billed_seconds").default(0),
  totalCostPaise: integer("total_cost_paise").default(0),
  metadata: jsonb("metadata").default({}),
  telemetry: jsonb("telemetry").default({}),
  startedAt: timestamp("started_at"),
  connectedAt: timestamp("connected_at"),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("communication_sessions_api_key_idx").on(table.apiKeyId),
  index("communication_sessions_org_idx").on(table.organizationId),
  index("communication_sessions_status_idx").on(table.status),
  index("communication_sessions_created_idx").on(table.createdAt),
]);

export const communicationSessionEvents = pgTable("communication_session_events", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").default({}),
  occurredAt: timestamp("occurred_at").defaultNow(),
}, (table) => [
  index("communication_session_events_session_idx").on(table.sessionId),
  index("communication_session_events_time_idx").on(table.occurredAt),
]);

export const insertCommunicationVirtualNumberSchema = createInsertSchema(communicationVirtualNumbers).omit({
  id: true,
  lastAssignedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationMaskedNumberMappingSchema = createInsertSchema(communicationMaskedNumberMappings).omit({
  id: true,
  releasedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationApiKeyPricingSchema = createInsertSchema(communicationApiKeyPricing).omit({
  id: true,
  currentPostpaidUsagePaise: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationSessionSchema = createInsertSchema(communicationSessions).omit({
  id: true,
  connectedParticipantCount: true,
  billedSeconds: true,
  totalCostPaise: true,
  connectedAt: true,
  endedAt: true,
  createdAt: true,
  updatedAt: true,
});
export const insertCommunicationSessionEventSchema = createInsertSchema(communicationSessionEvents).omit({
  id: true,
  occurredAt: true,
});

export type CommunicationVirtualNumber = typeof communicationVirtualNumbers.$inferSelect;
export type InsertCommunicationVirtualNumber = z.infer<typeof insertCommunicationVirtualNumberSchema>;
export type CommunicationMaskedNumberMapping = typeof communicationMaskedNumberMappings.$inferSelect;
export type InsertCommunicationMaskedNumberMapping = z.infer<typeof insertCommunicationMaskedNumberMappingSchema>;
export type CommunicationApiKeyPricing = typeof communicationApiKeyPricing.$inferSelect;
export type InsertCommunicationApiKeyPricing = z.infer<typeof insertCommunicationApiKeyPricingSchema>;
export type CommunicationSession = typeof communicationSessions.$inferSelect;
export type InsertCommunicationSession = z.infer<typeof insertCommunicationSessionSchema>;
export type CommunicationSessionEvent = typeof communicationSessionEvents.$inferSelect;
export type InsertCommunicationSessionEvent = z.infer<typeof insertCommunicationSessionEventSchema>;

// Extract session IDs from a call record
export function getCallSessionIds(call: BridgedCall): CallSessionIdentifiers {
  return {
    signalingSessionId: call.callSid,
    mediaSessionId: call.outboundCallSid,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// USER CONTACTS (Address Book) — Server-synced, never localStorage only
// ═══════════════════════════════════════════════════════════════════════

export const userContacts = pgTable("user_contacts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(), // owner of this contact
  name: text("name").notNull(),
  identifier: text("identifier").notNull(), // phone, email, or username
  language: text("language").default("en"),
  isFavorite: boolean("is_favorite").default(false),
  lastCalledAt: timestamp("last_called_at"),
  avatarUrl: text("avatar_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("idx_user_contacts_user_id").on(table.userId),
]);

export const insertUserContactSchema = createInsertSchema(userContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserContact = typeof userContacts.$inferSelect;
export type InsertUserContact = z.infer<typeof insertUserContactSchema>;

// ═══════════════════════════════════════════════════════════════════════
// AGENT SKILLS — B2B skill-based routing
// ═══════════════════════════════════════════════════════════════════════

export const agentSkills = pgTable("agent_skills", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  skills: jsonb("skills").notNull().default([]),           // string[] e.g. ["en", "te", "hi", "sales", "support"]
  maxConcurrentCalls: integer("max_concurrent_calls").notNull().default(3),
  isAvailable: boolean("is_available").notNull().default(true),
  priority: integer("priority").notNull().default(1),      // higher = preferred
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("agent_skills_org_idx").on(table.organizationId),
  index("agent_skills_user_idx").on(table.userId),
  index("agent_skills_available_idx").on(table.isAvailable),
]);

export const insertAgentSkillSchema = createInsertSchema(agentSkills).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type AgentSkill = typeof agentSkills.$inferSelect;
export type InsertAgentSkill = z.infer<typeof insertAgentSkillSchema>;

// ═══════════════════════════════════════════════════════════════════════
// ORG DID NUMBERS — per-org outbound caller ID + inbound routing
// ═══════════════════════════════════════════════════════════════════════

export const orgDIDNumbers = pgTable("org_did_numbers", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),             // E.164 e.g. +911800XXXXXX
  label: text("label"),                                    // e.g. "Sales", "Support"
  type: text("type").notNull().default("inbound"),         // inbound, outbound, both
  provider: text("provider").notNull().default("msg91"),
  isActive: boolean("is_active").notNull().default(true),
  ivrEnabled: boolean("ivr_enabled").notNull().default(false),
  ivrConfig: jsonb("ivr_config").default({}),              // { greeting, menuOptions: [{digit, action, targetSkill}] }
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("org_did_numbers_org_idx").on(table.organizationId),
  index("org_did_numbers_phone_idx").on(table.phoneNumber),
]);

export const insertOrgDIDNumberSchema = createInsertSchema(orgDIDNumbers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type OrgDIDNumber = typeof orgDIDNumbers.$inferSelect;
export type InsertOrgDIDNumber = z.infer<typeof insertOrgDIDNumberSchema>;
