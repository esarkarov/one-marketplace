export interface AudioLike {
  preload: string;
  currentTime: number;
  play: () => Promise<void> | void;
}

export type AudioConstructor = new (src?: string) => AudioLike;

export interface SoundPlayer {
  unlock: () => void;
  play: () => void;
  /** Unlocks on the first pointer-down or key-down; returns a remover. */
  install: (
    target?: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  ) => () => void;
}

export const createSoundPlayer = (
  url: string,
  options: { Audio?: AudioConstructor } = {},
): SoundPlayer => {
  let audio: AudioLike | null = null;

  const unlock = () => {
    try {
      const Ctor =
        options.Audio ??
        (typeof Audio === "undefined"
          ? undefined
          : (Audio as unknown as AudioConstructor));
      if (!Ctor) return;
      audio ??= new Ctor(url);
      audio.preload = "auto";
    } catch {
      audio = null;
    }
  };

  const play = () => {
    try {
      unlock();
      if (!audio) return;
      audio.currentTime = 0;
      void Promise.resolve(audio.play()).catch(() => undefined);
    } catch {
      return;
    }
  };

  const install: SoundPlayer["install"] = (target) => {
    const where =
      target ?? (typeof window === "undefined" ? undefined : window);
    if (!where) return () => undefined;
    where.addEventListener("pointerdown", unlock);
    where.addEventListener("keydown", unlock);
    return () => {
      where.removeEventListener("pointerdown", unlock);
      where.removeEventListener("keydown", unlock);
    };
  };

  return { unlock, play, install };
};
