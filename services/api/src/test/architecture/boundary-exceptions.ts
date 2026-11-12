export interface BoundaryException {
  importer: string;
  imported: string;
  reason: string;
}

export const boundaryExceptions: BoundaryException[] = [
  {
    importer: "modules/agency/agency.controller.ts",
    imported: "modules/freelancer/freelancer.service.ts",
    reason:
      "controller reads another module service; replaced by a public interface",
  },
  {
    importer: "modules/agency/agency.controller.ts",
    imported: "modules/connects/connects.service.ts",
    reason:
      "controller reads another module service; replaced by a public interface",
  },
  {
    importer: "modules/agency/agency.controller.ts",
    imported: "modules/proposals/proposals.service.ts",
    reason:
      "controller reads another module service; replaced by a public interface",
  },
  {
    importer: "modules/agency/agency.service.ts",
    imported: "modules/connects/connects.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/agency/agency.service.ts",
    imported: "modules/freelancer/freelancer.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/contracts/contracts.controller.ts",
    imported: "modules/agency/agency.service.ts",
    reason:
      "controller reads another module service; replaced by a public interface",
  },
  {
    importer: "modules/contracts/contracts.controller.ts",
    imported: "modules/messaging/messaging.socket.ts",
    reason:
      "realtime emit from another module; replaced by an event or public interface",
  },
  {
    importer: "modules/contracts/contracts.service.ts",
    imported: "modules/messaging/messaging.socket.ts",
    reason:
      "realtime emit from another module; replaced by an event or public interface",
  },
  {
    importer: "modules/contracts/contracts.service.ts",
    imported: "modules/freelancer/freelancer.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/contracts/contracts.service.ts",
    imported: "modules/agency/agency.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/freelancer/freelancer.service.ts",
    imported: "modules/agency/agency.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/freelancer/freelancer.service.ts",
    imported: "modules/connects/connects.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/meetings/meetings.service.ts",
    imported: "modules/messaging/messaging.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/messaging/messaging.service.ts",
    imported: "modules/agency/agency.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/messaging/messaging.socket.ts",
    imported: "modules/agency/agency.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/notifications/notifications.controller.ts",
    imported: "modules/agency/agency.service.ts",
    reason:
      "controller reads another module service; replaced by a public interface",
  },
  {
    importer: "modules/proposals/proposals.service.ts",
    imported: "modules/agency/agency.service.ts",
    reason: "service reads another module service; moves down in Phase C",
  },
  {
    importer: "modules/proposals/proposals.service.ts",
    imported: "modules/messaging/messaging.socket.ts",
    reason:
      "realtime emit from another module; replaced by an event or public interface",
  },
  {
    importer: "infrastructure/events/consumer.ts",
    imported: "modules/notifications/notification.sse.ts",
    reason:
      "consumer reads the SSE hub from notifications; moves to shared infrastructure",
  },
];
