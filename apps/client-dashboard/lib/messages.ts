import {
  formatFileSize,
  isHttpsUrl,
  type ConversationItem,
  type MessageItem,
} from "@onemarketplace/web-core";
import { formatDistanceToNow } from "date-fns";
import type {
  ClientConversation,
  ClientMessage,
} from "../app/_components/data/client-data";

export const counterpartyOf = (
  participants: ConversationItem["participants"],
): ConversationItem["participants"][number] | undefined =>
  participants.find(({ participantType }) => participantType !== "CLIENT") ??
  participants[0];

export const initialsOfName = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const lastMessagePreview = (conversation: ConversationItem): string =>
  conversation.lastMessage?.body ??
  conversation.lastMessage?.eventType ??
  (conversation.lastAttachmentName
    ? `Attachment – ${conversation.lastAttachmentName}`
    : null) ??
  "Conversation started";

const relative = (iso: string): string =>
  formatDistanceToNow(new Date(iso), { addSuffix: true });

export const toConversationView = (
  conversation: ConversationItem,
  selectedId: string | undefined,
  formatTime: (iso: string) => string = relative,
): ClientConversation => {
  const person = counterpartyOf(conversation.participants);
  const name = person?.name ?? "Freelancer";
  const active =
    conversation.contractStatus === "ACTIVE" && conversation.contractId;
  return {
    id: conversation.id,
    person: name,
    avatarUrl: person?.avatarUrl ?? null,
    initials: initialsOfName(name),
    accountType: person?.participantType === "AGENCY" ? "Agency" : "Freelancer",
    context: conversation.jobTitle ?? "Direct conversation",
    contextHref: active
      ? `/contracts?contractId=${encodeURIComponent(conversation.contractId ?? "")}`
      : conversation.jobId
        ? `/proposals/${encodeURIComponent(conversation.jobId)}`
        : "/proposals",
    contextLabel: active ? "View contract details" : "View project details",
    unread: conversation.id === selectedId ? 0 : conversation.unreadCount,
    lastMessage: lastMessagePreview(conversation),
    time: conversation.lastMessageAt
      ? formatTime(conversation.lastMessageAt)
      : "New",
    messages: [],
    activeMeeting: conversation.activeMeeting
      ? {
          id: conversation.activeMeeting.id,
          joinUrl: conversation.activeMeeting.joinUrl,
          startedAt: conversation.activeMeeting.startedAt,
        }
      : null,
  };
};

const payloadString = (
  payload: MessageItem["eventPayload"],
  key: string,
): string | undefined => {
  const value = payload?.[key];
  return typeof value === "string" ? value : undefined;
};

const payloadCents = (
  payload: MessageItem["eventPayload"],
  key: string,
): number => {
  const value = payload?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
};

const isSystem = (message: MessageItem, eventType: string): boolean =>
  message.messageType === "SYSTEM_EVENT" && message.eventType === eventType;

const HIDDEN_EVENTS: readonly string[] = [
  "CONTRACT_ACCEPTED",
  "MILESTONE_APPROVED",
  "MILESTONE_CHANGES_REQUESTED",
];

const contractHref = (contractId: string | undefined): string =>
  contractId
    ? `/contracts?contractId=${encodeURIComponent(contractId)}`
    : "/contracts";

export const toThread = (
  messages: readonly MessageItem[],
  actorId: string | null,
  formatTime: (iso: string) => string = relative,
): ClientMessage[] => {
  const activeContracts = new Set<string>();
  const completedContracts = new Set<string>();
  const endedMeetings = new Set<string>();
  const submissionOfMilestone = new Map<string, string>();
  const submissionStatus = new Map<
    string,
    "Submitted" | "Approved" | "Changes requested"
  >();

  for (const message of messages) {
    const payload = message.eventPayload;
    if (isSystem(message, "MILESTONE_SUBMITTED")) {
      const milestoneId = payloadString(payload, "milestoneId");
      if (milestoneId) {
        submissionOfMilestone.set(milestoneId, message.id);
        submissionStatus.set(message.id, "Submitted");
      }
    }
    if (isSystem(message, "CONTRACT_ACCEPTED")) {
      const contractId = payloadString(payload, "contractId");
      if (contractId) activeContracts.add(contractId);
    }
    if (isSystem(message, "CONTRACT_COMPLETED")) {
      const contractId = payloadString(payload, "contractId");
      if (contractId) {
        completedContracts.add(contractId);
        activeContracts.delete(contractId);
      }
    }
    if (isSystem(message, "MEETING_ENDED")) {
      const meetingId = payloadString(payload, "meetingId");
      if (meetingId) endedMeetings.add(meetingId);
    }
    if (
      message.eventType === "MILESTONE_APPROVED" ||
      message.eventType === "MILESTONE_CHANGES_REQUESTED"
    ) {
      const milestoneId = payloadString(payload, "milestoneId");
      const submissionId = milestoneId
        ? submissionOfMilestone.get(milestoneId)
        : undefined;
      if (submissionId) {
        submissionStatus.set(
          submissionId,
          message.eventType === "MILESTONE_APPROVED"
            ? "Approved"
            : "Changes requested",
        );
      }
    }
  }

  const result: ClientMessage[] = [];
  for (const message of messages) {
    const payload = message.eventPayload;
    const time = formatTime(message.createdAt);
    const system = message.messageType === "SYSTEM_EVENT";
    const mine = actorId !== null && message.senderId === actorId;

    if (
      system &&
      message.eventType &&
      HIDDEN_EVENTS.includes(message.eventType)
    ) {
      continue;
    }

    if (isSystem(message, "CONTRACT_COMPLETED")) {
      const contractId = payloadString(payload, "contractId");
      result.push({
        id: message.id,
        kind: "contract_completed",
        sender: "system",
        contractId,
        title: payloadString(payload, "title") ?? "Contract completed",
        href: contractHref(contractId),
        time,
      });
      continue;
    }

    if (isSystem(message, "CONTRACT_OFFER")) {
      const contractId = payloadString(payload, "contractId");
      const first = payload?.firstMilestone;
      const firstCents =
        first && typeof first === "object"
          ? payloadCents(first as Record<string, unknown>, "amountCents")
          : 0;
      result.push({
        id: message.id,
        kind: "contract",
        sender: "client",
        title: payloadString(payload, "title") ?? "Contract offer",
        amountCents: firstCents,
        status:
          contractId && completedContracts.has(contractId)
            ? "Completed"
            : contractId && activeContracts.has(contractId)
              ? "Active"
              : "Awaiting acceptance",
        href: contractHref(contractId),
        time,
      });
      continue;
    }

    if (
      isSystem(message, "MILESTONE_SUBMITTED") ||
      isSystem(message, "MILESTONE_FUNDED") ||
      isSystem(message, "MILESTONE_ADDED")
    ) {
      const contractId = payloadString(payload, "contractId");
      const link = payloadString(payload, "submissionDeliveryLink");
      result.push({
        id: message.id,
        kind: "milestone",
        sender:
          message.eventType === "MILESTONE_SUBMITTED" ? "talent" : "client",
        title:
          payloadString(payload, "milestoneTitle") ?? "Milestone submitted",
        amountCents: payloadCents(payload, "amountCents"),
        status:
          message.eventType === "MILESTONE_ADDED"
            ? "Added"
            : message.eventType === "MILESTONE_FUNDED"
              ? "Funded"
              : (submissionStatus.get(message.id) ?? "Submitted"),
        href: contractHref(contractId),
        time,
        contractId,
        milestoneId: payloadString(payload, "milestoneId"),
        submissionMessage:
          payloadString(payload, "submissionMessage") ??
          payloadString(payload, "requirements"),
        submissionDeliveryLink: link && isHttpsUrl(link) ? link : undefined,
        dueDate: payloadString(payload, "dueDate"),
      });
      continue;
    }

    if (isSystem(message, "MEETING_STARTED")) {
      const meetingId = payloadString(payload, "meetingId");
      const joinUrl = payloadString(payload, "joinUrl");
      result.push({
        id: message.id,
        kind: "meeting",
        sender: mine ? "client" : "talent",
        title: "Video meeting",
        startsAt: `Started ${formatTime(message.createdAt)}`,
        meetUrl: joinUrl && isHttpsUrl(joinUrl) ? joinUrl : "",
        ended: meetingId ? endedMeetings.has(meetingId) : false,
        time,
      });
      continue;
    }

    if (isSystem(message, "MEETING_ENDED")) {
      const minutes = payload?.durationMinutes;
      result.push({
        id: message.id,
        kind: "meeting_ended",
        durationMinutes: typeof minutes === "number" ? minutes : 0,
        time,
      });
      continue;
    }

    const attachment = message.attachments[0];
    result.push({
      id: message.id,
      kind: "text",
      sender: mine ? "client" : "talent",
      text: message.body ?? "Shared an attachment.",
      time,
      replyToId: message.replyToMessageId ?? undefined,
      attachment: attachment
        ? {
            name: attachment.fileName,
            size: formatFileSize(attachment.fileSize),
            type: attachment.mimeType,
            url:
              attachment.fileUrl && isHttpsUrl(attachment.fileUrl)
                ? attachment.fileUrl
                : undefined,
          }
        : undefined,
    });
  }
  return result;
};
