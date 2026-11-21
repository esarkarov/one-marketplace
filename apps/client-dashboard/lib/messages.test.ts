import {
  dedupeMessages,
  type ConversationItem,
  type MessageItem,
} from "@onemarketplace/web-core";
import { describe, expect, it } from "vitest";
import {
  counterpartyOf,
  lastMessagePreview,
  toConversationView,
  toThread,
} from "./messages";

const ME = "11111111-1111-4111-8111-111111111111";

const THEM = "22222222-2222-4222-8222-222222222222";

const CONVERSATION = "33333333-3333-4333-8333-333333333333";

const at = (minute: number) =>
  `2026-11-21T10:${String(minute).padStart(2, "0")}:00.000Z`;

const message = (
  id: string,
  overrides: Partial<MessageItem> = {},
): MessageItem => ({
  id,
  conversationId: CONVERSATION,
  senderId: THEM,
  messageType: "USER",
  body: `body ${id}`,
  eventType: null,
  eventPayload: null,
  createdAt: at(1),
  replyTo: null,
  replyToMessageId: null,
  attachments: [],
  ...overrides,
});

const system = (
  id: string,
  eventType: string,
  eventPayload: Record<string, unknown>,
  minute = 1,
): MessageItem =>
  message(id, {
    messageType: "SYSTEM_EVENT",
    eventType,
    eventPayload,
    body: null,
    createdAt: at(minute),
  });

const conversation = (
  overrides: Partial<ConversationItem> = {},
): ConversationItem => ({
  id: CONVERSATION,
  activeMeeting: null,
  contractId: null,
  contractStatus: null,
  jobId: "job-1",
  jobTitle: "Build a site",
  lastAttachmentName: null,
  lastMessage: null,
  lastMessageAt: at(5),
  participants: [
    {
      participantType: "CLIENT",
      name: "Me Client",
      avatarUrl: null,
      companyName: null,
      professionalTitle: null,
    },
    {
      participantType: "FREELANCER",
      name: "Ada Lovelace",
      avatarUrl: "https://img.example/ada.png",
      companyName: null,
      professionalTitle: "Engineer",
    },
  ],
  proposalId: null,
  unreadCount: 3,
  updatedAt: at(5),
  ...overrides,
});

const time = (iso: string) => `t(${iso})`;

describe("conversation view", () => {
  it("picks the counterparty and maps the fields", () => {
    const view = toConversationView(conversation(), undefined, time);
    expect(view).toMatchObject({
      id: CONVERSATION,
      person: "Ada Lovelace",
      initials: "AL",
      avatarUrl: "https://img.example/ada.png",
      accountType: "Freelancer",
      context: "Build a site",
      contextHref: "/proposals/job-1",
      contextLabel: "View project details",
      unread: 3,
      lastMessage: "Conversation started",
      time: `t(${at(5)})`,
      activeMeeting: null,
    });
  });

  it("shows an agency and the contract link for an active contract", () => {
    const view = toConversationView(
      conversation({
        contractStatus: "ACTIVE",
        contractId: "c 1",
        participants: [
          {
            participantType: "AGENCY",
            name: "Studio",
            avatarUrl: null,
            companyName: null,
            professionalTitle: null,
          },
        ],
      }),
      undefined,
      time,
    );
    expect(view.accountType).toBe("Agency");
    expect(view.contextHref).toBe("/contracts?contractId=c%201");
    expect(view.contextLabel).toBe("View contract details");
  });

  it("zeroes the unread count of the open conversation", () => {
    expect(toConversationView(conversation(), CONVERSATION, time).unread).toBe(
      0,
    );
  });

  it("falls back without a job or participants", () => {
    const view = toConversationView(
      conversation({ jobId: null, jobTitle: null, participants: [] }),
      undefined,
      time,
    );
    expect(view.person).toBe("Freelancer");
    expect(view.context).toBe("Direct conversation");
    expect(view.contextHref).toBe("/proposals");
    expect(counterpartyOf([])).toBeUndefined();
  });

  it("previews the last message, then the attachment", () => {
    expect(
      lastMessagePreview(
        conversation({
          lastMessage: {
            id: "m",
            body: "hi",
            createdAt: at(1),
            eventType: null,
            messageType: "USER",
            senderId: THEM,
          },
        }),
      ),
    ).toBe("hi");
    expect(
      lastMessagePreview(conversation({ lastAttachmentName: "cv.pdf" })),
    ).toBe("Attachment – cv.pdf");
  });
});

describe("thread mapping", () => {
  it("marks my messages as client and others as talent", () => {
    const thread = toThread(
      [message("a", { senderId: ME }), message("b", { senderId: THEM })],
      ME,
      time,
    );
    expect(thread.map((item) => item.kind === "text" && item.sender)).toEqual([
      "client",
      "talent",
    ]);
  });

  it("treats everything as talent while the account is unknown", () => {
    const thread = toThread([message("a", { senderId: ME })], null, time);
    expect(thread[0]).toMatchObject({ sender: "talent" });
  });

  it("maps camelCase attachments and only links https urls", () => {
    const attachment = (fileUrl: string) => ({
      id: "att",
      messageId: "a",
      attachmentType: "FILE",
      createdAt: at(1),
      fileName: "spec.pdf",
      fileSize: 1024 * 1024 * 2,
      fileUrl,
      isAvailable: true,
      mimeType: "application/pdf",
      storageKey: "k",
    });
    const [ok] = toThread(
      [message("a", { attachments: [attachment("https://cdn.example/x")] })],
      ME,
      time,
    );
    expect(ok).toMatchObject({
      kind: "text",
      attachment: {
        name: "spec.pdf",
        size: "2.0 MB",
        type: "application/pdf",
        url: "https://cdn.example/x",
      },
    });
    const [bad] = toThread(
      [message("a", { attachments: [attachment("javascript:alert(1)")] })],
      ME,
      time,
    );
    expect(bad).toMatchObject({ attachment: { url: undefined } });
  });

  it("shows an attachment-only message", () => {
    const [item] = toThread([message("a", { body: null })], ME, time);
    expect(item).toMatchObject({ text: "Shared an attachment." });
  });

  it("reads the contract offer amount in cents and its state", () => {
    const offer = system("offer", "CONTRACT_OFFER", {
      contractId: "c1",
      title: "Site",
      firstMilestone: { title: "m", amountCents: 150000 },
    });
    expect(toThread([offer], ME, time)[0]).toMatchObject({
      kind: "contract",
      amountCents: 150000,
      status: "Awaiting acceptance",
      href: "/contracts?contractId=c1",
    });
    const accepted = system(
      "acc",
      "CONTRACT_ACCEPTED",
      { contractId: "c1" },
      2,
    );
    const thread = toThread([offer, accepted], ME, time);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ status: "Active" });
    const done = system("done", "CONTRACT_COMPLETED", { contractId: "c1" }, 3);
    expect(toThread([offer, accepted, done], ME, time)[0]).toMatchObject({
      status: "Completed",
    });
  });

  it("does not read a legacy dollar amount", () => {
    const offer = system("offer", "CONTRACT_OFFER", {
      contractId: "c1",
      firstMilestone: { amount: 100 },
    });
    expect(toThread([offer], ME, time)[0]).toMatchObject({ amountCents: 0 });
  });

  it("follows a milestone submission to approval or requested changes", () => {
    const submitted = system("sub", "MILESTONE_SUBMITTED", {
      contractId: "c1",
      milestoneId: "m1",
      milestoneTitle: "Design",
      amountCents: 5000,
      submissionMessage: "done",
      submissionDeliveryLink: "https://files.example/d",
    });
    const first = toThread([submitted], ME, time)[0];
    expect(first).toMatchObject({
      kind: "milestone",
      sender: "talent",
      status: "Submitted",
      amountCents: 5000,
      milestoneId: "m1",
      contractId: "c1",
      submissionDeliveryLink: "https://files.example/d",
    });
    const approved = system(
      "ok",
      "MILESTONE_APPROVED",
      { milestoneId: "m1" },
      2,
    );
    const afterApproval = toThread([submitted, approved], ME, time);
    expect(afterApproval).toHaveLength(1);
    expect(afterApproval[0]).toMatchObject({ status: "Approved" });
    const changes = system(
      "chg",
      "MILESTONE_CHANGES_REQUESTED",
      { milestoneId: "m1" },
      2,
    );
    expect(toThread([submitted, changes], ME, time)[0]).toMatchObject({
      status: "Changes requested",
    });
  });

  it("drops a delivery link with credentials or a bad protocol", () => {
    for (const link of [
      "https://u:p@files.example/d",
      "http://files.example/d",
      "javascript:alert(1)",
    ]) {
      const submitted = system("sub", "MILESTONE_SUBMITTED", {
        contractId: "c1",
        milestoneId: "m1",
        amountCents: 100,
        submissionDeliveryLink: link,
      });
      expect(toThread([submitted], ME, time)[0]).toMatchObject({
        submissionDeliveryLink: undefined,
      });
    }
  });

  it("maps funded and added milestones", () => {
    const funded = system("f", "MILESTONE_FUNDED", {
      contractId: "c1",
      milestoneId: "m1",
      milestoneTitle: "Design",
      amountCents: 7000,
      requirements: "be quick",
    });
    expect(toThread([funded], ME, time)[0]).toMatchObject({
      status: "Funded",
      sender: "client",
      amountCents: 7000,
      submissionMessage: "be quick",
    });
    const added = system("a", "MILESTONE_ADDED", {
      contractId: "c1",
      milestoneId: "m2",
      amountCents: 1000,
      dueDate: "2026-12-01",
    });
    expect(toThread([added], ME, time)[0]).toMatchObject({
      status: "Added",
      dueDate: "2026-12-01",
    });
  });

  it("maps meetings and ignores an invalid join url", () => {
    const started = system("s", "MEETING_STARTED", {
      meetingId: "mt",
      joinUrl: "https://meet.example/room",
    });
    const ended = system(
      "e",
      "MEETING_ENDED",
      {
        meetingId: "mt",
        durationMinutes: 12,
      },
      2,
    );
    const thread = toThread([started, ended], ME, time);
    expect(thread[0]).toMatchObject({
      kind: "meeting",
      ended: true,
      meetUrl: "https://meet.example/room",
    });
    expect(thread[1]).toMatchObject({
      kind: "meeting_ended",
      durationMinutes: 12,
    });
    const unsafe = system("s2", "MEETING_STARTED", {
      meetingId: "x",
      joinUrl: "javascript:alert(1)",
    });
    expect(toThread([unsafe], ME, time)[0]).toMatchObject({ meetUrl: "" });
  });

  it("is stable when the same id arrives twice before dedupe", () => {
    const thread = toThread(
      dedupeMessages([message("a"), message("a"), message("b")]),
      ME,
      time,
    );
    expect(thread.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});
