/**
 * Decides which remote audio tracks a call participant should hear.
 *
 * The translator bot publishes one track per (speaker, listener) pair named
 * `translated-for-<listener>-from-<speaker>`. In voice mode a listener hears
 * their own translated tracks and the speaker's original voice is silenced
 * only while that speaker's translation track is present, so the call never
 * goes silent when translation is missing. Same rule as the Flutter app.
 */

export interface RemoteAudioTrackInfo {
  participantIdentity: string;
  isBot: boolean;
  trackName?: string;
}

/** The speaker a translated track carries for this listener, or null. */
export function translatedSpeakerFor(trackName: string | undefined, localIdentity: string): string | null {
  const prefix = `translated-for-${encodeURIComponent(localIdentity)}-from-`;
  if (!trackName || !trackName.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(trackName.slice(prefix.length));
  } catch {
    return null;
  }
}

/** One entry per input track: whether its audio should play. */
export function decideAudioRouting(
  tracks: RemoteAudioTrackInfo[],
  localIdentity: string,
  voiceMode: boolean,
): boolean[] {
  const translatedSpeakers = new Set<string>();
  if (voiceMode) {
    for (const track of tracks) {
      if (!track.isBot) continue;
      const speaker = translatedSpeakerFor(track.trackName, localIdentity);
      if (speaker) translatedSpeakers.add(speaker);
    }
  }

  return tracks.map((track) => {
    if (track.isBot) {
      // Translations meant for someone else (including our own words) never play.
      return voiceMode && translatedSpeakerFor(track.trackName, localIdentity) !== null;
    }
    return !translatedSpeakers.has(track.participantIdentity);
  });
}
