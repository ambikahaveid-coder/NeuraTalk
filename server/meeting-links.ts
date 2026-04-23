import { Express, Request, Response } from "express";
import { z } from "zod";

const externalLinkSchema = z.object({
  platform: z.enum(["google-meet", "microsoft-teams", "zoom", "whatsapp"]),
  meetingLink: z.string().optional(),
  meetingTitle: z.string().optional(),
});

interface PlatformInfo {
  id: string;
  name: string;
  icon: string;
  capabilities: string[];
  createUrl: string;
  joinUrlPattern: string;
}

const platforms: PlatformInfo[] = [
  {
    id: "google-meet",
    name: "Google Meet",
    icon: "video",
    capabilities: ["video", "audio", "screen-share", "chat", "recording"],
    createUrl: "https://meet.google.com/new",
    joinUrlPattern: "https://meet.google.com/{code}",
  },
  {
    id: "microsoft-teams",
    name: "Microsoft Teams",
    icon: "users",
    capabilities: ["video", "audio", "screen-share", "chat", "recording", "whiteboard"],
    createUrl: "https://teams.microsoft.com/l/meeting/new",
    joinUrlPattern: "https://teams.microsoft.com/l/meetup-join/{code}",
  },
  {
    id: "zoom",
    name: "Zoom",
    icon: "monitor",
    capabilities: ["video", "audio", "screen-share", "chat", "recording", "breakout-rooms"],
    createUrl: "https://zoom.us/start/videomeeting",
    joinUrlPattern: "https://zoom.us/j/{code}",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "phone",
    capabilities: ["video", "audio", "share-link"],
    createUrl: "https://wa.me/",
    joinUrlPattern: "https://wa.me/?text={message}",
  },
];

function generateDeepLink(
  platform: string,
  meetingLink?: string,
  meetingTitle?: string
): { url: string; type: "create" | "share" } {
  const title = meetingTitle || "NeuraTalk Meeting";

  switch (platform) {
    case "google-meet":
      return {
        url: "https://meet.google.com/new",
        type: "create",
      };

    case "microsoft-teams":
      return {
        url: `https://teams.microsoft.com/l/meeting/new?subject=${encodeURIComponent(title)}`,
        type: "create",
      };

    case "zoom":
      return {
        url: "https://zoom.us/start/videomeeting",
        type: "create",
      };

    case "whatsapp": {
      const shareText = meetingLink
        ? `Join my ${title}: ${meetingLink}`
        : `Join my ${title} on NeuraTalk`;
      return {
        url: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
        type: "share",
      };
    }

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function registerMeetingLinkRoutes(app: Express) {
  app.post("/api/meetings/external-link", (req: Request, res: Response) => {
    try {
      const parsed = externalLinkSchema.parse(req.body);
      const result = generateDeepLink(
        parsed.platform,
        parsed.meetingLink,
        parsed.meetingTitle
      );

      res.json({
        success: true,
        platform: parsed.platform,
        url: result.url,
        type: result.type,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: "Invalid request",
          details: error.errors.map((e) => e.message),
        });
        return;
      }
      console.error("External link generation error:", error);
      res.status(500).json({ error: "Failed to generate external link" });
    }
  });

  app.get("/api/meetings/platforms", (_req: Request, res: Response) => {
    res.json({
      platforms: platforms.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        capabilities: p.capabilities,
        createUrl: p.createUrl,
      })),
    });
  });
}
