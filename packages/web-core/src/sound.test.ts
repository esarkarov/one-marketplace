import { describe, expect, it, vi } from "vitest";
import { createSoundPlayer, type AudioLike } from "./sound";

const fakeAudio = (
  play: () => Promise<void> | void = async () => undefined,
) => {
  const instances: Array<AudioLike & { src: string | undefined }> = [];
  class FakeAudio {
    preload = "";
    currentTime = 5;
    src: string | undefined;
    constructor(src?: string) {
      this.src = src;
      instances.push(this);
    }
    play = vi.fn(play);
  }
  return { Audio: FakeAudio, instances };
};

describe("createSoundPlayer", () => {
  it("creates the audio element on unlock and not before", () => {
    const { Audio, instances } = fakeAudio();
    const player = createSoundPlayer("/notification.mp3", { Audio });
    expect(instances).toHaveLength(0);

    player.unlock();
    player.unlock();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.src).toBe("/notification.mp3");
    expect(instances[0]?.preload).toBe("auto");
  });

  it("unlocks on the first pointer-down and key-down", () => {
    const { Audio, instances } = fakeAudio();
    const player = createSoundPlayer("/n.mp3", { Audio });
    const remove = player.install();

    window.dispatchEvent(new Event("pointerdown"));
    expect(instances).toHaveLength(1);

    remove();
    const second = fakeAudio();
    const other = createSoundPlayer("/n.mp3", { Audio: second.Audio });
    const removeOther = other.install();
    removeOther();
    window.dispatchEvent(new Event("keydown"));
    expect(second.instances).toHaveLength(0);
  });

  it("rewinds and plays after unlock", () => {
    const { Audio, instances } = fakeAudio();
    const player = createSoundPlayer("/n.mp3", { Audio });
    player.unlock();
    player.play();
    player.play();

    expect(instances).toHaveLength(1);
    const audio = instances[0] as unknown as {
      currentTime: number;
      play: { mock: { calls: unknown[] } };
    };
    expect(audio.currentTime).toBe(0);
    expect(audio.play.mock.calls).toHaveLength(2);
  });

  it("plays even if unlock was never called", () => {
    const { Audio, instances } = fakeAudio();
    createSoundPlayer("/n.mp3", { Audio }).play();
    expect(instances).toHaveLength(1);
  });

  it("never throws when play rejects", async () => {
    const { Audio } = fakeAudio(() =>
      Promise.reject(new Error("NotAllowedError")),
    );
    const player = createSoundPlayer("/n.mp3", { Audio });
    expect(() => player.play()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("never throws when play throws synchronously or Audio is unavailable", () => {
    const { Audio } = fakeAudio(() => {
      throw new Error("boom");
    });
    expect(() => createSoundPlayer("/n.mp3", { Audio }).play()).not.toThrow();

    class Broken {
      constructor() {
        throw new Error("no audio");
      }
    }
    expect(() =>
      createSoundPlayer("/n.mp3", { Audio: Broken as never }).play(),
    ).not.toThrow();
  });
});
