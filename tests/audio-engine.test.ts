import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../src/client/features/audio/engine.js";
import { DEFAULT_AUDIO_PREFERENCES } from "../src/shared/audio.js";
import type { Asset } from "../src/shared/contracts.js";
const asset = (id: string, category: Asset["category"] = "music"): Asset => ({
  id,
  category,
  name: id,
  mimeType: "audio/mpeg",
});
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
class Node {
  connections: Node[] = [];
  disconnect = vi.fn(() => {
    this.connections = [];
  });
  connect = vi.fn((node: Node) => {
    this.connections.push(node);
    return node;
  });
}
class Gain extends Node {
  gain = { value: 1 };
}
class Source extends Node {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
class Media extends EventTarget {
  src = "";
  preload = "";
  loop = false;
  currentTime = 0;
  duration = 100;
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn(() => {
    this.src = "";
  });
  constructor() {
    super();
    media.push(this);
  }
}
let media: Media[];
let contexts: Context[];
class Context {
  state = "running";
  destination = new Node();
  gains: Gain[] = [];
  streams: Node[] = [];
  effects: Source[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
  createGain() {
    const gain = new Gain();
    this.gains.push(gain);
    return gain;
  }
  createMediaElementSource() {
    const source = new Node();
    this.streams.push(source);
    return source;
  }
  createBufferSource() {
    const source = new Source();
    this.effects.push(source);
    return source;
  }
  decodeAudioData = vi.fn(
    async () =>
      ({ duration: 1, length: 48000, numberOfChannels: 2 }) as AudioBuffer,
  );
  constructor() {
    contexts.push(this);
  }
}
let engine: AudioEngine;
beforeEach(() => {
  media = [];
  contexts = [];
  vi.stubGlobal("Audio", Media);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([1, 2]))),
  );
  engine = new AudioEngine();
});
afterEach(() => {
  engine.dispose();
  vi.unstubAllGlobals();
});
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
describe("GM audio engine", () => {
  it("removes every queue occurrence without interrupting another current track", async () => {
    await engine.enable();
    await engine.setQueue([asset("gone"), asset("keep"), asset("gone"), asset("last")], 1);
    engine.removeAsset("gone");
    expect(engine.getSnapshot().queue.map((item) => item.id)).toEqual(["keep", "last"]);
    expect(engine.getSnapshot().queueIndex).toBe(0);
    expect(engine.getSnapshot().music.status).toBe("playing");
    expect(media[0].paused).toBe(false);
    expect(media[0].play).toHaveBeenCalledTimes(1);
    await engine.next();
    expect(engine.getSnapshot().music.asset?.id).toBe("last");
  });
  it("clears deleted music while its play is pending and can start the remaining queue", async () => {
    await engine.enable();
    await engine.setQueue([asset("gone"), asset("keep"), asset("gone")]);
    engine.pauseMusic();
    const pending = deferred<void>();
    media[0].play.mockImplementationOnce(() => pending.promise);
    const resuming = engine.resumeMusic();
    engine.removeAsset("gone");
    pending.resolve();
    await resuming;
    expect(engine.getSnapshot().music).toEqual({ asset: null, status: "stopped", currentTime: 0, duration: 0 });
    expect(media[0].paused).toBe(true);
    expect(media[0].src).toBe("");
    expect(engine.getSnapshot().queue.map((item) => item.id)).toEqual(["keep"]);
    await engine.next();
    expect(engine.getSnapshot().music.asset?.id).toBe("keep");
    engine.removeAsset("keep");
    expect(engine.getSnapshot().queueIndex).toBe(-1);
    expect(engine.getSnapshot().queue).toEqual([]);
  });
  it("resume starts remaining music after deleting the current asset", async () => {
    await engine.enable();
    await engine.setQueue([asset("gone"), asset("keep")]);
    engine.removeAsset("gone");
    await engine.resumeMusic();
    expect(engine.getSnapshot().music.asset?.id).toBe("keep");
    expect(engine.getSnapshot().music.status).toBe("playing");
  });
  it("preserves shuffled transport when deleted entries precede the current track", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await engine.enable();
      engine.setShuffle(true);
      await engine.setQueue([asset("gone"), asset("a"), asset("b"), asset("c")], 1);
      engine.removeAsset("gone");
      await engine.next();
      expect(engine.getSnapshot().music.asset?.id).toBe("b");
      await engine.next();
      expect(engine.getSnapshot().music.asset?.id).toBe("c");
      await engine.previous();
      expect(engine.getSnapshot().music.asset?.id).toBe("b");
    } finally {
      random.mockRestore();
    }
  });
  it("removes only the asset's ambience, effects and saved volume", async () => {
    await engine.enable();
    await engine.playMusic(asset("song"));
    await engine.startAmbience(asset("gone", "ambience"));
    await engine.startAmbience(asset("wind", "ambience"));
    engine.setAmbienceVolume("gone", 0.2);
    engine.setAmbienceVolume("wind", 0.3);
    await engine.triggerEffect(asset("gone", "effect"));
    await engine.triggerEffect(asset("bell", "effect"));
    engine.removeAsset("gone");
    expect(engine.getSnapshot().ambience.map((item) => item.asset.id)).toEqual(["wind"]);
    expect(engine.getSnapshot().preferences.ambienceVolumes).toEqual({ wind: 0.3 });
    expect(engine.getSnapshot().effectCount).toBe(1);
    expect(contexts[0].effects[0].buffer).toBeNull();
    expect(contexts[0].effects[0].stop).toHaveBeenCalled();
    expect(contexts[0].effects[1].stop).not.toHaveBeenCalled();
    expect(media[0].paused).toBe(false);
    expect(media[1].paused).toBe(true);
    expect(media[2].paused).toBe(false);
  });
  it("aborts only a deleted effect's pending fetch without a late decode or error", async () => {
    await engine.enable();
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const loading = engine.triggerEffect(asset("gone", "effect"));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await engine.triggerEffect(asset("bell", "effect"));
    engine.removeAsset("gone");
    expect(signal?.aborted).toBe(true);
    response.resolve(new Response(new Uint8Array([1])));
    await loading;
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().effectCount).toBe(1);
    expect(engine.getSnapshot().error).toBeNull();
  });
  it("prevents pending decoded and cached effects from starting after deletion", async () => {
    await engine.enable();
    const buffer = deferred<AudioBuffer>();
    contexts[0].decodeAudioData.mockImplementationOnce(() => buffer.promise);
    const decoding = engine.triggerEffect(asset("gone", "effect"));
    await tick();
    engine.removeAsset("gone");
    buffer.resolve({ duration: 1, length: 10, numberOfChannels: 1 } as AudioBuffer);
    await decoding;
    expect(engine.getSnapshot().effectCount).toBe(0);
    expect(engine.getSnapshot().error).toBeNull();
    await engine.triggerEffect(asset("cached", "effect"));
    const cached = engine.triggerEffect(asset("cached", "effect"));
    engine.removeAsset("cached");
    await cached;
    expect(engine.getSnapshot().effectCount).toBe(0);
    expect(contexts[0].effects).toHaveLength(1);
  });
  it("deletion cancels pending initial music and ambience without resurrecting either", async () => {
    await engine.enable();
    const music = engine.playMusic(asset("gone"));
    const ambience = engine.startAmbience(asset("gone", "ambience"));
    engine.removeAsset("gone");
    await Promise.all([music, ambience]);
    expect(engine.getSnapshot().music.asset).toBeNull();
    expect(engine.getSnapshot().music.status).toBe("stopped");
    expect(engine.getSnapshot().ambience).toEqual([]);
    expect(media.every((item) => item.paused && !item.src)).toBe(true);
  });
  it("deletion while resuming the audio context cancels only the requested effect", async () => {
    await engine.enable();
    contexts[0].state = "suspended";
    const resume = deferred<void>();
    contexts[0].resume.mockReturnValueOnce(resume.promise);
    const gone = engine.triggerEffect(asset("gone", "effect"));
    const keep = engine.triggerEffect(asset("keep", "effect"));
    engine.removeAsset("gone");
    resume.resolve();
    await Promise.all([gone, keep]);
    expect(engine.getSnapshot().effectCount).toBe(1);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/media/keep"]);
    expect(engine.getSnapshot().error).toBeNull();
  });
  it("does not allocate audio or play when preferences are restored; snapshots stay stable", async () => {
    const initial = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(initial);
    engine.applyPreferences({ ...DEFAULT_AUDIO_PREFERENCES, musicLoop: true });
    expect(contexts).toHaveLength(0);
    expect(media).toHaveLength(0);
    await engine.playMusic(asset("a"));
    expect(contexts).toHaveLength(0);
    expect(engine.getSnapshot().error).toMatch(/enable/i);
    await engine.enable();
    expect(engine.getSnapshot().enabled).toBe(true);
    expect(media).toHaveLength(0);
  });
  it("routes independent streaming categories to their gains and cleans only the stopped ambience", async () => {
    await engine.enable();
    await engine.playMusic(asset("song"));
    await engine.startAmbience(asset("rain", "ambience"));
    await engine.startAmbience(asset("wind", "ambience"));
    expect(engine.getSnapshot().music.status).toBe("playing");
    expect(engine.getSnapshot().ambience).toHaveLength(2);
    expect(contexts[0].streams[0].connections[0]).not.toBe(
      contexts[0].streams[1].connections[0],
    );
    engine.setVolume("master", 0.2);
    engine.setAmbienceVolume("rain", 0.3);
    expect(contexts[0].gains.some((g) => g.gain.value === 0.2)).toBe(true);
    engine.stopAmbience("rain");
    expect(media[1].paused).toBe(true);
    expect(contexts[0].streams[1].disconnect).toHaveBeenCalled();
    expect(media[0].paused).toBe(false);
    expect(media[2].paused).toBe(false);
    expect(engine.getSnapshot().ambience[0].asset.id).toBe("wind");
  });
  it("stops pending media play and does not let it revive state", async () => {
    await engine.enable();
    const pending = deferred<void>();
    const start = engine.playMusic(asset("a"));
    await start;
    media[0].play.mockImplementationOnce(() => pending.promise);
    engine.pauseMusic();
    const resume = engine.resumeMusic();
    engine.stopAll();
    pending.resolve();
    await resume;
    expect(engine.getSnapshot().music.status).toBe("stopped");
    expect(media[0].paused).toBe(true);
    expect(contexts[0].streams[0].disconnect).toHaveBeenCalled();
  });
  it("pauses pending resume without later claiming playback and surfaces resume errors", async () => {
    await engine.enable();
    await engine.playMusic(asset("a"));
    engine.pauseMusic();
    const pending = deferred<void>();
    media[0].play.mockImplementationOnce(() => pending.promise);
    const resume = engine.resumeMusic();
    engine.pauseMusic();
    pending.resolve();
    await resume;
    expect(engine.getSnapshot().music.status).toBe("paused");
    expect(media[0].paused).toBe(true);
    media[0].play.mockRejectedValueOnce(new Error("codec rejected"));
    await engine.resumeMusic();
    expect(engine.getSnapshot().error).toMatch(/codec rejected/);
    await engine.resumeMusic();
    expect(engine.getSnapshot().music.status).toBe("playing");
  });
  it("supports transport, whole-queue looping, shuffle and seek", async () => {
    await engine.enable();
    await engine.setQueue([asset("a"), asset("b")]);
    await engine.next();
    expect(engine.getSnapshot().music.asset?.id).toBe("b");
    await engine.next();
    expect(engine.getSnapshot().music.asset?.id).toBe("a");
    await engine.previous();
    expect(engine.getSnapshot().music.asset?.id).toBe("b");
    engine.seek(12);
    expect(media.at(-1)?.currentTime).toBe(12);
    media.at(-1)?.dispatchEvent(new Event("ended"));
    await tick();
    expect(engine.getSnapshot().music.status).toBe("stopped");
    engine.setMusicLoop(true);
    await engine.setQueue([asset("a"), asset("b")], 1);
    media.at(-1)?.dispatchEvent(new Event("ended"));
    await tick();
    expect(engine.getSnapshot().music.asset?.id).toBe("a");
    engine.setShuffle(true);
    await engine.next();
    expect(engine.getSnapshot().music.asset?.id).toBe("b");
  });
  it("deduplicates effect decoding while repeated triggers use fresh overlapping sources", async () => {
    await engine.enable();
    await Promise.all([
      engine.triggerEffect(asset("bell", "effect")),
      engine.triggerEffect(asset("bell", "effect")),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(contexts[0].decodeAudioData).toHaveBeenCalledTimes(1);
    expect(engine.getSnapshot().effectCount).toBe(2);
    const [a, b] = contexts[0].effects;
    expect(a).not.toBe(b);
    a.onended?.();
    expect(engine.getSnapshot().effectCount).toBe(1);
    expect(a.disconnect).toHaveBeenCalled();
    engine.stopAll();
    expect(b.stop).toHaveBeenCalled();
    expect(b.disconnect).toHaveBeenCalled();
    expect(engine.getSnapshot().effectCount).toBe(0);
  });
  it("cancels effect decoding across stopAll and permits a clean retry", async () => {
    await engine.enable();
    const pending = deferred<AudioBuffer>();
    contexts[0].decodeAudioData.mockImplementationOnce(() => pending.promise);
    const start = engine.triggerEffect(asset("bell", "effect"));
    await tick();
    engine.stopAll();
    pending.resolve({
      duration: 1,
      length: 100,
      numberOfChannels: 1,
    } as AudioBuffer);
    await start;
    expect(contexts[0].effects).toHaveLength(0);
    await engine.triggerEffect(asset("bell", "effect"));
    expect(engine.getSnapshot().effectCount).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("bounds compressed effects and rejects long decoded sounds", async () => {
    await engine.enable();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: { "content-length": String(20 * 1024 * 1024) },
      }),
    );
    await engine.triggerEffect(asset("huge", "effect"));
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toMatch(/large|limit/i);
    contexts[0].decodeAudioData.mockResolvedValueOnce({
      duration: 121,
      length: 100,
      numberOfChannels: 1,
    } as AudioBuffer);
    await engine.triggerEffect(asset("long", "effect"));
    expect(contexts[0].effects).toHaveLength(0);
    expect(engine.getSnapshot().error).toMatch(/long|120/i);
  });
  it("evicts decoded effects when their combined cache exceeds the memory budget", async () => {
    await engine.enable();
    contexts[0].decodeAudioData.mockResolvedValue({
      duration: 100,
      length: 3_000_000,
      numberOfChannels: 2,
    } as AudioBuffer);
    await engine.triggerEffect(asset("one", "effect"));
    contexts[0].effects.at(-1)?.onended?.();
    await engine.triggerEffect(asset("two", "effect"));
    contexts[0].effects.at(-1)?.onended?.();
    await engine.triggerEffect(asset("one", "effect"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("rejects images and disposes all streams, effects and context", async () => {
    await engine.enable();
    await engine.playMusic({
      ...asset("image", "image"),
      mimeType: "image/png",
    });
    expect(media).toHaveLength(0);
    await engine.playMusic(asset("a"));
    await engine.startAmbience(asset("rain", "ambience"));
    await engine.triggerEffect(asset("bell", "effect"));
    engine.dispose();
    expect(media.every((m) => m.paused && !m.src)).toBe(true);
    expect(contexts[0].close).toHaveBeenCalled();
    expect(engine.getSnapshot().enabled).toBe(false);
    await engine.enable();
    expect(contexts).toHaveLength(1);
  });
  it("limits outstanding decodes even across repeated stops", async () => {
    await engine.enable();
    const pending = deferred<AudioBuffer>();
    contexts[0].decodeAudioData.mockImplementation(() => pending.promise);
    const loads: Promise<void>[] = [];
    for (let i = 0; i < 6; i++) {
      loads.push(engine.triggerEffect(asset(`effect-${i}`, "effect")));
      await tick();
      engine.stopAll();
    }
    expect(contexts[0].decodeAudioData.mock.calls.length).toBeLessThanOrEqual(
      4,
    );
    pending.resolve({
      duration: 1,
      length: 10,
      numberOfChannels: 1,
    } as AudioBuffer);
    await Promise.all(loads);
    expect(contexts[0].effects).toHaveLength(0);
  });
  it("old cancelled decodes cannot remove a replacement load for the same asset", async () => {
    await engine.enable();
    const old = deferred<AudioBuffer>();
    const fresh = deferred<AudioBuffer>();
    contexts[0].decodeAudioData
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => fresh.promise);
    const a = engine.triggerEffect(asset("bell", "effect"));
    await tick();
    engine.stopAll();
    const b = engine.triggerEffect(asset("bell", "effect"));
    await tick();
    old.resolve({
      duration: 1,
      length: 10,
      numberOfChannels: 1,
    } as AudioBuffer);
    await a;
    const c = engine.triggerEffect(asset("bell", "effect"));
    await tick();
    fresh.resolve({
      duration: 1,
      length: 10,
      numberOfChannels: 1,
    } as AudioBuffer);
    await Promise.all([b, c]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot().effectCount).toBe(2);
  });
  it("bounds streamed effect bytes without trusting Content-Length", async () => {
    await engine.enable();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new Uint8Array(17 * 1024 * 1024)),
    );
    await engine.triggerEffect(asset("huge", "effect"));
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
    expect(engine.getSnapshot().error).toMatch(/large/i);
  });
  it("rejects oversized decoded buffers and bounds overlapping sources", async () => {
    await engine.enable();
    contexts[0].decodeAudioData.mockResolvedValueOnce({
      duration: 60,
      length: 10_000_000,
      numberOfChannels: 2,
    } as AudioBuffer);
    await engine.triggerEffect(asset("big", "effect"));
    expect(engine.getSnapshot().effectCount).toBe(0);
    for (let i = 0; i < 40; i++)
      await engine.triggerEffect(asset("bell", "effect"));
    expect(engine.getSnapshot().effectCount).toBeLessThanOrEqual(32);
    expect(engine.getSnapshot().error).toMatch(/too many/i);
  });
  it("reports streaming errors and disconnects failed ambience without touching music", async () => {
    await engine.enable();
    await engine.playMusic(asset("song"));
    await engine.startAmbience(asset("rain", "ambience"));
    media[1].dispatchEvent(new Event("error"));
    expect(engine.getSnapshot().ambience).toHaveLength(0);
    expect(contexts[0].streams[1].disconnect).toHaveBeenCalled();
    expect(engine.getSnapshot().music.status).toBe("playing");
    engine.clearError();
    expect(engine.getSnapshot().error).toBeNull();
    media[0].dispatchEvent(new Event("error"));
    expect(engine.getSnapshot().music.status).toBe("stopped");
    expect(contexts[0].streams[0].disconnect).toHaveBeenCalled();
  });

  it("pause or stop during the initial play prevents a late playing status", async () => {
    await engine.enable();
    const playing = engine.playMusic(asset("one"));
    engine.pauseMusic();
    await playing;
    expect(engine.getSnapshot().music.status).toBe("paused");
    expect(media[0].paused).toBe(true);
    const starting = engine.playMusic(asset("two"));
    engine.stopAll();
    await starting;
    expect(engine.getSnapshot().music.status).toBe("stopped");
    expect(media[1].paused).toBe(true);
    expect(contexts[0].streams[1].disconnect).toHaveBeenCalled();
  });
  it("stop aborts an in-flight network request and cannot create a late source", async () => {
    await engine.enable();
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(response.promise);
    const playing = engine.triggerEffect(asset("bell", "effect"));
    const request = vi.mocked(fetch).mock.calls[0][1];
    engine.stopAll();
    expect(request?.signal?.aborted).toBe(true);
    response.resolve(new Response(new Uint8Array([1])));
    await playing;
    expect(contexts[0].decodeAudioData).not.toHaveBeenCalled();
    expect(contexts[0].effects).toHaveLength(0);
  });
  it("an AudioContext resume error is retryable and disposal cancels a pending enable", async () => {
    await engine.enable();
    contexts[0].state = "suspended";
    contexts[0].resume.mockRejectedValueOnce(new Error("gesture needed"));
    await engine.playMusic(asset("one"));
    expect(engine.getSnapshot().error).toMatch(/gesture needed/);
    expect(media[0].play).not.toHaveBeenCalled();
    await engine.resumeMusic();
    expect(engine.getSnapshot().music.status).toBe("playing");
    const pending = deferred<void>();
    contexts[0].resume.mockReturnValueOnce(pending.promise);
    const enabling = engine.enable();
    engine.dispose();
    pending.resolve();
    await enabling;
    expect(engine.getSnapshot().enabled).toBe(false);
  });

  it("plays every entry in shuffled order before stopping and transport follows that order", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await engine.enable();
      engine.setShuffle(true);
      await engine.setQueue([asset("a"), asset("b"), asset("c")]);
      media.at(-1)?.dispatchEvent(new Event("ended"));
      await tick();
      expect(engine.getSnapshot().music.asset?.id).toBe("c");
      media.at(-1)?.dispatchEvent(new Event("ended"));
      await tick();
      expect(engine.getSnapshot().music.asset?.id).toBe("b");
      expect(engine.getSnapshot().music.status).toBe("playing");
      await engine.previous();
      expect(engine.getSnapshot().music.asset?.id).toBe("c");
      await engine.next();
      expect(engine.getSnapshot().music.asset?.id).toBe("b");
      media.at(-1)?.dispatchEvent(new Event("ended"));
      await tick();
      expect(engine.getSnapshot().music.status).toBe("stopped");
      await engine.next();
      expect(engine.getSnapshot().music.asset?.id).toBe("a");
      await engine.previous();
      expect(engine.getSnapshot().music.asset?.id).toBe("b");
    } finally {
      random.mockRestore();
    }
  });
  it("restarts a complete shuffled cycle without repeating the previous last track", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await engine.enable();
      engine.setShuffle(true);
      engine.setMusicLoop(true);
      await engine.setQueue([asset("a"), asset("b"), asset("c")]);
      const heard: string[] = [];
      for (let i = 0; i < 6; i++) {
        heard.push(engine.getSnapshot().music.asset!.id);
        media.at(-1)?.dispatchEvent(new Event("ended"));
        await tick();
      }
      expect(heard.slice(0, 3)).toEqual(["a", "c", "b"]);
      expect(new Set(heard.slice(3, 6)).size).toBe(3);
      expect(heard[3]).not.toBe(heard[2]);
      expect(engine.getSnapshot().music.status).toBe("playing");
    } finally {
      random.mockRestore();
    }
  });
});
