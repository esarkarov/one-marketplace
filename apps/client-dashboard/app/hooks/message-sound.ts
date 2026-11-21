import { createSoundPlayer } from "@onemarketplace/web-core";

export const messageSound = createSoundPlayer("/notification.mp3");

export const unlockMessageSound = messageSound.unlock;

export const playIncomingMessageSound = messageSound.play;
