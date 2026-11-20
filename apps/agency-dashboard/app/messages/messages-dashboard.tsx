"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { format } from "timeago.js";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { playIncomingMessageSound } from "@/hooks/message-sound";
import { markConversationLocallyRead } from "@/hooks/use-unread-messages";
import { AgencyShell } from "../_components/dashboard/agency-shell";
import { ConversationPanel } from "../_components/messages/conversation-panel";
import { InboxList } from "../_components/messages/inbox-list";
import type { AgencyConversation, AgencyChatMessage } from "../_components/messages/types";
import { Icon } from "../_components/ui/icon";

type ApiConversation = {
  id: string;
  jobId: string | null;
  contractId: string | null;
  contractStatus: string | null;
  unreadCount: number;
  jobTitle: string | null;
  lastMessageAt: string | null;
  lastAttachmentName: string | null;
  lastMessage: { body: string | null; eventType: string | null } | null;
  participants: Array<{
    accountId: string | null;
    agencyId: string | null;
    participantType: string;
    name: string;
    avatarUrl: string | null;
  }>;
  activeMeeting: { id: string; joinUrl: string; startedAt: string } | null;
};

type ApiMessage = {
  id: string;
  senderId: string | null;
  messageType: string;
  body: string | null;
  eventType: string | null;
  eventPayload: Record<string, unknown> | null;
  createdAt: string;
  replyToMessageId: string | null;
  attachments: Array<{
    file_name: string;
    file_url: string;
    file_size: number;
    mime_type: string;
  }>;
};

type MessagePage = { messages: ApiMessage[]; nextCursor: string | null };

const updateLatestMessages = (
  current: InfiniteData<MessagePage> | undefined,
  update: (messages: ApiMessage[]) => ApiMessage[],
): InfiniteData<MessagePage> =>
  current
    ? {
        ...current,
        pages: current.pages.map((page, index) =>
          index === 0 ? { ...page, messages: update(page.messages) } : page,
        ),
      }
    : {
        pages: [{ messages: update([]), nextCursor: null }],
        pageParams: [undefined],
      };

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("File could not be read."));
    reader.readAsDataURL(file);
  });

export function MessagesDashboard({
  conversationId,
}: {
  conversationId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken, userId } = useAuth();
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [acceptingContractId, setAcceptingContractId] = useState<
    string | null
  >(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUser, setTypingUser] = useState<{
    conversationId: string;
    userId: string;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const markedReadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void getToken().then((token) => {
      if (!active || !token) return;
      const socket = io(new URL(process.env.NEXT_PUBLIC_SERVER_URI!).origin, {
        auth: { token, role: "freelancer", scope: "agency" },
      });
      socketRef.current = socket;
      socket.on(
        "presence:snapshot",
        ({ userIds }: { userIds: string[] }) => setOnlineUsers(new Set(userIds)),
      );
      socket.on(
        "presence:update",
        ({ userId: changedUserId, online }: { userId: string; online: boolean }) =>
          setOnlineUsers((current) => {
            const next = new Set(current);
            online ? next.add(changedUserId) : next.delete(changedUserId);
            return next;
          }),
      );
      socket.on(
        "conversation:update",
        ({
          conversationId: changedConversationId,
          messagesChanged,
          senderId,
        }: {
          conversationId: string;
          messagesChanged?: boolean;
          senderId?: string | null;
        }) => {
          if (senderId !== userId) playIncomingMessageSound();
          void queryClient.invalidateQueries({
            queryKey: ["agency-conversations"],
          });
          if (messagesChanged !== false)
            void queryClient.invalidateQueries({
              queryKey: ["agency-conversation-messages", changedConversationId],
            });
        },
      );
      socket.on(
        "typing:update",
        ({
          conversationId,
          userId,
          isTyping,
        }: {
          conversationId: string;
          userId: string;
          isTyping: boolean;
        }) => setTypingUser(isTyping ? { conversationId, userId } : null),
      );
    });
    return () => {
      active = false;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [getToken, queryClient, userId]);

  const { data: agency } = useQuery<{ name: string } | null>({
    queryKey: ["agency-mine"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/agency/mine?role=freelancer`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || "The agency could not be loaded.");
      }
      return result.data;
    },
  });

  const { data: inbox, isLoading: inboxLoading } = useQuery<{
    conversations: ApiConversation[];
    totalUnread: number;
  }>({
    queryKey: ["agency-conversations"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations?role=freelancer&scope=agency`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  const selectedConversation = inbox?.conversations.find(
    ({ id }) => id === conversationId,
  );

  const {
    data: messageData,
    isLoading: messagesLoading,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteQuery<MessagePage>({
    queryKey: ["agency-conversation-messages", conversationId],
    enabled: Boolean(selectedConversation),
    initialPageParam: undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam }) => {
      const token = await getToken();
      const cursor =
        typeof pageParam === "string"
          ? `&cursor=${encodeURIComponent(pageParam)}`
          : "";
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${conversationId}/messages?role=freelancer${cursor}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data;
    },
  });

  const loadedMessages = useMemo(
    () =>
      (messageData?.pages ?? [])
        .slice()
        .reverse()
        .flatMap((page) => page.messages),
    [messageData?.pages],
  );

  const conversations: AgencyConversation[] = useMemo(
    () =>
      (inbox?.conversations ?? []).map((conversation) => {
        const person = conversation.participants.find(
          ({ participantType }) => participantType !== "AGENCY",
        );
        return {
          id: conversation.id,
          client: person?.name ?? "Client",
          avatarUrl: person?.avatarUrl,
          initials: (person?.name ?? "Client")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2),
          contextTitle: conversation.jobTitle ?? "Direct conversation",
          contextHref:
            conversation.contractStatus === "ACTIVE" && conversation.contractId
              ? `/contracts?contractId=${conversation.contractId}`
              : "/proposals",
          contextLabel:
            conversation.contractStatus === "ACTIVE"
              ? "View contract details"
              : "View proposal",
          online: person
            ? onlineUsers.has(person.agencyId ?? person.accountId ?? "")
            : false,
          unread:
            conversation.id === conversationId ? 0 : conversation.unreadCount,
          lastMessage:
            conversation.lastMessage?.body ??
            conversation.lastMessage?.eventType ??
            (conversation.lastAttachmentName
              ? `Attachment – ${conversation.lastAttachmentName}`
              : null) ??
            "Conversation started",
          lastMessageTime: conversation.lastMessageAt
            ? format(conversation.lastMessageAt)
            : "New",
          messages: [],
          activeMeeting: conversation.activeMeeting,
        };
      }),
    [conversationId, inbox, onlineUsers, userId],
  );

  const selectedBase = conversations.find(({ id }) => id === conversationId);

  const selectedConversationRaw = inbox?.conversations.find(
    (conversation) => conversation.id === conversationId,
  );
  const clientAccountId = selectedConversationRaw?.participants.find(
    (participant) => participant.participantType === "CLIENT",
  )?.accountId;
  const contractStatuses = new Map<
    string,
    "Active" | "Declined" | "Completed"
  >();
  const endedMeetingIds = new Set<string>();
  loadedMessages.forEach((message) => {
    if (
      message.messageType === "SYSTEM_EVENT" &&
      message.eventType === "MEETING_ENDED"
    ) {
      const meetingId = (
        message.eventPayload as { meetingId?: string } | null
      )?.meetingId;
      if (meetingId) endedMeetingIds.add(meetingId);
    }
    if (
      message.messageType === "SYSTEM_EVENT" &&
      (message.eventType === "CONTRACT_ACCEPTED" ||
        message.eventType === "CONTRACT_DECLINED" ||
        message.eventType === "CONTRACT_COMPLETED")
    ) {
      const contractId = (
        message.eventPayload as { contractId?: string } | null
      )?.contractId;
      if (contractId) {
        contractStatuses.set(
          contractId,
          message.eventType === "CONTRACT_COMPLETED"
            ? "Completed"
            : message.eventType === "CONTRACT_ACCEPTED"
              ? "Active"
              : "Declined",
        );
      }
    }
  });
  const selectedMessages: AgencyChatMessage[] = loadedMessages
    .filter(
      (message) =>
        !(
          message.messageType === "SYSTEM_EVENT" &&
          (message.eventType === "CONTRACT_ACCEPTED" ||
            message.eventType === "CONTRACT_DECLINED")
        ),
    )
    .map((message) => {
      if (
        message.messageType === "SYSTEM_EVENT" &&
        message.eventType === "CONTRACT_COMPLETED"
      ) {
        const payload = message.eventPayload as {
          contractId?: string;
          title?: string;
        } | null;
        return {
          id: message.id,
          kind: "contract_completed",
          sender: "system",
          contractId: payload?.contractId,
          title: payload?.title ?? "Contract completed",
          href: payload?.contractId
            ? `/contracts?contractId=${payload.contractId}`
            : "/contracts",
          time: format(message.createdAt),
        };
      }

      if (
        message.messageType === "SYSTEM_EVENT" &&
        message.eventType === "CONTRACT_OFFER"
      ) {
        const payload = message.eventPayload as {
          contractId?: string;
          title?: string;
          firstMilestone?: { amount?: number };
        } | null;
        const contractId = payload?.contractId ?? "";
        return {
          id: message.id,
          kind: "contract",
          contractId,
          sender: "client",
          title: payload?.title ?? "Contract offer",
          amount: Number(payload?.firstMilestone?.amount ?? 0),
          status: contractStatuses.get(contractId) ?? "Awaiting acceptance",
          href: payload?.contractId
            ? `/contracts?contractId=${payload.contractId}`
            : "/contracts",
          time: format(message.createdAt),
        };
      }

      if (
        message.messageType === "SYSTEM_EVENT" &&
        (message.eventType === "MILESTONE_SUBMITTED" ||
          message.eventType === "MILESTONE_ADDED" ||
          message.eventType === "MILESTONE_FUNDED" ||
          message.eventType === "MILESTONE_APPROVED" ||
          message.eventType === "MILESTONE_CHANGES_REQUESTED")
      ) {
        const payload = message.eventPayload as {
          contractId?: string;
          milestoneTitle?: string;
          amount?: number;
          submissionMessage?: string;
          submissionDeliveryLink?: string | null;
          requirements?: string | null;
          dueDate?: string;
        } | null;
        return {
          id: message.id,
          kind: "milestone",
          sender:
            message.eventType === "MILESTONE_SUBMITTED" ? "agency" : "client",
          title: payload?.milestoneTitle ?? "Milestone update",
          amount: Number(payload?.amount ?? 0),
          status:
            message.eventType === "MILESTONE_APPROVED"
              ? "Approved"
              : message.eventType === "MILESTONE_CHANGES_REQUESTED"
                ? "Changes requested"
                : message.eventType === "MILESTONE_ADDED"
                  ? "Added"
                  : message.eventType === "MILESTONE_FUNDED"
                    ? "Funded"
                    : "Submitted",
          href: payload?.contractId
            ? `/contracts?contractId=${payload.contractId}`
            : "/contracts",
          time: format(message.createdAt),
          note: payload?.submissionMessage ?? payload?.requirements ?? undefined,
          deliveryLink: payload?.submissionDeliveryLink ?? undefined,
          dueDate: payload?.dueDate,
        };
      }

      if (
        message.messageType === "SYSTEM_EVENT" &&
        message.eventType === "MEETING_STARTED"
      ) {
        const payload = message.eventPayload as {
          joinUrl?: string;
          meetingId?: string;
        } | null;
        return {
          id: message.id,
          kind: "meeting",
          sender: message.senderId === clientAccountId ? "client" : "agency",
          title: "Video meeting",
          startsAt: `Started ${format(message.createdAt)}`,
          meetUrl: payload?.joinUrl ?? "",
          ended: payload?.meetingId
            ? endedMeetingIds.has(payload.meetingId)
            : false,
          time: format(message.createdAt),
        };
      }

      if (
        message.messageType === "SYSTEM_EVENT" &&
        message.eventType === "MEETING_ENDED"
      ) {
        const payload = message.eventPayload as {
          durationMinutes?: number;
        } | null;
        return {
          id: message.id,
          kind: "meeting_ended",
          durationMinutes: payload?.durationMinutes ?? 0,
          time: format(message.createdAt),
        };
      }

      return {
        id: message.id,
        kind: "text",
        sender: message.senderId === clientAccountId ? "client" : "agency",
        text: message.body ?? "Shared an attachment.",
        time: format(message.createdAt),
        replyToId: message.replyToMessageId ?? undefined,
        attachment: message.attachments[0]
          ? {
              name: message.attachments[0].file_name,
              size: `${(message.attachments[0].file_size / 1024 / 1024).toFixed(1)} MB`,
              type: message.attachments[0].mime_type,
              url: message.attachments[0].file_url,
            }
          : undefined,
      };
    });
  const selected = selectedBase
    ? { ...selectedBase, messages: selectedMessages }
    : undefined;

  useEffect(() => {
    const lastMessage = loadedMessages.findLast(
      ({ id }) => !id.startsWith("optimistic-"),
    );
    if (!selectedConversation || !lastMessage) return;
    const readKey = `${selectedConversation.id}:${lastMessage.id}`;
    if (markedReadRef.current === readKey) return;
    markedReadRef.current = readKey;
    markConversationLocallyRead(selectedConversation.id);
    queryClient.setQueryData<{
      conversations: ApiConversation[];
      totalUnread: number;
    }>(["agency-conversations"], (current) =>
      current
        ? {
            ...current,
            totalUnread: Math.max(
              0,
              current.totalUnread - selectedConversation.unreadCount,
            ),
            conversations: current.conversations.map((conversation) =>
              conversation.id === selectedConversation.id
                ? { ...conversation, unreadCount: 0 }
                : conversation,
            ),
          }
        : current,
    );
    if (socketRef.current?.connected) {
      socketRef.current.emit("conversation:read", {
        conversationId: selectedConversation.id,
        messageId: lastMessage.id,
      });
      return;
    }
    void getToken().then((token) =>
      fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selectedConversation.id}/read?role=freelancer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
        },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("Messages could not be marked read.");
        })
        .catch(() => {
          if (markedReadRef.current === readKey) markedReadRef.current = null;
        }),
    );
  }, [getToken, loadedMessages, queryClient, selectedConversation]);

  const selectConversation = (conversation: AgencyConversation) =>
    router.push(`/messages?conversationId=${conversation.id}`);

  const sendMessage = async (text: string, file?: File) => {
    if ((!text && !file) || !selected || sending || selected.activeMeeting)
      return;
    const optimisticId = `optimistic-${Date.now()}`;
    setSending(true);
    queryClient.setQueryData<{
      conversations: ApiConversation[];
      totalUnread: number;
    }>(["agency-conversations"], (current) =>
      current
        ? {
            ...current,
            conversations: current.conversations.map((conversation) =>
              conversation.id === selected.id
                ? {
                    ...conversation,
                    lastMessage: { body: text || null, eventType: null },
                    lastAttachmentName: file?.name ?? null,
                    lastMessageAt: new Date().toISOString(),
                  }
                : conversation,
            ),
          }
        : current,
    );
    queryClient.setQueryData<InfiniteData<MessagePage>>(
      ["agency-conversation-messages", selected.id],
      (current) =>
        updateLatestMessages(current, (messages) => [
          ...messages,
          {
            id: optimisticId,
            senderId: userId ?? null,
            messageType: "USER",
            body: text || null,
            eventType: null,
            eventPayload: null,
            createdAt: new Date().toISOString(),
            replyToMessageId: null,
            attachments: file
              ? [
                  {
                    file_name: file.name,
                    file_url: "",
                    file_size: file.size,
                    mime_type: file.type,
                  },
                ]
              : [],
          },
        ]),
    );

    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selected.id}/messages?role=freelancer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: text || undefined,
            attachments: file
              ? [
                  {
                    fileUrl: await readFile(file),
                    fileName: file.name,
                    fileSize: file.size,
                    mimeType: file.type,
                  },
                ]
              : [],
          }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      queryClient.setQueryData<InfiniteData<MessagePage>>(
        ["agency-conversation-messages", selected.id],
        (current) =>
          updateLatestMessages(current, (messages) =>
            messages.map((message) =>
              message.id === optimisticId ? result.data : message,
            ),
          ),
      );
    } catch (error) {
      queryClient.setQueryData<InfiniteData<MessagePage>>(
        ["agency-conversation-messages", selected.id],
        (current) =>
          updateLatestMessages(current, (messages) =>
            messages.filter(({ id }) => id !== optimisticId),
          ),
      );
      void queryClient.invalidateQueries({
        queryKey: ["agency-conversations"],
      });
      setSending(false);
      return;
    }

    setSending(false);
    socketRef.current?.emit("typing:set", {
      conversationId: selected.id,
      isTyping: false,
    });
  };

  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [meetingError, setMeetingError] = useState("");

  const createMeeting = async () => {
    if (!selected) return;
    if (selected.activeMeeting) {
      window.open(
        selected.activeMeeting.joinUrl,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    if (creatingMeeting) return;
    setCreatingMeeting(true);
    setMeetingError("");
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selected.id}/meetings?role=freelancer`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      window.open(result.data.joinUrl, "_blank", "noopener,noreferrer");
      await queryClient.invalidateQueries({
        queryKey: ["agency-conversations"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["agency-conversation-messages", selected.id],
      });
    } catch (error) {
      setMeetingError(
        error instanceof Error ? error.message : "Meeting could not be created.",
      );
    } finally {
      setCreatingMeeting(false);
    }
  };

  const acceptContractOffer = async (contractId: string) => {
    if (acceptingContractId) return;
    setAcceptingContractId(contractId);
    try {
      let profile = queryClient.getQueryData<{ identityVerified?: boolean }>([
        "profile-metadata",
      ]);

      if (!profile) {
        profile = await queryClient.fetchQuery({
          queryKey: ["profile-metadata"],
          queryFn: async () => {
            const token = await getToken();
            const response = await fetch(
              `${process.env.NEXT_PUBLIC_SERVER_URI}/freelancer/profile?role=freelancer`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            return result.data;
          },
        });
      }

      if (!profile?.identityVerified) {
        router.push("/settings?section=verification&active=true");
        return;
      }

      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${contractId}/accept?role=freelancer&scope=agency`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["agency-contracts"] }),
        queryClient.invalidateQueries({ queryKey: ["agency-conversations"] }),
        queryClient.invalidateQueries({
          queryKey: ["agency-conversation-messages", conversationId],
        }),
      ]);
    } finally {
      setAcceptingContractId(null);
    }
  };

  const filtered = useMemo(
    () =>
      conversations.filter((item) =>
        `${item.client} ${item.contextTitle}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [conversations, search],
  );

  const otherPartyTyping = Boolean(
    typingUser &&
      typingUser.conversationId === conversationId &&
      typingUser.userId !== userId,
  );

  return (
    <AgencyShell>
      <div className="mb-5 hidden items-end justify-between lg:flex">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-[#62805f] uppercase">
            Client communication
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em]">
            Inbox
          </h1>
        </div>
        <p className="text-xs text-[#7b8078]">
          {conversations.reduce((total, item) => total + item.unread, 0)} unread{" "}
          messages
        </p>
      </div>

      <div className="grid h-[calc(100svh-7.5rem)] min-h-160 items-stretch gap-4 lg:h-[calc(100svh-15.5rem)] lg:grid-cols-[330px_minmax(0,1fr)]">
        <div className={`min-h-0 ${selected ? "hidden lg:block" : "block"}`}>
          <InboxList
            conversations={filtered}
            activeId={conversationId ?? null}
            search={search}
            onSearch={setSearch}
            onSelect={selectConversation}
            loading={inboxLoading}
          />
        </div>

        <div className={`min-h-0 min-w-0 ${selected ? "block" : "hidden lg:block"}`}>
          {selected ? (
            <ConversationPanel
              conversation={selected}
              agencyName={agency?.name ?? "your agency"}
              onBack={() => router.push("/messages")}
              onSend={(text) => void sendMessage(text)}
              onSendFile={(file) => void sendMessage("", file)}
              onAcceptOffer={(contractId) =>
                void acceptContractOffer(contractId)
              }
              acceptingContractId={acceptingContractId}
              onCreateMeeting={() => void createMeeting()}
              creatingMeeting={creatingMeeting}
              meetingError={meetingError}
              onTyping={(isTyping) =>
                socketRef.current?.emit("typing:set", {
                  conversationId: selected.id,
                  isTyping,
                })
              }
              otherPartyTyping={otherPartyTyping}
              sending={sending}
              messagesLoading={messagesLoading}
              hasMoreMessages={Boolean(hasNextPage)}
              loadingMore={isFetchingNextPage}
              onLoadMore={async () => {
                await fetchNextPage();
              }}
            />
          ) : conversationId ? (
            <section className="grid h-full min-h-0 place-items-center rounded-2xl border border-black/8 bg-white p-8 text-center">
              <div>
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#edf4ea] text-[#52784f]">
                  <Icon name="message" size={31} />
                </span>
                <h2 className="mt-5 text-lg font-semibold">
                  {inboxLoading ? "Loading conversation..." : "Conversation not found"}
                </h2>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#7b8078]">
                  {inboxLoading
                    ? "Please wait while the conversation is loaded."
                    : "This conversation does not exist or you do not have access to it."}
                </p>
              </div>
            </section>
          ) : (
            <section className="grid h-full min-h-0 place-items-center rounded-2xl border border-black/8 bg-white p-8 text-center">
              <div>
                <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#edf4ea] text-[#52784f]">
                  <Icon name="message" size={31} />
                </span>
                <h2 className="mt-5 text-lg font-semibold">
                  Select a conversation
                </h2>
                <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#7b8078]">
                  Choose a client conversation to view messages, share files,
                  or create a project meeting.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </AgencyShell>
  );
}
