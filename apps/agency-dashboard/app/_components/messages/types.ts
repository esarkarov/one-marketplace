export type AgencyChatMessage =
  | {
      id: string;
      kind: "text";
      sender: "agency" | "client";
      text: string;
      time: string;
      replyToId?: string;
      attachment?: {
        name: string;
        size: string;
        type: string;
        url?: string;
      };
    }
  | {
      id: string;
      kind: "contract";
      contractId: string;
      sender: "client";
      title: string;
      amount: number;
      status: "Awaiting acceptance" | "Active" | "Declined" | "Completed";
      href: string;
      time: string;
    }
  | {
      id: string;
      kind: "contract_completed";
      sender: "system" | "client" | "agency";
      title: string;
      href: string;
      time: string;
      contractId?: string;
    }
  | {
      id: string;
      kind: "milestone";
      sender: "client" | "agency";
      title: string;
      amount: number;
      status:
        | "Added"
        | "Funded"
        | "Submitted"
        | "Changes requested"
        | "Approved";
      href: string;
      time: string;
      note?: string;
      deliveryLink?: string;
      dueDate?: string;
    }
  | {
      id: string;
      kind: "meeting";
      sender: "client" | "agency";
      title: string;
      startsAt: string;
      meetUrl: string;
      ended: boolean;
      time: string;
    }
  | {
      id: string;
      kind: "meeting_ended";
      durationMinutes: number;
      time: string;
    };

export type AgencyConversation = {
  id: string;
  client: string;
  avatarUrl?: string | null;
  initials: string;
  contextTitle: string;
  contextHref: string;
  contextLabel: string;
  online: boolean;
  unread: number;
  lastMessage: string;
  lastMessageTime: string;
  messages: AgencyChatMessage[];
  activeMeeting: { id: string; joinUrl: string; startedAt: string } | null;
};
