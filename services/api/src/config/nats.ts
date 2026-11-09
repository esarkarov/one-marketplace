import { connect, type NatsConnection } from "nats";
import { env } from "./env.js";

let connection: NatsConnection | undefined;

export const getNats = async () =>
  (connection ??= await connect({ servers: env.natsUrl }));

export const disconnectNats = async () => {
  await connection?.drain();
  connection = undefined;
};
