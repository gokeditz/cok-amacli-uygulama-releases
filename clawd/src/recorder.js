// Klip kaydı: WebGL tuvali + müzik çıkışı → indirilebilir video.
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];

export class ClipRecorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.rec = null;
    this.startedAt = 0;
  }

  get supported() {
    return typeof MediaRecorder !== 'undefined' && !!this.canvas.captureStream;
  }

  get recording() {
    return !!this.rec;
  }

  get elapsed() {
    return this.rec ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  start(audioStream) {
    this.begin(audioStream);
    this.startedAt = performance.now();
  }

  begin(audioStream) {
    const stream = this.canvas.captureStream(60);
    if (audioStream) for (const t of audioStream.getAudioTracks()) stream.addTrack(t);
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    this.mime = mimeType || 'video/webm';
    this.chunks = [];
    this.bytes = 0;
    this.rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 10_000_000 } : undefined);
    this.rec.ondataavailable = (e) => {
      if (e.data.size) { this.chunks.push(e.data); this.bytes += e.data.size; }
    };
    this.rec.start(250);
  }

  stop() {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec) return resolve(null);
      rec.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.mime.split(';')[0] }));
        this.chunks = [];
      };
      rec.stop();
      this.rec = null;
    });
  }
}
