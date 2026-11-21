export type ClientConversation = {
  id: string;
  person: string;
  initials: string;
  avatarUrl?: string | null;
  accountType: "Freelancer" | "Agency";
  context: string;
  contextHref: string;
  contextLabel: string;
  unread: number;
  lastMessage: string;
  time: string;
  messages: ClientMessage[];
  activeMeeting: { id: string; joinUrl: string; startedAt: string } | null;
};

export type ClientMessage =
  | {
      id: number | string;
      kind: "text";
      sender: "client" | "talent";
      text: string;
      time: string;
      replyToId?: number | string;
      attachment?: {
        name: string;
        size: string;
        type: string;
        url?: string;
      };
    }
  | {
      id: number | string;
      kind: "proposal";
      sender: "talent";
      title: string;
      bidCents: number;
      duration: string;
      summary: string;
      skills: string[];
      href: string;
      time: string;
    }
  | {
      id: number | string;
      kind: "meeting";
      sender: "client" | "talent";
      title: string;
      startsAt: string;
      meetUrl: string;
      ended: boolean;
      time: string;
    }
  | {
      id: number | string;
      kind: "meeting_ended";
      durationMinutes: number;
      time: string;
    }
  | {
      id: number | string;
      kind: "contract";
      sender: "client";
      title: string;
      amountCents: number;
      status: "Awaiting acceptance" | "Active" | "Completed";
      href: string;
      time: string;
    }
  | {
      id: number | string;
      kind: "contract_completed";
      sender: "system" | "client" | "talent";
      title: string;
      href: string;
      time: string;
      contractId?: string;
    }
  | {
      id: number | string;
      kind: "milestone";
      sender: "client" | "talent";
      title: string;
      amountCents: number;
      status:
        "Added" | "Funded" | "Submitted" | "Changes requested" | "Approved";
      href: string;
      time: string;
      contractId?: string;
      milestoneId?: string;
      submissionMessage?: string;
      submissionDeliveryLink?: string;
      dueDate?: string;
    }
  | {
      id: number | string;
      kind: "payment";
      sender: "system";
      title: string;
      amountCents: number;
      status: "Protected in escrow" | "Released";
      time: string;
    };
