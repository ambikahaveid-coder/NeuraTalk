import { Room, RoomEvent } from "livekit-client";

export class NeuraTalkCommunicationClient {
  constructor({ apiBaseUrl, apiKey }) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.room = null;
    this.ws = null;
  }

  async createCallSession(payload) {
    const response = await fetch(`${this.apiBaseUrl}/api/communication/create-call-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`create-call-session failed: ${response.status}`);
    }

    return await response.json();
  }

  async connectParticipant(session, role, localTracks = []) {
    const token = role === "caller" ? session.livekit.callerToken : session.livekit.calleeToken;
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        dtx: true,
        videoCodec: "vp8",
      },
    });

    this.room.on(RoomEvent.Connected, async () => {
      await this.updateStatus(session.sessionId, { state: "joined", participantIdentity: role === "caller" ? "caller" : "callee" });
    });
    this.room.on(RoomEvent.Disconnected, async () => {
      await this.updateStatus(session.sessionId, { state: "left", participantIdentity: role === "caller" ? "caller" : "callee" });
    });
    this.room.on(RoomEvent.ConnectionStateChanged, async (state) => {
      if (state === "failed") {
        await this.updateStatus(session.sessionId, { state: "failed", participantIdentity: role });
        await this.activateFallback(session.sessionId);
      }
    });

    await this.room.connect(session.livekit.url, token);
    for (const track of localTracks) {
      await this.room.localParticipant.publishTrack(track);
    }
    return this.room;
  }

  connectRealtime(sessionId, onEvent) {
    const baseWs = this.apiBaseUrl.replace(/^http/i, "ws");
    this.ws = new WebSocket(`${baseWs}/ws/communication-api?session_id=${encodeURIComponent(sessionId)}&api_key=${encodeURIComponent(this.apiKey)}`);
    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      onEvent(parsed);
    };
    return this.ws;
  }

  async updateStatus(sessionId, payload) {
    const response = await fetch(`${this.apiBaseUrl}/api/communication/call-status/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`status update failed: ${response.status}`);
    return await response.json();
  }

  async activateFallback(sessionId) {
    const response = await fetch(`${this.apiBaseUrl}/api/communication/sessions/${encodeURIComponent(sessionId)}/fallback`, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
      },
    });
    if (!response.ok) throw new Error(`fallback failed: ${response.status}`);
    return await response.json();
  }

  async endCall(sessionId, reason = "sdk_end") {
    const response = await fetch(`${this.apiBaseUrl}/api/communication/end-call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({ sessionId, reason }),
    });
    if (!response.ok) throw new Error(`end-call failed: ${response.status}`);
    return await response.json();
  }
}
