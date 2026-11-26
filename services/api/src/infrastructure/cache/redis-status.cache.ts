let degradedSinceReady = false;

export const recordRedisDegraded = (): void => {
  degradedSinceReady = true;
};

export const consumeRedisDegraded = (): boolean => {
  const degraded = degradedSinceReady;
  degradedSinceReady = false;
  return degraded;
};
