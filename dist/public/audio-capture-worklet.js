class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameSize = 320; // 20ms at 16kHz
    this.pending = new Float32Array(this.frameSize * 8);
    this.pendingLength = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    this.append(channel);
    return true;
  }

  append(chunk) {
    if (this.pendingLength + chunk.length > this.pending.length) {
      const grown = new Float32Array((this.pendingLength + chunk.length) * 2);
      grown.set(this.pending.subarray(0, this.pendingLength));
      this.pending = grown;
    }

    this.pending.set(chunk, this.pendingLength);
    this.pendingLength += chunk.length;

    while (this.pendingLength >= this.frameSize) {
      const frame = new Float32Array(this.frameSize);
      frame.set(this.pending.subarray(0, this.frameSize));

      let sum = 0;
      for (let i = 0; i < frame.length; i += 1) {
        sum += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sum / frame.length);

      this.port.postMessage({
        type: "frame",
        samples: frame,
        rms,
      }, [frame.buffer]);

      this.pending.copyWithin(0, this.frameSize, this.pendingLength);
      this.pendingLength -= this.frameSize;
    }
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
