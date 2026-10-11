import type { Asset } from "../../../shared/contracts.js";
import {
  audioPreferencesSchema,
  DEFAULT_AUDIO_PREFERENCES,
  isAudioAsset,
  type AudioPreferences,
  type VolumeChannel,
} from "../../../shared/audio.js";
export type { AudioPreferences, VolumeChannel } from "../../../shared/audio.js";

export interface AudioSnapshot {
  enabled: boolean;
  music: {
    asset: Asset | null;
    status: "stopped" | "loading" | "playing" | "paused";
    currentTime: number;
    duration: number;
  };
  queue: Asset[];
  queueIndex: number;
  ambience: Array<{
    asset: Asset;
    volume: number;
    status: "loading" | "playing";
  }>;
  effectCount: number;
  preferences: AudioPreferences;
  error: string | null;
}
interface Stream {
  asset: Asset;
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain?: GainNode;
  operation: number;
  closed: boolean;
  cleanup: () => void;
}
const MIB = 1024 * 1024;
const MAX_EFFECT_FILE = 16 * MIB;
const MAX_CACHE = 32 * MIB;
const MAX_DECODED = 64 * MIB;
const bufferBytes = (buffer: AudioBuffer) =>
  buffer.length * buffer.numberOfChannels * 4;
const level = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Owned by the administrator session, independently of scenes and panel mounting. */
export class AudioEngine {
  private context: AudioContext | null = null;
  private gains: Record<VolumeChannel, GainNode> | null = null;
  private music: Stream | null = null;
  private ambience = new Map<string, Stream>();
  private effects = new Map<AudioBufferSourceNode, string>();
  private removedAssets = new Set<string>();
  private cache = new Map<string, AudioBuffer>();
  private pending = new Map<
    string,
    { promise: Promise<AudioBuffer>; controller: AbortController }
  >();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private activeLoads = 0;
  private shuffleOrder: number[] = [];
  private disposed = false;
  private snapshot: AudioSnapshot = {
    enabled: false,
    music: { asset: null, status: "stopped", currentTime: 0, duration: 0 },
    queue: [],
    queueIndex: -1,
    ambience: [],
    effectCount: 0,
    preferences: structuredClone(DEFAULT_AUDIO_PREFERENCES),
    error: null,
  };
  getSnapshot = (): AudioSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<AudioSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private fail(error: unknown) {
    if (!this.disposed)
      this.update({
        error:
          error instanceof Error ? error.message : "Audio playback failed.",
      });
  }
  clearError() {
    this.update({ error: null });
  }

  async enable(): Promise<void> {
    if (this.disposed) return;
    try {
      // Creation and resume run directly in the user gesture, never during import or construction.
      if (!this.context) {
        this.context = new AudioContext();
        const master = this.context.createGain();
        master.connect(this.context.destination);
        const music = this.context.createGain();
        music.connect(master);
        const ambience = this.context.createGain();
        ambience.connect(master);
        const effects = this.context.createGain();
        effects.connect(master);
        this.gains = { master, music, ambience, effects };
        this.applyGains();
      }
      await this.context.resume();
      if (!this.disposed) this.update({ enabled: true, error: null });
    } catch (error) {
      this.fail(error);
    }
  }
  private ready(asset?: Asset): AudioContext {
    if (this.disposed || !this.snapshot.enabled || !this.context)
      throw new Error("Enable Audio before playing a sound.");
    if (asset && this.removedAssets.has(asset.id))
      throw new Error("This audio asset has been deleted.");
    if (
      asset &&
      (!isAudioAsset(asset) ||
        !["music", "ambience", "effect"].includes(asset.category))
    )
      throw new Error("Choose an audio asset.");
    return this.context;
  }
  private applyGains() {
    if (this.gains)
      for (const channel of Object.keys(this.gains) as VolumeChannel[])
        this.gains[channel].gain.value =
          this.snapshot.preferences.volumes[channel];
    for (const [id, stream] of this.ambience)
      if (stream.gain)
        stream.gain.gain.value =
          this.snapshot.preferences.ambienceVolumes[id] ?? 1;
  }
  applyPreferences(preferences: AudioPreferences) {
    const parsed = audioPreferencesSchema.safeParse(preferences);
    if (!parsed.success) {
      this.fail(new Error("Invalid audio preferences."));
      return;
    }
    const shuffleChanged =
      parsed.data.shuffle !== this.snapshot.preferences.shuffle;
    this.update({ preferences: parsed.data });
    if (shuffleChanged) this.resetShuffleOrder(this.snapshot.queueIndex);
    this.applyGains();
    this.updateAmbience();
  }
  setVolume(channel: VolumeChannel, value: number) {
    this.applyPreferences({
      ...this.snapshot.preferences,
      volumes: {
        ...this.snapshot.preferences.volumes,
        [channel]: level(value),
      },
    });
  }
  setMusicLoop(value: boolean) {
    this.applyPreferences({ ...this.snapshot.preferences, musicLoop: value });
  }
  setShuffle(value: boolean) {
    this.applyPreferences({ ...this.snapshot.preferences, shuffle: value });
  }
  setAmbienceVolume(id: string, value: number) {
    this.applyPreferences({
      ...this.snapshot.preferences,
      ambienceVolumes: {
        ...this.snapshot.preferences.ambienceVolumes,
        [id]: level(value),
      },
    });
  }

  private createStream(asset: Asset, category: "music" | "ambience"): Stream {
    const context = this.ready(asset);
    const element = new Audio();
    element.preload = "metadata";
    element.src = `/media/${encodeURIComponent(asset.id)}`;
    element.loop = category === "ambience";
    const source = context.createMediaElementSource(element);
    const gain = category === "ambience" ? context.createGain() : undefined;
    if (gain) {
      gain.gain.value =
        this.snapshot.preferences.ambienceVolumes[asset.id] ?? 1;
      source.connect(gain);
      gain.connect(this.gains!.ambience);
    } else source.connect(this.gains!.music);
    return {
      asset,
      element,
      source,
      gain,
      operation: 0,
      closed: false,
      cleanup: () => {},
    };
  }
  private closeStream(stream: Stream) {
    if (stream.closed) return;
    stream.closed = true;
    stream.operation++;
    stream.cleanup();
    stream.element.pause();
    stream.element.removeAttribute("src");
    stream.element.load();
    stream.source.disconnect();
    stream.gain?.disconnect();
  }
  private async playStream(stream: Stream, category: "music" | "ambience") {
    const operation = ++stream.operation;
    try {
      const context = this.ready();
      if (context.state === "suspended") await context.resume();
      if (stream.closed || operation !== stream.operation) return;
      await stream.element.play();
      if (stream.closed || operation !== stream.operation) {
        // Pause/stop can happen while a browser is still resolving play().
        if (
          stream.closed ||
          (category === "music" && this.snapshot.music.status === "paused")
        )
          stream.element.pause();
        return;
      }
      if (category === "music")
        this.update({ music: { ...this.snapshot.music, status: "playing" } });
      else this.updateAmbience(stream.asset.id);
    } catch (error) {
      if (stream.closed || operation !== stream.operation) return;
      if (category === "music") {
        stream.element.pause();
        this.update({ music: { ...this.snapshot.music, status: "paused" } });
      } else this.stopAmbience(stream.asset.id);
      this.fail(error);
    }
  }
  async playMusic(asset: Asset): Promise<void> {
    await this.setQueue([asset]);
  }
  async setQueue(queue: Asset[], index = 0): Promise<void> {
    try {
      this.ready();
      for (const asset of queue) this.ready(asset);
      if (
        queue.length &&
        (!Number.isInteger(index) || index < 0 || index >= queue.length)
      )
        throw new Error("Invalid playlist position.");
      this.stopMusic();
      this.update({ queue: [...queue], queueIndex: queue.length ? index : -1 });
      this.resetShuffleOrder(index);
      if (queue.length) await this.playQueueIndex(index);
    } catch (error) {
      this.fail(error);
    }
  }
  private async playQueueIndex(index: number) {
    try {
      const asset = this.snapshot.queue[index];
      if (!asset) return;
      if (this.music) this.closeStream(this.music);
      const stream = this.createStream(asset, "music");
      this.music = stream;
      this.update({
        queueIndex: index,
        music: { asset, status: "loading", currentTime: 0, duration: 0 },
        error: null,
      });
      const progress = () => {
        if (this.music !== stream || stream.closed) return;
        this.update({
          music: {
            ...this.snapshot.music,
            currentTime: Number.isFinite(stream.element.currentTime)
              ? stream.element.currentTime
              : 0,
            duration: Number.isFinite(stream.element.duration)
              ? stream.element.duration
              : 0,
          },
        });
      };
      const ended = () => {
        if (this.music === stream && !stream.closed) void this.advance(false);
      };
      const error = () => {
        if (this.music === stream && !stream.closed) {
          this.stopMusic();
          this.fail(
            new Error(
              `Cannot play “${asset.name}”. The file may be missing or unsupported by this browser.`,
            ),
          );
        }
      };
      stream.element.addEventListener("timeupdate", progress);
      stream.element.addEventListener("loadedmetadata", progress);
      stream.element.addEventListener("durationchange", progress);
      stream.element.addEventListener("ended", ended);
      stream.element.addEventListener("error", error);
      stream.cleanup = () => {
        stream.element.removeEventListener("timeupdate", progress);
        stream.element.removeEventListener("loadedmetadata", progress);
        stream.element.removeEventListener("durationchange", progress);
        stream.element.removeEventListener("ended", ended);
        stream.element.removeEventListener("error", error);
      };
      await this.playStream(stream, "music");
    } catch (error) {
      this.stopMusic();
      this.fail(error);
    }
  }
  pauseMusic() {
    if (this.music) {
      this.music.operation++;
      this.music.element.pause();
      this.update({ music: { ...this.snapshot.music, status: "paused" } });
    }
  }
  async resumeMusic(): Promise<void> {
    if (this.music) await this.playStream(this.music, "music");
    else if (this.snapshot.queueIndex >= 0)
      await this.playQueueIndex(this.snapshot.queueIndex);
    else if (this.snapshot.queue.length)
      await this.playQueueIndex(
        this.snapshot.preferences.shuffle ? this.shuffleOrder[0] : 0,
      );
  }
  stopMusic() {
    if (this.music) this.closeStream(this.music);
    this.music = null;
    this.update({
      music: { ...this.snapshot.music, status: "stopped", currentTime: 0 },
    });
  }
  private shuffled(indices: number[]): number[] {
    for (let i = indices.length - 1; i > 0; i--) {
      const other = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[other]] = [indices[other], indices[i]];
    }
    return indices;
  }
  private resetShuffleOrder(start: number) {
    const indices = this.snapshot.queue.map((_, index) => index);
    this.shuffleOrder =
      start >= 0 && start < indices.length
        ? [start, ...this.shuffled(indices.filter((index) => index !== start))]
        : this.shuffled(indices);
  }
  private async advance(manual: boolean, direction = 1) {
    const { queue, queueIndex, preferences } = this.snapshot;
    if (!queue.length) return;
    const order = preferences.shuffle
      ? this.shuffleOrder
      : queue.map((_, index) => index);
    const position = order.indexOf(queueIndex);
    if (position < 0) {
      await this.playQueueIndex(
        direction > 0 ? order[0] : order[order.length - 1],
      );
      return;
    }
    if (!manual && position === order.length - 1) {
      if (!preferences.musicLoop) {
        this.stopMusic();
        return;
      }
      if (preferences.shuffle) {
        this.shuffleOrder = this.shuffled(queue.map((_, index) => index));
        // A new cycle includes every entry, without repeating the boundary track.
        if (queue.length > 1 && this.shuffleOrder[0] === queueIndex) {
          [this.shuffleOrder[0], this.shuffleOrder[1]] = [
            this.shuffleOrder[1],
            this.shuffleOrder[0],
          ];
        }
        await this.playQueueIndex(this.shuffleOrder[0]);
        return;
      }
    }
    await this.playQueueIndex(
      order[(position + direction + order.length) % order.length],
    );
  }
  async next() {
    await this.advance(true);
  }
  async previous() {
    await this.advance(true, -1);
  }
  seek(seconds: number) {
    if (!this.music || !Number.isFinite(seconds)) return;
    try {
      const duration = this.music.element.duration;
      this.music.element.currentTime = Math.max(
        0,
        Math.min(seconds, Number.isFinite(duration) ? duration : Infinity),
      );
      this.update({
        music: {
          ...this.snapshot.music,
          currentTime: this.music.element.currentTime,
        },
      });
    } catch (error) {
      this.fail(error);
    }
  }
  private updateAmbience(playingId?: string) {
    this.update({
      ambience: [...this.ambience.values()].map((stream) => ({
        asset: stream.asset,
        volume: this.snapshot.preferences.ambienceVolumes[stream.asset.id] ?? 1,
        status:
          stream.asset.id === playingId ||
          this.snapshot.ambience.some(
            (item) =>
              item.asset.id === stream.asset.id && item.status === "playing",
          )
            ? "playing"
            : "loading",
      })),
    });
  }
  async startAmbience(asset: Asset): Promise<void> {
    try {
      this.ready(asset);
      if (this.ambience.has(asset.id)) return;
      const stream = this.createStream(asset, "ambience");
      this.ambience.set(asset.id, stream);
      const error = () => {
        if (!stream.closed) {
          this.stopAmbience(asset.id);
          this.fail(
            new Error(
              `Cannot play “${asset.name}”. The file may be missing or unsupported by this browser.`,
            ),
          );
        }
      };
      stream.element.addEventListener("error", error);
      stream.cleanup = () => stream.element.removeEventListener("error", error);
      this.updateAmbience();
      await this.playStream(stream, "ambience");
    } catch (error) {
      this.fail(error);
    }
  }
  stopAmbience(id: string) {
    const stream = this.ambience.get(id);
    if (stream) this.closeStream(stream);
    this.ambience.delete(id);
    this.updateAmbience();
  }

  private async fetchEffect(
    asset: Asset,
    signal: AbortSignal,
  ): Promise<ArrayBuffer> {
    const response = await fetch(`/media/${encodeURIComponent(asset.id)}`, {
      signal,
    });
    if (!response.ok)
      throw new Error(`Cannot load “${asset.name}” (${response.status}).`);
    if (Number(response.headers.get("content-length")) > MAX_EFFECT_FILE) {
      await response.body?.cancel();
      throw new Error(
        "Sound effect is too large (16 MiB limit). Use music or ambience for long audio.",
      );
    }
    if (!response.body) throw new Error("Sound effect has no data.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_EFFECT_FILE || signal.aborted) {
          await reader.cancel();
          throw new Error(
            signal.aborted
              ? "Audio load cancelled."
              : "Sound effect is too large (16 MiB limit).",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  }
  private loadEffect(
    asset: Asset,
    context: AudioContext,
  ): Promise<AudioBuffer> {
    const cached = this.cache.get(asset.id);
    if (cached) {
      this.cache.delete(asset.id);
      this.cache.set(asset.id, cached);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(asset.id);
    if (existing) return existing.promise;
    if (this.activeLoads >= 4)
      return Promise.reject(
        new Error("Several effects are loading. Try again in a moment."),
      );
    const epoch = this.epoch;
    const controller = new AbortController();
    // decodeAudioData cannot be aborted: stopped loads still occupy a slot until settled.
    this.activeLoads++;
    const promise = (async () => {
      const bytes = await this.fetchEffect(asset, controller.signal);
      if (epoch !== this.epoch || controller.signal.aborted)
        throw new Error("Audio load cancelled.");
      const buffer = await context.decodeAudioData(bytes);
      if (epoch !== this.epoch || controller.signal.aborted)
        throw new Error("Audio load cancelled.");
      if (buffer.duration > 120)
        throw new Error(
          "Sound effect is too long (120 seconds maximum). Use music or ambience.",
        );
      const size = bufferBytes(buffer);
      if (size > MAX_DECODED)
        throw new Error("Decoded sound effect is too large (64 MiB limit).");
      if (size <= MAX_CACHE) {
        let total = [...this.cache.values()].reduce(
          (sum, value) => sum + bufferBytes(value),
          0,
        );
        while (total + size > MAX_CACHE && this.cache.size) {
          const id = this.cache.keys().next().value!;
          total -= bufferBytes(this.cache.get(id)!);
          this.cache.delete(id);
        }
        this.cache.set(asset.id, buffer);
      }
      return buffer;
    })().finally(() => {
      this.activeLoads--;
      if (this.pending.get(asset.id)?.controller === controller)
        this.pending.delete(asset.id);
    });
    this.pending.set(asset.id, { promise, controller });
    return promise;
  }
  async triggerEffect(asset: Asset): Promise<void> {
    const epoch = this.epoch;
    try {
      const context = this.ready(asset);
      if (context.state === "suspended") await context.resume();
      if (epoch !== this.epoch || this.removedAssets.has(asset.id)) return;
      const buffer = await this.loadEffect(asset, context);
      if (
        epoch !== this.epoch ||
        this.disposed ||
        this.removedAssets.has(asset.id)
      )
        return;
      const activeBytes = [...this.effects.keys()].reduce(
        (sum, source) => sum + (source.buffer ? bufferBytes(source.buffer) : 0),
        0,
      );
      if (
        this.effects.size >= 32 ||
        activeBytes + bufferBytes(buffer) > MAX_DECODED
      )
        throw new Error(
          "Too many sound effects are playing. Try again when a sound finishes.",
        );
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gains!.effects);
      this.effects.set(source, asset.id);
      const cleanup = () => {
        source.onended = null;
        source.disconnect();
        source.buffer = null;
        this.effects.delete(source);
        this.update({ effectCount: this.effects.size });
      };
      source.onended = cleanup;
      try {
        source.start();
        this.update({ effectCount: this.effects.size });
      } catch (error) {
        cleanup();
        throw error;
      }
    } catch (error) {
      if (epoch === this.epoch && !this.removedAssets.has(asset.id))
        this.fail(error);
    }
  }
  private stopEffect(source: AudioBufferSourceNode) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* Already ended. */
    }
    source.disconnect();
    source.buffer = null;
    this.effects.delete(source);
  }
  removeAsset(id: string): void {
    // Stable IDs are never reused; this also invalidates deferred cached-buffer plays.
    this.removedAssets.add(id);
    this.pending.get(id)?.controller.abort();
    this.pending.delete(id);
    this.cache.delete(id);

    const { queue, queueIndex, music, preferences } = this.snapshot;
    const indices = new Map<number, number>();
    const remaining = queue.filter((asset, index) => {
      if (asset.id === id) return false;
      indices.set(index, indices.size);
      return true;
    });
    this.shuffleOrder = this.shuffleOrder.flatMap((index) => {
      const next = indices.get(index);
      return next === undefined ? [] : [next];
    });
    if (this.music?.asset.id === id) {
      this.closeStream(this.music);
      this.music = null;
    }
    const ambience = this.ambience.get(id);
    if (ambience) this.closeStream(ambience);
    this.ambience.delete(id);
    for (const [source, assetId] of this.effects)
      if (assetId === id) this.stopEffect(source);
    const ambienceVolumes = { ...preferences.ambienceVolumes };
    delete ambienceVolumes[id];
    this.update({
      queue: remaining,
      queueIndex: indices.get(queueIndex) ?? -1,
      music:
        music.asset?.id === id
          ? { asset: null, status: "stopped", currentTime: 0, duration: 0 }
          : music,
      ambience: this.snapshot.ambience.filter((item) => item.asset.id !== id),
      effectCount: this.effects.size,
      preferences: { ...preferences, ambienceVolumes },
    });
  }
  stopAll() {
    this.epoch++;
    for (const { controller } of this.pending.values()) controller.abort();
    this.pending.clear();
    this.stopMusic();
    for (const id of [...this.ambience.keys()]) this.stopAmbience(id);
    for (const source of this.effects.keys()) this.stopEffect(source);
    this.update({ effectCount: 0 });
  }
  dispose() {
    if (this.disposed) return;
    this.stopAll();
    this.disposed = true;
    this.cache.clear();
    if (this.gains)
      for (const gain of Object.values(this.gains)) gain.disconnect();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.gains = null;
    this.update({ enabled: false });
    this.listeners.clear();
  }
}
