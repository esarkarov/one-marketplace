import { connect, type NatsConnection } from "nats";
import { env } from "./env.js";

let connection: NatsConnection | undefined;

export const isNatsEnabled = (): boolean => Boolean(env.natsUrl);

export const getNats = async () => {
  if (!env.natsUrl) {
    throw new Error("NATS_URL is not set.");
  }

  return (connection ??= await connect({ servers: env.natsUrl }));
};

export const disconnectNats = async () => {
  await connection?.drain();
  connection = undefined;
};
