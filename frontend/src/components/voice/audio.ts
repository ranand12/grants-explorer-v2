// Low-latency audio for Gemini Live.
//
// v1 used a deprecated ScriptProcessor and one 16 kHz AudioContext for both
// directions. v2 uses AudioWorklets on the audio thread:
//   capture  — native-rate mic → low-passed decimation → 16 kHz PCM16, 40 ms chunks
//   playback — 24 kHz PCM16 into a ring buffer; `flush()` drops queued audio
//              instantly when the user barges in.
// Both worklets report RMS levels for the audio-reactive orb.

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.ratio = sampleRate / 16000;
    this.chunk = 640; // 40 ms @ 16 kHz
    this.out = new Int16Array(this.chunk);
    this.n = 0;
    this.acc = 0; this.accN = 0; this.pos = 0;
    this.levelAcc = 0; this.levelN = 0;
    this.muted = false;
    this.port.onmessage = (e) => { if (e.data && e.data.type === 'mute') this.muted = e.data.value; };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = this.muted ? 0 : ch[i];
      this.levelAcc += s * s; this.levelN++;
      // box-filter decimation: average every ratio samples (cheap anti-alias)
      this.acc += s; this.accN++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accN));
        this.acc = 0; this.accN = 0;
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.chunk) {
          const buf = this.out.slice().buffer;
          const level = Math.sqrt(this.levelAcc / Math.max(this.levelN, 1));
          this.levelAcc = 0; this.levelN = 0;
          this.port.postMessage({ pcm: buf, level }, [buf]);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('gl-capture', Capture);
`;

const PLAYBACK_WORKLET = `
class Playback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 24000 * 180; // 3 min ring buffer
    this.buf = new Float32Array(this.size);
    this.r = 0; this.w = 0; this.count = 0;
    this.levelAcc = 0; this.levelN = 0; this.frames = 0;
    this.playing = false;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'flush') { this.r = this.w = this.count = 0; return; }
      if (d.type === 'pcm') {
        const pcm = new Int16Array(d.pcm);
        for (let i = 0; i < pcm.length; i++) {
          if (this.count === this.size) { this.r = (this.r + 1) % this.size; this.count--; }
          this.buf[this.w] = pcm[i] / 0x8000;
          this.w = (this.w + 1) % this.size; this.count++;
        }
      }
    };
  }
  process(_, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.count > 0) {
        const s = this.buf[this.r];
        out[i] = s; this.levelAcc += s * s;
        this.r = (this.r + 1) % this.size; this.count--;
      } else out[i] = 0;
      this.levelN++;
    }
    if (++this.frames % 8 === 0) {
      const playing = this.count > 0;
      this.port.postMessage({ level: Math.sqrt(this.levelAcc / Math.max(this.levelN, 1)), playing, queuedMs: this.count / 24 });
      this.levelAcc = 0; this.levelN = 0;
    }
    return true;
  }
}
registerProcessor('gl-playback', Playback);
`;

const moduleUrl = (src: string) => URL.createObjectURL(new Blob([src], { type: "application/javascript" }));

export class MicCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;

  constructor(private onChunk: (pcm: ArrayBuffer) => void, private onLevel: (level: number) => void) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(moduleUrl(CAPTURE_WORKLET));
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "gl-capture");
    this.node.port.onmessage = (e) => {
      this.onChunk(e.data.pcm);
      this.onLevel(e.data.level);
    };
    src.connect(this.node);
    // Worklet must be pulled by the graph; route through a muted gain
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
  }

  setMuted(muted: boolean) {
    this.node?.port.postMessage({ type: "mute", value: muted });
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}

export class Speaker {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  playing = false;

  constructor(private onLevel: (level: number, playing: boolean) => void) {}

  async start() {
    this.ctx = new AudioContext({ sampleRate: 24000, latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(moduleUrl(PLAYBACK_WORKLET));
    this.node = new AudioWorkletNode(this.ctx, "gl-playback", { outputChannelCount: [1] });
    this.node.port.onmessage = (e) => {
      this.playing = e.data.playing;
      this.onLevel(e.data.level, e.data.playing);
    };
    this.node.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  play(pcm16: ArrayBuffer) {
    this.node?.port.postMessage({ type: "pcm", pcm: pcm16 }, [pcm16]);
  }

  flush() {
    this.node?.port.postMessage({ type: "flush" });
  }

  stop() {
    this.node?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}

export function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Streams ~1 fps JPEG frames (≤768px) from a screen share or camera. */
export class FrameStreamer {
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setInterval>;
  private video = typeof document !== "undefined" ? document.createElement("video") : undefined;
  private canvas = typeof document !== "undefined" ? document.createElement("canvas") : undefined;

  constructor(private onFrame: (b64: string) => void, private onEnded: () => void) {}

  get mediaStream() {
    return this.stream;
  }

  async start(kind: "screen" | "camera") {
    this.stream =
      kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
    this.stream.getVideoTracks()[0].addEventListener("ended", () => { this.stop(); this.onEnded(); });
    const video = this.video!;
    video.srcObject = this.stream;
    video.muted = true;
    await video.play();
    this.timer = setInterval(() => this.capture(), 1000);
  }

  private capture() {
    const video = this.video!, canvas = this.canvas!;
    if (!video.videoWidth) return;
    const scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    this.onFrame(url.slice(url.indexOf(",") + 1));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }
}
