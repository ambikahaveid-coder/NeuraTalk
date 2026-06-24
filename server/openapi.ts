/**
 * NeuraTalk OpenAPI 3.0 Specification
 * 
 * Comprehensive API documentation for all endpoints.
 * Auto-generated SDK types available in @shared/sdk-types.ts
 */

import { Express } from "express";

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "NeuraTalk API",
    version: "2.0.0",
    description: `
NeuraTalk is a production-grade, real-time multilingual voice and video communication platform.

## Authentication
All authenticated endpoints require a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <your-token>
\`\`\`

## Base URL
- Development: http://localhost:5000
- Production: https://your-domain.replit.app

## Rate Limits
- Standard: 100 requests/minute
- AI endpoints: 20 requests/minute
- Voice/Video: 60 requests/minute

## WebSocket Endpoints
- Signaling: /ws/signaling (legacy meeting transport, disabled by default in primary production)
- Voice AI: /ws/voice-ai
- Lip-sync realtime: /ws/lipsync (future)
    `,
    contact: {
      name: "Mindwhile IT Solutions Pvt Ltd",
      email: "support@neuratalk.com",
      url: "https://neuratalk.com"
    },
    license: {
      name: "Proprietary",
      url: "https://neuratalk.com/terms"
    }
  },
  servers: [
    {
      url: "{protocol}://{host}",
      description: "NeuraTalk API Server",
      variables: {
        protocol: { enum: ["http", "https"], default: "https" },
        host: { default: "localhost:5000" }
      }
    }
  ],
  tags: [
    { name: "Authentication", description: "OTP-based passwordless authentication" },
    { name: "Users", description: "User management and profiles" },
    { name: "Organizations", description: "B2B organization management" },
    { name: "Calls", description: "Voice and video call management" },
    { name: "Translation", description: "Real-time translation services" },
    { name: "Voice Memos", description: "Voice memo recording and translation" },
    { name: "Group Chats", description: "Multi-language group conversations" },
    { name: "Billing", description: "Subscriptions and payments" },
    { name: "Lip-Sync", description: "Video lip-sync processing (GPU)" },
    { name: "AI", description: "Chat, audio, and image AI services" },
    { name: "RTC", description: "WebRTC configuration and signaling" },
    { name: "Admin", description: "Platform administration" },
    { name: "Enterprise", description: "Enterprise compliance features" }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Bearer token from OTP authentication"
      }
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "integer" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          displayName: { type: "string" },
          role: { type: "string", enum: ["super_admin", "investor", "company_admin", "agent", "consumer"] },
          organizationId: { type: "integer", nullable: true },
          isActive: { type: "boolean" },
          preferredLanguage: { type: "string" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      Organization: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          slug: { type: "string" },
          status: { type: "string", enum: ["pending", "approved", "rejected", "suspended"] },
          plan: { type: "string", enum: ["free", "pro", "enterprise"] },
          walletBalancePaise: { type: "integer" },
          primaryLanguage: { type: "string" },
          supportedLanguages: { type: "array", items: { type: "string" } },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      VoiceProfile: {
        type: "object",
        properties: {
          id: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] },
          name: { type: "string" },
          description: { type: "string" }
        }
      },
      TranslationRequest: {
        type: "object",
        required: ["text", "targetLanguage"],
        properties: {
          text: { type: "string", description: "Text to translate" },
          sourceLanguage: { type: "string", description: "Source language code (auto-detected if not provided)" },
          targetLanguage: { type: "string", description: "Target language code" },
          preserveEmotion: { type: "boolean", default: true }
        }
      },
      TranslationResponse: {
        type: "object",
        properties: {
          original: { type: "string" },
          translated: { type: "string" },
          sourceLanguage: { type: "string" },
          targetLanguage: { type: "string" },
          emotion: { type: "string", enum: ["neutral", "happy", "sad", "angry", "surprised"] }
        }
      },
      VoiceMemo: {
        type: "object",
        properties: {
          id: { type: "integer" },
          senderId: { type: "integer" },
          recipientId: { type: "integer", nullable: true },
          groupChatId: { type: "integer", nullable: true },
          originalAudioPath: { type: "string" },
          originalLanguage: { type: "string" },
          originalTranscript: { type: "string", nullable: true },
          translations: { type: "object", additionalProperties: { type: "object", properties: { audioPath: { type: "string" }, transcript: { type: "string" } } } },
          useVoiceCloning: { type: "boolean" },
          voiceProfileId: { type: "integer", nullable: true },
          duration: { type: "integer" },
          status: { type: "string", enum: ["pending", "transcribing", "translating", "ready", "failed"] },
          emotionTags: { type: "array", items: { type: "string" }, nullable: true },
          isRead: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      GroupChat: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          creatorId: { type: "integer" },
          memberCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      LipSyncJob: {
        type: "object",
        properties: {
          jobId: { type: "string" },
          status: { type: "string", enum: ["queued", "processing", "completed", "failed"] },
          model: { type: "string", enum: ["wav2lip", "wav2lip-gan", "sadtalker"] },
          progress: { type: "number", minimum: 0, maximum: 100 },
          outputPath: { type: "string", nullable: true },
          error: { type: "string", nullable: true }
        }
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          code: { type: "string" }
        }
      }
    },
    responses: {
      UnauthorizedError: {
        description: "Authentication required",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      ForbiddenError: {
        description: "Insufficient permissions",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      },
      NotFoundError: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
      }
    }
  },
  paths: {
    // === AUTHENTICATION ===
    "/api/auth/otp/request": {
      post: {
        tags: ["Authentication"],
        summary: "Request OTP code",
        description: "Send OTP to email or phone for passwordless login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["identifier", "channel"],
                properties: {
                  identifier: { type: "string", description: "Email or phone number" },
                  channel: { type: "string", enum: ["email", "mobile"] }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "OTP sent successfully" },
          429: { description: "Too many requests" }
        }
      }
    },
    "/api/auth/otp/verify": {
      post: {
        tags: ["Authentication"],
        summary: "Verify OTP code",
        description: "Verify OTP and receive authentication token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["identifier", "code"],
                properties: {
                  identifier: { type: "string" },
                  code: { type: "string", minLength: 6, maxLength: 6 }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "Authentication successful",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    user: { $ref: "#/components/schemas/User" }
                  }
                }
              }
            }
          },
          401: { description: "Invalid or expired OTP" }
        }
      }
    },
    "/api/auth/me": {
      get: {
        tags: ["Authentication"],
        summary: "Get current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Current user details",
            content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } }
          },
          401: { $ref: "#/components/responses/UnauthorizedError" }
        }
      }
    },

    // === TRANSLATION ===
    "/api/translate": {
      post: {
        tags: ["Translation"],
        summary: "Translate text",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TranslationRequest" } } }
        },
        responses: {
          200: { content: { "application/json": { schema: { $ref: "#/components/schemas/TranslationResponse" } } } }
        }
      }
    },
    "/api/translate/speech": {
      post: {
        tags: ["Translation"],
        summary: "Speech-to-text with translation",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  audio: { type: "string", format: "binary" },
                  targetLanguage: { type: "string" },
                  preserveEmotion: { type: "boolean" }
                }
              }
            }
          }
        },
        responses: {
          200: { content: { "application/json": { schema: { $ref: "#/components/schemas/TranslationResponse" } } } }
        }
      }
    },
    "/api/audio/speech": {
      post: {
        tags: ["AI"],
        summary: "Text-to-speech",
        description: "Convert text to audio using OpenAI TTS",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: {
                  text: { type: "string" },
                  voice: { type: "string", enum: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] },
                  speed: { type: "number", minimum: 0.25, maximum: 4.0 }
                }
              }
            }
          }
        },
        responses: {
          200: { content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } } }
        }
      }
    },
    "/api/audio/voice-chat": {
      post: {
        tags: ["AI"],
        summary: "Voice chat with AI",
        description: "Send audio and receive AI voice response",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  audio: { type: "string", format: "binary" },
                  conversationId: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          200: { content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } } }
        }
      }
    },

    // === VOICE MEMOS ===
    "/api/voice-memos/languages": {
      get: {
        tags: ["Voice Memos"],
        summary: "Get supported languages",
        responses: {
          200: { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } } } } } } }
        }
      }
    },
    "/api/voice-memos/upload-url": {
      post: {
        tags: ["Voice Memos"],
        summary: "Get upload URL for voice memo",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { content: { "application/json": { schema: { type: "object", properties: { uploadURL: { type: "string" }, objectPath: { type: "string" } } } } } }
        }
      }
    },
    "/api/voice-memos": {
      get: {
        tags: ["Voice Memos"],
        summary: "List voice memos",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/VoiceMemo" } } } } }
        }
      },
      post: {
        tags: ["Voice Memos"],
        summary: "Create voice memo with translation",
        description: "First get upload URL, upload audio, then create memo with the encrypted path",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["audioPath"],
                properties: {
                  audioPath: { type: "string", description: "Encrypted path from upload-url endpoint" },
                  recipientId: { type: "integer", description: "Direct message recipient" },
                  groupChatId: { type: "integer", description: "Group chat ID" },
                  duration: { type: "integer", description: "Audio duration in seconds" },
                  useVoiceCloning: { type: "boolean" },
                  voiceProfileId: { type: "integer" }
                }
              }
            }
          }
        },
        responses: {
          201: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "integer" }, status: { type: "string" }, message: { type: "string" } } } } } }
        }
      }
    },
    "/api/voice-memos/{memoId}": {
      delete: {
        tags: ["Voice Memos"],
        summary: "Delete voice memo",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "memoId", in: "path", required: true, schema: { type: "integer" } }],
        responses: {
          200: { content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" } } } } } }
        }
      }
    },
    "/api/voice-memos/{memoId}/audio/{language}": {
      get: {
        tags: ["Voice Memos"],
        summary: "Get translated audio for voice memo",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "memoId", in: "path", required: true, schema: { type: "integer" } },
          { name: "language", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: { content: { "audio/mpeg": { schema: { type: "string", format: "binary" } } } }
        }
      }
    },

    // === GROUP CHATS ===
    "/api/group-chats": {
      get: {
        tags: ["Group Chats"],
        summary: "List group chats",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/GroupChat" } } } } }
        }
      },
      post: {
        tags: ["Group Chats"],
        summary: "Create multi-language group chat",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  memberIds: { type: "array", items: { type: "integer" } }
                }
              }
            }
          }
        },
        responses: {
          201: { content: { "application/json": { schema: { $ref: "#/components/schemas/GroupChat" } } } }
        }
      }
    },

    // === LIP-SYNC ===
    "/api/lipsync/status": {
      get: {
        tags: ["Lip-Sync"],
        summary: "Get lip-sync service status",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    gpuAvailable: { type: "boolean" },
                    modelsLoaded: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/lipsync/models": {
      get: {
        tags: ["Lip-Sync"],
        summary: "List available lip-sync models",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      description: { type: "string" },
                      quality: { type: "string" },
                      speed: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/lipsync/queue": {
      post: {
        tags: ["Lip-Sync"],
        summary: "Queue lip-sync processing job",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["videoPath", "audioPath"],
                properties: {
                  videoPath: { type: "string" },
                  audioPath: { type: "string" },
                  model: { type: "string", enum: ["wav2lip", "wav2lip-gan", "sadtalker"] },
                  priority: { type: "string", enum: ["low", "normal", "high"] }
                }
              }
            }
          }
        },
        responses: {
          202: { content: { "application/json": { schema: { $ref: "#/components/schemas/LipSyncJob" } } } }
        }
      }
    },
    "/api/lipsync/job/{jobId}": {
      get: {
        tags: ["Lip-Sync"],
        summary: "Get job status",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "jobId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { content: { "application/json": { schema: { $ref: "#/components/schemas/LipSyncJob" } } } }
        }
      }
    },

    // === RTC CONFIGURATION ===
    "/api/rtc/ice-servers": {
      get: {
        tags: ["RTC"],
        summary: "Get ICE server configuration",
        description: "Returns STUN/TURN server configuration for WebRTC",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    iceServers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          urls: { type: "array", items: { type: "string" } },
                          username: { type: "string" },
                          credential: { type: "string" }
                        }
                      }
                    },
                    turnConfigured: { type: "boolean" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/rtc/status": {
      get: {
        tags: ["RTC"],
        summary: "Get RTC infrastructure status",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    signaling: { type: "object", properties: { configured: { type: "boolean" }, path: { type: "string" } } },
                    turn: { type: "object", properties: { configured: { type: "boolean" } } },
                    stun: { type: "object", properties: { configured: { type: "boolean" } } }
                  }
                }
              }
            }
          }
        }
      }
    },

    // === ORGANIZATIONS (B2B) ===
    "/api/b2b/organizations": {
      get: {
        tags: ["Organizations"],
        summary: "List organizations",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Organization" } } } } }
        }
      }
    },
    "/api/b2b/register": {
      post: {
        tags: ["Organizations"],
        summary: "Register new B2B organization",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["organizationName", "email", "adminName"],
                properties: {
                  organizationName: { type: "string" },
                  email: { type: "string", format: "email" },
                  phone: { type: "string" },
                  adminName: { type: "string" },
                  industry: { type: "string" },
                  website: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          201: { description: "Registration submitted for approval" }
        }
      }
    },

    // === BILLING ===
    "/api/billing/plans": {
      get: {
        tags: ["Billing"],
        summary: "List available plans",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      price: { type: "number" },
                      currency: { type: "string" },
                      features: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/billing/subscribe": {
      post: {
        tags: ["Billing"],
        summary: "Subscribe to a plan",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["planId"],
                properties: {
                  planId: { type: "string" },
                  paymentMethodId: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "Subscription created" }
        }
      }
    }
  }
};

export function registerOpenApiRoutes(app: Express) {
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });

  app.get("/api/docs", (_req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>NeuraTalk API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
        deepLinking: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1
      });
    };
  </script>
</body>
</html>
    `);
  });
}
