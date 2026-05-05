import { useEffect, useMemo, useRef, useState } from 'react';
import NetInfo, { NetInfoState, NetInfoStateType } from '@react-native-community/netinfo';

type NetworkKind = 'wifi' | 'cellular' | 'ethernet' | 'vpn' | 'other' | 'unknown' | 'offline';

export interface NetworkStateSnapshot {
  isOnline: boolean;
  isInternetReachable: boolean;
  type: NetworkKind;
  cellularGeneration?: string;
  isConnectionExpensive: boolean;
  changedAt: number;
  hasTransitioned: boolean;
}

function mapNetInfoType(type: NetInfoStateType): NetworkKind {
  switch (type) {
    case 'wifi':
      return 'wifi';
    case 'cellular':
      return 'cellular';
    case 'ethernet':
      return 'ethernet';
    case 'vpn':
      return 'vpn';
    case 'none':
      return 'offline';
    case 'other':
      return 'other';
    default:
      return 'unknown';
  }
}

function toSnapshot(state: NetInfoState, previous?: NetworkStateSnapshot): NetworkStateSnapshot {
  const isOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
  const type = isOnline ? mapNetInfoType(state.type) : 'offline';
  const hasTransitioned = previous
    ? previous.isOnline !== isOnline || previous.type !== type
    : false;

  return {
    isOnline,
    isInternetReachable: state.isInternetReachable !== false,
    type,
    cellularGeneration: state.details && 'cellularGeneration' in state.details
      ? String(state.details.cellularGeneration || '')
      : undefined,
    isConnectionExpensive: Boolean(
      state.details && 'isConnectionExpensive' in state.details && state.details.isConnectionExpensive,
    ),
    changedAt: hasTransitioned ? Date.now() : previous?.changedAt ?? Date.now(),
    hasTransitioned,
  };
}

export function useNetworkState(): NetworkStateSnapshot {
  const previousRef = useRef<NetworkStateSnapshot | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<NetworkStateSnapshot>({
    isOnline: true,
    isInternetReachable: true,
    type: 'unknown',
    isConnectionExpensive: false,
    changedAt: Date.now(),
    hasTransitioned: false,
  });

  useEffect(() => {
    let mounted = true;

    NetInfo.fetch().then((state: NetInfoState) => {
      if (!mounted) {
        return;
      }

      const next = toSnapshot(state, previousRef.current);
      previousRef.current = next;
      setSnapshot(next);
    }).catch(() => undefined);

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const next = toSnapshot(state, previousRef.current);
      previousRef.current = next;
      setSnapshot(next);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return useMemo(() => snapshot, [snapshot]);
}
