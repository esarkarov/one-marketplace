import type { Server } from "node:http";

let server: Server | undefined;

export const setHttpServer = (current: Server): void => {
  server = current;
};

export const getHttpServer = (): Server | undefined => server;
