import { AudioSession, registerGlobals } from '@livekit/react-native';
import {
  ConnectionState,
  DataPacket_Kind,
  DisconnectReason,
  Participant,
  Room,
  RoomConnectOptions,
  RoomEvent,
  RoomOptions,
} from 'livekit-client';

registerGlobals();

export interface LiveKitJoinParams {
  url: string;
  token: string;
  callId: string;
}

export interface LiveKitRoomSnapshot {
  callId?: string;
  roomName?: string;
  participantCount: number;
  hasRemoteAudio: boolean;
  connectionState: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  lastDisconnectReason?: string;
}

type SnapshotHandler = (snapshot: LiveKitRoomSnapshot) => void;
type DataHandler = (message: any, topic?: string) => void;

const roomOptions: RoomOptions = {
  adaptiveStream: true,
  dynacast: true,
};

const connectOptions: RoomConnectOptions = {
  autoSubscribe: true,
};

function mapState(state: ConnectionState): LiveKitRoomSnapshot['connectionState'] {
  switch (state) {
    case ConnectionState.Connected:
      return 'connected';
    case ConnectionState.Connecting:
      return 'connecting';
    case ConnectionState.Reconnecting:
      return 'reconnecting';
    default:
      return 'disconnected';
  }
}

class LiveKitService {
  private room: Room | null = null;
  private currentSession: LiveKitJoinParams | null = null;
  private snapshotHandlers: SnapshotHandler[] = [];
  private dataHandlers: DataHandler[] = [];
  private snapshot: LiveKitRoomSnapshot = {
    participantCount: 0,
    hasRemoteAudio: false,
    connectionState: 'disconnected',
  };
  private isLeaving = false;

  private emitSnapshot(partial?: Partial<LiveKitRoomSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
    };
    this.snapshotHandlers.forEach((handler) => handler(this.snapshot));
  }

  private bindRoom(room: Room, session: LiveKitJoinParams) {
    room
      .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        this.emitSnapshot({
          callId: session.callId,
          roomName: room.name,
          connectionState: mapState(state),
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
          lastDisconnectReason: state === ConnectionState.Disconnected ? this.snapshot.lastDisconnectReason : undefined,
        });
      })
      .on(RoomEvent.ParticipantConnected, () => {
        this.emitSnapshot({
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
        });
      })
      .on(RoomEvent.ParticipantDisconnected, () => {
        this.emitSnapshot({
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
        });
      })
      .on(RoomEvent.TrackSubscribed, () => {
        this.emitSnapshot({
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
        });
      })
      .on(RoomEvent.TrackUnsubscribed, () => {
        this.emitSnapshot({
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
        });
      })
      .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
        this.emitSnapshot({
          connectionState: this.isLeaving ? 'disconnected' : 'reconnecting',
          lastDisconnectReason: reason ? String(reason) : 'unknown',
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: false,
        });
      })
      .on(RoomEvent.Reconnecting, () => {
        this.emitSnapshot({
          connectionState: 'reconnecting',
          participantCount: room.remoteParticipants.size,
        });
      })
      .on(RoomEvent.Reconnected, () => {
        this.emitSnapshot({
          connectionState: 'connected',
          participantCount: room.remoteParticipants.size,
          hasRemoteAudio: this.computeHasRemoteAudio(room),
          lastDisconnectReason: undefined,
        });
      })
      .on(RoomEvent.DataReceived, (payload: Uint8Array, _participant, _kind?: DataPacket_Kind, topic?: string) => {
        try {
          const decoded = new TextDecoder().decode(payload);
          const message = JSON.parse(decoded);
          this.dataHandlers.forEach((handler) => handler(message, topic));
        } catch {
          // Ignore malformed realtime messages instead of breaking media.
        }
      });
  }

  private computeHasRemoteAudio(room: Room): boolean {
    return Array.from(room.remoteParticipants.values()).some((participant: Participant) =>
      participant.audioTrackPublications.size > 0,
    );
  }

  async joinRoom(params: LiveKitJoinParams): Promise<LiveKitRoomSnapshot> {
    if (this.currentSession &&
      this.currentSession.callId === params.callId &&
      this.snapshot.connectionState === 'connected') {
      return this.snapshot;
    }

    if (this.room) {
      await this.leaveRoom();
    }

    this.isLeaving = false;
    this.currentSession = params;

    const room = new Room(roomOptions);
    this.room = room;
    this.bindRoom(room, params);

    this.emitSnapshot({
      callId: params.callId,
      roomName: undefined,
      participantCount: 0,
      hasRemoteAudio: false,
      connectionState: 'connecting',
      lastDisconnectReason: undefined,
    });

    await AudioSession.startAudioSession();
    await room.connect(params.url, params.token, connectOptions);

    this.emitSnapshot({
      callId: params.callId,
      roomName: room.name,
      participantCount: room.remoteParticipants.size,
      hasRemoteAudio: this.computeHasRemoteAudio(room),
      connectionState: mapState(room.state),
    });

    return this.snapshot;
  }

  async revalidateMediaSession(): Promise<LiveKitRoomSnapshot> {
    if (!this.currentSession) {
      throw new Error('No active LiveKit session to revalidate');
    }

    if (this.room && this.room.state !== ConnectionState.Disconnected) {
      this.emitSnapshot({
        connectionState: mapState(this.room.state),
        participantCount: this.room.remoteParticipants.size,
        hasRemoteAudio: this.computeHasRemoteAudio(this.room),
      });
      return this.snapshot;
    }

    return this.joinRoom(this.currentSession);
  }

  async leaveRoom(): Promise<void> {
    this.isLeaving = true;

    if (this.room) {
      await this.room.disconnect();
      this.room.removeAllListeners();
      this.room = null;
    }

    await AudioSession.stopAudioSession();
    this.currentSession = null;
    this.emitSnapshot({
      callId: undefined,
      roomName: undefined,
      participantCount: 0,
      hasRemoteAudio: false,
      connectionState: 'disconnected',
    });
    this.isLeaving = false;
  }

  async setLocalAudioEnabled(enabled: boolean): Promise<void> {
    if (!this.room?.localParticipant) {
      return;
    }

    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  async publishControlMessage(message: Record<string, unknown>, topic = 'translation-control'): Promise<void> {
    if (!this.room?.localParticipant) {
      return;
    }

    await this.room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(message)),
      {
        reliable: true,
        topic,
      },
    );
  }

  getSnapshot(): LiveKitRoomSnapshot {
    return this.snapshot;
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.push(handler);
    return () => {
      this.snapshotHandlers = this.snapshotHandlers.filter((entry) => entry !== handler);
    };
  }

  onDataMessage(handler: DataHandler): () => void {
    this.dataHandlers.push(handler);
    return () => {
      this.dataHandlers = this.dataHandlers.filter((entry) => entry !== handler);
    };
  }
}

export const liveKitService = new LiveKitService();
