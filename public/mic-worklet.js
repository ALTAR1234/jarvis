// Forwards raw microphone samples to the main thread in ~40 ms blocks.
class MicCapture extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(Math.round(sampleRate * 0.04)); this.filled = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.block[this.filled++] = channel[i];
      if (this.filled === this.block.length) { this.port.postMessage(this.block.slice()); this.filled = 0; }
    }
    return true;
  }
}
registerProcessor('mic-capture', MicCapture);
