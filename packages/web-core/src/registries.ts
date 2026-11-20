import type { QueryClient } from "@tanstack/react-query";

const stoppers = new Set<{ queryClient: QueryClient; stop: () => void }>();

export const trackShared = (
  queryClient: QueryClient,
  stop: () => void,
): (() => void) => {
  const record = { queryClient, stop };
  stoppers.add(record);
  return () => {
    stoppers.delete(record);
  };
};

export const stopSharedFor = (queryClient: QueryClient): void => {
  for (const record of [...stoppers]) {
    if (record.queryClient === queryClient) record.stop();
  }
};
