import { useRef, useCallback, useState } from "react";

interface NoiseSuppressionNodes {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  highPassFilter: BiquadFilterNode;
  noiseGate: GainNode;
  analyser: AnalyserNode;
  destination: MediaStreamAudioDestinationNode;
  animationFrame: number | null;
}

interface NoiseSuppressionOptions {
  highPassFrequency?: number;
  gateThreshold?: number;
  attackTime?: number;
  releaseTime?: number;
}

const DEFAULT_OPTIONS: Required<NoiseSuppressionOptions> = {
  highPassFrequency: 80,
  gateThreshold: 0.015,
  attackTime: 0.005,
  releaseTime: 0.05,
};

export function applyNoiseSuppression(
  stream: MediaStream,
  options?: NoiseSuppressionOptions
): { suppressedStream: MediaStream; cleanup: () => void } {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);

  const highPassFilter = audioContext.createBiquadFilter();
  highPassFilter.type = "highpass";
  highPassFilter.frequency.value = opts.highPassFrequency;
  highPassFilter.Q.value = 0.7;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;

  const noiseGate = audioContext.createGain();
  noiseGate.gain.value = 0;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(highPassFilter);
  highPassFilter.connect(analyser);
  highPassFilter.connect(noiseGate);
  noiseGate.connect(destination);

  const dataArray = new Float32Array(analyser.fftSize);
  let animationFrame: number | null = null;
  let isOpen = false;

  const processGate = () => {
    analyser.getFloatTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += Math.abs(dataArray[i]);
    }
    const rms = sum / dataArray.length;

    const now = audioContext.currentTime;

    if (rms > opts.gateThreshold) {
      if (!isOpen) {
        noiseGate.gain.cancelScheduledValues(now);
        noiseGate.gain.setTargetAtTime(1, now, opts.attackTime);
        isOpen = true;
      }
    } else {
      if (isOpen) {
        noiseGate.gain.cancelScheduledValues(now);
        noiseGate.gain.setTargetAtTime(0, now, opts.releaseTime);
        isOpen = false;
      }
    }

    animationFrame = requestAnimationFrame(processGate);
  };

  processGate();

  const cleanup = () => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame);
    }
    source.disconnect();
    highPassFilter.disconnect();
    noiseGate.disconnect();
    if (audioContext.state !== "closed") {
      audioContext.close();
    }
  };

  return { suppressedStream: destination.stream, cleanup };
}

export function useNoiseSuppression(options?: NoiseSuppressionOptions) {
  const [isActive, setIsActive] = useState(false);
  const nodesRef = useRef<NoiseSuppressionNodes | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const apply = useCallback(
    (stream: MediaStream): MediaStream => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      const { suppressedStream, cleanup } = applyNoiseSuppression(stream, options);
      cleanupRef.current = cleanup;
      setIsActive(true);
      return suppressedStream;
    },
    [options]
  );

  const remove = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setIsActive(false);
  }, []);

  return { isActive, apply, remove };
}
