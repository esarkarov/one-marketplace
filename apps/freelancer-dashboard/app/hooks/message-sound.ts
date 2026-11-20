let notificationSound: HTMLAudioElement | null = null;

export const unlockMessageSound = () => {
  notificationSound ??= new Audio("/notification.mp3");
  notificationSound.preload = "auto";
};

export const playIncomingMessageSound = () => {
  unlockMessageSound();
  notificationSound!.currentTime = 0;
  void notificationSound!.play().catch(() => undefined);
};
