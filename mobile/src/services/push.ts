import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { callApi, deviceApi } from './api';
import { NativeTelephony } from '../native/telephony';

export interface IncomingCallInvite {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: 'voice' | 'video';
  livekitUrl?: string;
  livekitToken?: string;
}

interface PushBootstrapOptions {
  deviceId: string;
  onIncomingCall: (invite: IncomingCallInvite) => void;
}

interface VoipBridge {
  registerVoipPush?: () => Promise<void>;
  getVoipPushToken?: () => Promise<string | null>;
}

const { NeuraTalkVoipPush } = NativeModules as {
  NeuraTalkVoipPush?: VoipBridge;
};

function getStringField(
  data: Record<string, string | object> | undefined,
  key: string,
): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' ? value : undefined;
}

function parseIncomingCall(data?: Record<string, string | object>): IncomingCallInvite | null {
  const type = getStringField(data, 'type');
  const callId = getStringField(data, 'callId');
  const callerId = getStringField(data, 'callerId');
  const callType = getStringField(data, 'callType');

  if (!type || type !== 'incoming_call' || !callId || !callerId || !callType) {
    return null;
  }

  return {
    callId,
    callerId,
    callerName: getStringField(data, 'callerName') || callerId,
    callType: callType === 'video' ? 'video' : 'voice',
    livekitUrl: getStringField(data, 'livekitUrl'),
    livekitToken: getStringField(data, 'livekitToken'),
  };
}

class PushService {
  private foregroundUnsubscribe: (() => void) | null = null;
  private tokenRefreshUnsubscribe: (() => void) | null = null;
  private voipEmitter: NativeEventEmitter | null = null;
  private voipTokenSubscription: { remove: () => void } | null = null;
  private currentDeviceId: string | null = null;

  async initialize({ deviceId, onIncomingCall }: PushBootstrapOptions): Promise<void> {
    this.currentDeviceId = deviceId;

    await this.registerFirebasePermissions();
    await this.syncTokens(deviceId);

    this.foregroundUnsubscribe?.();
    this.foregroundUnsubscribe = messaging().onMessage(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
      const invite = parseIncomingCall(remoteMessage.data);
      if (!invite) {
        return;
      }

      await NativeTelephony.showIncomingCall(invite.callId, invite.callerName || invite.callerId).catch(() => undefined);
      onIncomingCall(invite);
    });

    this.tokenRefreshUnsubscribe?.();
    this.tokenRefreshUnsubscribe = messaging().onTokenRefresh(async (token: string) => {
      if (!this.currentDeviceId) {
        return;
      }
      await deviceApi.updateToken(this.currentDeviceId, { pushToken: token });
    });

    if (Platform.OS === 'ios' && NeuraTalkVoipPush) {
      this.voipEmitter = new NativeEventEmitter(NeuraTalkVoipPush as never);
      this.voipTokenSubscription?.remove();
      this.voipTokenSubscription = this.voipEmitter.addListener('onVoipToken', async (event: { token?: string }) => {
        if (!this.currentDeviceId || !event?.token) {
          return;
        }
        await deviceApi.updateToken(this.currentDeviceId, { voipToken: event.token });
      });
      await NeuraTalkVoipPush.registerVoipPush?.().catch(() => undefined);
    }
  }

  async syncTokens(deviceId: string): Promise<void> {
    const pushToken = await messaging().getToken().catch(() => null);
    let voipToken: string | null = null;

    if (Platform.OS === 'ios' && NeuraTalkVoipPush?.getVoipPushToken) {
      voipToken = await NeuraTalkVoipPush.getVoipPushToken().catch(() => null);
    }

    await deviceApi.updateToken(deviceId, {
      pushToken: pushToken || undefined,
      voipToken: voipToken || undefined,
    }).catch(() => undefined);
  }

  async recoverPendingIncomingCall(): Promise<IncomingCallInvite | null> {
    const response = await callApi.getIncoming().catch(() => null);
    if (!response?.incoming) {
      return null;
    }

    return {
      callId: response.incoming.callId,
      callerId: response.incoming.callerId,
      callerName: response.incoming.callerName,
      callType: response.incoming.callType === 'video' ? 'video' : 'voice',
      livekitUrl: response.incoming.livekitUrl,
      livekitToken: response.incoming.livekitToken,
    };
  }

  async rejectIncomingCall(callId: string): Promise<void> {
    await callApi.rejectIncoming(callId).catch(() => undefined);
  }

  teardown(): void {
    this.foregroundUnsubscribe?.();
    this.foregroundUnsubscribe = null;
    this.tokenRefreshUnsubscribe?.();
    this.tokenRefreshUnsubscribe = null;
    this.voipTokenSubscription?.remove();
    this.voipTokenSubscription = null;
    this.currentDeviceId = null;
  }

  private async registerFirebasePermissions(): Promise<void> {
    await messaging().registerDeviceForRemoteMessages();
    await messaging().requestPermission({
      announcement: false,
      badge: true,
      carPlay: false,
      provisional: false,
      sound: true,
      alert: true,
    });
  }
}

export const pushService = new PushService();

export function registerBackgroundIncomingCallHandler(): void {
  messaging().setBackgroundMessageHandler(async (remoteMessage: FirebaseMessagingTypes.RemoteMessage) => {
    const invite = parseIncomingCall(remoteMessage.data);
    if (!invite) {
      return;
    }

    await NativeTelephony.showIncomingCall(invite.callId, invite.callerName || invite.callerId).catch(() => undefined);
  });
}
