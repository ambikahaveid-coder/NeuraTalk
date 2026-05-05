declare const __DEV__: boolean;

interface RTCSessionDescriptionInit {
  type?: string;
  sdp?: string;
}

interface RTCIceCandidate {
  toJSON(): unknown;
}
