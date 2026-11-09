import type { Response } from "express";

const userClients = new Map<string, Set<Response>>();
const agencyClients = new Map<string, Set<Response>>();

const addClient = (
  registry: Map<string, Set<Response>>,
  key: string,
  response: Response,
) => {
  const clients = registry.get(key) ?? new Set<Response>();
  clients.add(response);
  registry.set(key, clients);

  return () => {
    clients.delete(response);
    if (!clients.size) registry.delete(key);
  };
};

export const addNotificationClient = (userId: string, response: Response) =>
  addClient(userClients, userId, response);

export const addAgencyNotificationClient = (
  agencyId: string,
  response: Response,
) => addClient(agencyClients, agencyId, response);

const write = (
  registry: Map<string, Set<Response>>,
  key: string,
  notification: unknown,
) => {
  const data = `event: notification\ndata: ${JSON.stringify(notification)}\n\n`;
  registry.get(key)?.forEach((client) => client.write(data));
};

export const emitNotification = (userId: string, notification: unknown) =>
  write(userClients, userId, notification);

export const emitAgencyNotification = (
  agencyId: string,
  notification: unknown,
) => write(agencyClients, agencyId, notification);
