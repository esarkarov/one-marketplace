"use client";

import { Icon } from "@iconify/react";
import { useAuth } from "@clerk/nextjs";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { playIncomingMessageSound } from "../../hooks/message-sound";
import { markConversationLocallyRead } from "../../hooks/use-unread-messages";
import {
  type ClientConversation,
  type ClientMessage,
} from "../data/client-data";

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
  const [draft, setDraft] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [typingUser, setTypingUser] = useState<{
    conversationId: string;
    userId: string;
  } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const userScrolledMessagesRef = useRef(false);
  const markedReadRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void getToken().then((token) => {
      if (!active || !token) return;
      const socket = io(new URL(process.env.NEXT_PUBLIC_SERVER_URI!).origin, {
        auth: { token, role: "client" },
      });
      socketRef.current = socket;
      socket.on("connect", () => setSocketReady(true));
      socket.on("disconnect", () => setSocketReady(false));
      socket.on("presence:snapshot", ({ userIds }: { userIds: string[] }) =>
        setOnlineUsers(new Set(userIds)),
      );
      socket.on(
        "presence:update",
        ({
          userId: changedUserId,
          online,
        }: {
          userId: string;
          online: boolean;
        }) =>
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
            queryKey: ["client-conversations"],
          });
          if (messagesChanged !== false)
            void queryClient.invalidateQueries({
              queryKey: ["conversation-messages", changedConversationId],
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
      setSocketReady(false);
    };
  }, [conversationId, getToken, queryClient, userId]);

  const { data: inbox, isLoading: inboxLoading } = useQuery<{
    conversations: ApiConversation[];
    totalUnread: number;
  }>({
    queryKey: ["client-conversations"],
    queryFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations?role=client`,
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
    queryKey: ["conversation-messages", conversationId],
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
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${conversationId}/messages?role=client${cursor}`,
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

  const conversations: ClientConversation[] = useMemo(
    () =>
      (inbox?.conversations ?? []).map((conversation) => {
        const person = conversation.participants.find(
          ({ accountId }) => accountId !== userId,
        );
        return {
          id: conversation.id,
          person: person?.name ?? "Freelancer",
          avatarUrl: person?.avatarUrl,
          initials: (person?.name ?? "Freelancer")
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2),
          accountType:
            person?.participantType === "AGENCY" ? "Agency" : "Freelancer",
          context: conversation.jobTitle ?? "Direct conversation",
          contextHref:
            conversation.contractStatus === "ACTIVE" && conversation.contractId
              ? `/contracts?contractId=${conversation.contractId}`
              : conversation.jobId
                ? `/proposals/${conversation.jobId}`
                : "/proposals",
          contextLabel:
            conversation.contractStatus === "ACTIVE"
              ? "View contract details"
              : "View project details",
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
          time: conversation.lastMessageAt
            ? formatDistanceToNow(new Date(conversation.lastMessageAt), {
                addSuffix: true,
              })
            : "New",
          messages: [],
          activeMeeting: conversation.activeMeeting,
        };
      }),
    [conversationId, inbox, onlineUsers, userId],
  );

  const selectedBase = conversations.find(({ id }) => id === conversationId);
  const activeContractIds = new Set<string>();
  const completedContractIds = new Set<string>();
  const endedMeetingIds = new Set<string>();
  const activeMilestoneSubmissions = new Map<string, string>();
  const milestoneSubmissionStatuses = new Map<
    string,
    "Submitted" | "Approved" | "Changes requested"
  >();
  loadedMessages.forEach((message) => {
    if (
      message.messageType === "SYSTEM_EVENT" &&
      message.eventType === "MILESTONE_SUBMITTED"
    ) {
      const milestoneId = (
        message.eventPayload as { milestoneId?: string } | null
      )?.milestoneId;
      if (milestoneId) {
        activeMilestoneSubmissions.set(milestoneId, message.id);
        milestoneSubmissionStatuses.set(message.id, "Submitted");
      }
    }
    if (
      message.messageType === "SYSTEM_EVENT" &&
      message.eventType === "CONTRACT_ACCEPTED"
    ) {
      const contractId = (
        message.eventPayload as { contractId?: string } | null
      )?.contractId;
      if (contractId) activeContractIds.add(contractId);
    }
    if (
      message.messageType === "SYSTEM_EVENT" &&
      message.eventType === "CONTRACT_COMPLETED"
    ) {
      const contractId = (
        message.eventPayload as { contractId?: string } | null
      )?.contractId;
      if (contractId) {
        completedContractIds.add(contractId);
        activeContractIds.delete(contractId);
      }
    }
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
      (message.eventType === "MILESTONE_APPROVED" ||
        message.eventType === "MILESTONE_CHANGES_REQUESTED")
    ) {
      const milestoneId = (
        message.eventPayload as { milestoneId?: string } | null
      )?.milestoneId;
      if (milestoneId) {
        const submissionId = activeMilestoneSubmissions.get(milestoneId);
        if (submissionId) {
          milestoneSubmissionStatuses.set(
            submissionId,
            message.eventType === "MILESTONE_APPROVED"
              ? "Approved"
              : "Changes requested",
          );
        }
      }
    }
  });
  const selectedMessages: ClientMessage[] = loadedMessages
    .filter(
      (message) =>
        !(
          message.messageType === "SYSTEM_EVENT" &&
          (message.eventType === "CONTRACT_ACCEPTED" ||
            message.eventType === "MILESTONE_APPROVED" ||
            message.eventType === "MILESTONE_CHANGES_REQUESTED")
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
          time: formatDistanceToNow(new Date(message.createdAt), {
            addSuffix: true,
          }),
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
          sender: "client",
          title: payload?.title ?? "Contract offer",
          amount: Number(payload?.firstMilestone?.amount ?? 0),
          status: completedContractIds.has(contractId)
            ? "Completed"
            : activeContractIds.has(contractId)
              ? "Active"
              : "Awaiting acceptance",
          href: payload?.contractId
            ? `/contracts?contractId=${payload.contractId}`
            : "/contracts",
          time: formatDistanceToNow(new Date(message.createdAt), {
            addSuffix: true,
          }),
        };
      }

      if (
        message.messageType === "SYSTEM_EVENT" &&
        (message.eventType === "MILESTONE_SUBMITTED" ||
          message.eventType === "MILESTONE_FUNDED" ||
          message.eventType === "MILESTONE_ADDED")
      ) {
        const payload = message.eventPayload as {
          contractId?: string;
          milestoneId?: string;
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
            message.eventType === "MILESTONE_SUBMITTED" ? "talent" : "client",
          title: payload?.milestoneTitle ?? "Milestone submitted",
          amount: Number(payload?.amount ?? 0),
          status:
            message.eventType === "MILESTONE_ADDED"
              ? "Added"
              : message.eventType === "MILESTONE_FUNDED"
                ? "Funded"
                : (milestoneSubmissionStatuses.get(message.id) ?? "Submitted"),
          href: payload?.contractId
            ? `/contracts?contractId=${payload.contractId}`
            : "/contracts",
          time: formatDistanceToNow(new Date(message.createdAt), {
            addSuffix: true,
          }),
          contractId: payload?.contractId,
          milestoneId: payload?.milestoneId,
          submissionMessage:
            payload?.submissionMessage ?? payload?.requirements ?? undefined,
          submissionDeliveryLink: payload?.submissionDeliveryLink ?? undefined,
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
          sender: message.senderId === userId ? "client" : "talent",
          title: "Video meeting",
          startsAt: `Started ${formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}`,
          meetUrl: payload?.joinUrl ?? "",
          ended: payload?.meetingId
            ? endedMeetingIds.has(payload.meetingId)
            : false,
          time: formatDistanceToNow(new Date(message.createdAt), {
            addSuffix: true,
          }),
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
          time: formatDistanceToNow(new Date(message.createdAt), {
            addSuffix: true,
          }),
        };
      }

      return {
        id: message.id,
        kind: "text",
        sender: message.senderId === userId ? "client" : "talent",
        text: message.body ?? "Shared an attachment.",
        time: formatDistanceToNow(new Date(message.createdAt), {
          addSuffix: true,
        }),
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
    userScrolledMessagesRef.current = false;
    if (loadingOlderRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationId, selectedMessages.length]);

  const loadOlderMessages = async () => {
    const container = messagesContainerRef.current;
    if (!container || !hasNextPage || isFetchingNextPage) return;
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    loadingOlderRef.current = true;
    await fetchNextPage();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        container.scrollTop =
          previousTop + container.scrollHeight - previousHeight;
        loadingOlderRef.current = false;
      }),
    );
  };

  const filtered = useMemo(
    () =>
      conversations.filter((item) =>
        `${item.person} ${item.context}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [conversations, search],
  );

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
    }>(["client-conversations"], (current) =>
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
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selectedConversation.id}/read?role=client`,
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
          if (!response.ok)
            throw new Error("Messages could not be marked read.");
        })
        .catch(() => {
          if (markedReadRef.current === readKey) markedReadRef.current = null;
        }),
    );
  }, [
    getToken,
    loadedMessages,
    queryClient,
    selectedConversation,
    socketReady,
  ]);

  const selectConversation = (conversation: ClientConversation) =>
    router.push(`/messages?conversationId=${conversation.id}`);

  const sendMessage = async (file?: File) => {
    const text = draft.trim();
    if ((!text && !file) || !selected || sending || selected.activeMeeting)
      return;
    const optimisticId = `optimistic-${Date.now()}`;
    setSending(true);
    setDraft("");
    queryClient.setQueryData<{
      conversations: ApiConversation[];
      totalUnread: number;
    }>(["client-conversations"], (current) =>
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
      ["conversation-messages", selected.id],
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
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selected.id}/messages?role=client`,
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
        ["conversation-messages", selected.id],
        (current) =>
          updateLatestMessages(current, (messages) =>
            messages.map((message) =>
              message.id === optimisticId ? result.data : message,
            ),
          ),
      );
    } catch (error) {
      queryClient.setQueryData<InfiniteData<MessagePage>>(
        ["conversation-messages", selected.id],
        (current) =>
          updateLatestMessages(current, (messages) =>
            messages.filter(({ id }) => id !== optimisticId),
          ),
      );
      setDraft(text);
      setFileError(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
      void queryClient.invalidateQueries({
        queryKey: ["client-conversations"],
      });
      setSending(false);
      return;
    }

    setSending(false);
    socketRef.current?.emit("typing:set", {
      conversationId: selected.id,
      isTyping: false,
    });
    setSelectedFile(null);
    setAttachmentOpen(false);
  };

  const reviewMilestone = async (
    message: Extract<ClientMessage, { kind: "milestone" }>,
    action: "APPROVE" | "REQUEST_CHANGES",
    feedback?: string,
  ) => {
    if (!message.contractId || !message.milestoneId) return;
    const token = await getToken();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SERVER_URI}/contracts/${message.contractId}/milestones/${message.milestoneId}/review?role=client`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action, feedback }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["conversation-messages", conversationId],
      }),
      queryClient.invalidateQueries({ queryKey: ["client-contracts"] }),
    ]);
  };

  const [creatingMeeting, setCreatingMeeting] = useState(false);

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
    try {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/conversations/${selected.id}/meetings?role=client`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      window.open(result.data.joinUrl, "_blank", "noopener,noreferrer");
      await queryClient.invalidateQueries({
        queryKey: ["client-conversations"],
      });
      await queryClient.invalidateQueries({
        queryKey: ["conversation-messages", selected.id],
      });
    } catch (error) {
      setFileError(
        error instanceof Error ? error.message : "Meeting could not be created.",
      );
    } finally {
      setCreatingMeeting(false);
    }
  };

  const chooseFile = (file?: File) => {
    setSelectedFile(null);
    setFileError("");
    if (!file) return;
    const allowedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(file.type)) {
      setFileError("Use PDF, DOCX, PNG, JPG, or TXT files only.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setFileError("The maximum attachment size is 5 MB.");
      return;
    }
    setSelectedFile(file);
  };

  const attachFile = () => selectedFile && void sendMessage(selectedFile);

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[.14em] text-[#62805f] uppercase">
            Project communication
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-.045em] sm:text-4xl">
            Messages
          </h1>
        </div>
        <p className="text-xs text-[#858a82]">
          {conversations.reduce((sum, item) => sum + item.unread, 0)} unread
          messages
        </p>
      </div>

      <div className="mt-7 grid h-[calc(100svh-13rem)] min-h-120 max-h-180 overflow-hidden rounded-2xl border border-black/8 bg-white lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col border-b border-black/7 lg:border-r lg:border-b-0">
          <header className="shrink-0 p-5">
            <h2 className="font-semibold">Project threads</h2>
            <p className="mt-1 text-[10px] text-[#858a82]">
              Proposals, meetings, contracts, and payments
            </p>
            <label className="mt-4 flex h-11 items-center gap-2 rounded-xl bg-[#f2f4f1] px-3">
              <Icon icon="solar:magnifer-linear" width="18" />
              <span className="sr-only">Search project threads</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search project threads"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-black/7">
            {filtered.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => selectConversation(conversation)}
                className={`flex w-full gap-3 border-b border-black/6 p-4 text-left ${
                  conversationId === conversation.id
                    ? "bg-[#edf4ea]"
                    : "hover:bg-[#f8f9f6]"
                }`}
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#527a73] text-xs font-semibold text-white">
                  {conversation.avatarUrl ? (
                    <Image
                      src={conversation.avatarUrl}
                      alt={conversation.person}
                      fill
                      className="rounded-full object-cover"
                    />
                  ) : (
                    conversation.initials
                  )}
                  {conversation.online && (
                    <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white bg-[#5ca568]" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-2">
                    <strong className="truncate text-sm">
                      {conversation.person}
                    </strong>
                    <span className="text-[10px] text-[#8a8f87]">
                      {conversation.time}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-[#7b8078]">
                    {conversation.accountType} · {conversation.context}
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#656b64]">
                    {conversation.lastMessage}
                  </span>
                </span>
                {conversation.unread > 0 && (
                  <span className="mt-7 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5f8d5c] px-1 text-[9px] text-white">
                    {conversation.unread}
                  </span>
                )}
              </button>
            ))}
            {!filtered.length && (
              <p className="p-8 text-center text-xs text-[#858a82]">
                No project threads found.
              </p>
            )}
          </div>
        </section>

        {selected ? (
          <section className="flex min-h-0 flex-col">
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-black/7 p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#527a73] text-xs font-semibold text-white">
                  {selected.avatarUrl ? (
                    <Image
                      src={selected.avatarUrl}
                      alt={selected.person}
                      fill
                      className="rounded-full object-cover"
                    />
                  ) : (
                    selected.initials
                  )}
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{selected.person}</h2>
                  <p className="mt-1 text-[10px] text-[#7b8078]">
                    {typingUser?.conversationId === selected.id
                      ? "Typing..."
                      : `${selected.accountType} · ${selected.online ? "Online" : "Offline"}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={createMeeting}
                disabled={creatingMeeting}
                className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                  selected.activeMeeting
                    ? "border-[#9dbc99] bg-[#e9f3e6] text-[#477344]"
                    : "border-black/10"
                }`}
              >
                <Icon icon="solar:videocamera-record-linear" width="18" />
                {creatingMeeting
                  ? "Starting…"
                  : selected.activeMeeting
                    ? "Join meeting"
                    : "Create meeting"}
              </button>
            </header>

            {selected.activeMeeting && (
              <div className="flex shrink-0 items-center gap-2 border-b border-black/7 bg-[#f2f7ef] px-5 py-2.5 text-xs font-medium text-[#52784f]">
                <Icon icon="solar:videocamera-record-linear" width="15" />
                Meeting in progress — chat is paused until it ends.
              </div>
            )}

            <div className="flex shrink-0 items-center justify-between border-b border-black/7 bg-[#fafbf9] px-5 py-3 text-xs">
              <span className="truncate">{selected.context}</span>
              <Link
                href={selected.contextHref}
                className="shrink-0 font-semibold text-[#52784f]"
              >
                {selected.contextLabel}
              </Link>
            </div>

            <div
              ref={messagesContainerRef}
              onWheel={() => {
                userScrolledMessagesRef.current = true;
              }}
              onTouchStart={() => {
                userScrolledMessagesRef.current = true;
              }}
              onScroll={(event) => {
                if (
                  userScrolledMessagesRef.current &&
                  event.currentTarget.scrollTop <= 40
                )
                  void loadOlderMessages();
              }}
              className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#fbfcfa] p-5"
            >
              {isFetchingNextPage && (
                <div className="flex justify-center py-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-[#638b60]" />
                </div>
              )}
              {!messagesLoading &&
                !hasNextPage &&
                selected.messages.length > 0 && (
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-black/7" />
                    <span className="text-[9px] font-medium text-[#969b94]">
                      Project activity
                    </span>
                    <span className="h-px flex-1 bg-black/7" />
                  </div>
                )}
              {selected.messages.map((message) => (
                <TransactionMessage
                  key={message.id}
                  message={message}
                  messages={selected.messages}
                  onReviewMilestone={reviewMilestone}
                />
              ))}
              {messagesLoading && (
                <div className="flex justify-center py-12">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-[#638b60]" />
                </div>
              )}
              {!messagesLoading && !selected.messages.length && (
                <p className="py-12 text-center text-xs text-[#858a82]">
                  This project thread is ready. Send the first message.
                </p>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 border-t border-black/7 bg-white p-4">
              <div className="flex items-end gap-2 rounded-xl border border-black/10 p-2">
                <button
                  type="button"
                  aria-label="Attach file"
                  onClick={() => setAttachmentOpen(true)}
                  disabled={Boolean(selected.activeMeeting)}
                  className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon icon="solar:paperclip-linear" width="20" />
                </button>
                <textarea
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    socketRef.current?.emit("typing:set", {
                      conversationId: selected.id,
                      isTyping: Boolean(event.target.value.trim()),
                    });
                  }}
                  onBlur={() =>
                    socketRef.current?.emit("typing:set", {
                      conversationId: selected.id,
                      isTyping: false,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={1}
                  disabled={Boolean(selected.activeMeeting)}
                  placeholder={
                    selected.activeMeeting
                      ? "Chat is paused during the meeting…"
                      : "Reply in this project thread…"
                  }
                  className="min-h-10 flex-1 resize-none py-2 text-sm outline-none disabled:cursor-not-allowed disabled:text-[#9a9e97]"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={sending || Boolean(selected.activeMeeting)}
                  aria-label="Send message"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#252724] text-white disabled:opacity-50"
                >
                  <Icon icon="solar:plain-2-bold" width="18" />
                </button>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex min-h-0 items-center justify-center p-8 text-center">
            <div>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#edf4ea] text-[#52784f]">
                <Icon icon="solar:chat-round-dots-linear" width="30" />
              </span>
              <h2 className="mt-5 font-semibold">
                {inboxLoading
                  ? "Loading conversation..."
                  : "Conversation does not exist"}
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#7b8078]">
                {inboxLoading
                  ? "Please wait while the conversation is loaded."
                  : "The conversation ID is missing or you do not have access to it."}
              </p>
            </div>
          </section>
        )}
      </div>
      {attachmentOpen && (
        <AttachmentModal
          file={selectedFile}
          error={fileError}
          uploading={sending}
          onChoose={chooseFile}
          onClose={() => {
            setAttachmentOpen(false);
            setSelectedFile(null);
            setFileError("");
          }}
          onAttach={attachFile}
        />
      )}
    </>
  );
}

function AttachmentModal({
  file,
  error,
  uploading,
  onChoose,
  onClose,
  onAttach,
}: {
  file: File | null;
  error: string;
  uploading: boolean;
  onChoose: (file?: File) => void;
  onClose: () => void;
  onAttach: () => void;
}) {
  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-[#1d221d]/45 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon icon="solar:paperclip-linear" width="23" />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close attachment modal"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/8"
          >
            <Icon icon="solar:close-circle-linear" width="19" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Add an attachment</h2>
        <p className="mt-2 text-sm leading-6 text-[#737970]">
          Review the file before sharing it in this project thread.
        </p>
        <label className="mt-5 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-black/15 bg-[#fafbf9] px-5 py-8 text-center">
          <Icon
            icon="solar:upload-minimalistic-linear"
            width="25"
            className="text-[#52784f]"
          />
          <span className="mt-2 text-sm font-semibold">Choose a file</span>
          <span className="mt-1 text-[11px] text-[#858a82]">
            PDF, DOCX, PNG, JPG, or TXT · Maximum 5 MB
          </span>
          <input
            type="file"
            accept=".pdf,.docx,.png,.jpg,.jpeg,.txt"
            className="sr-only"
            onChange={(event) => onChoose(event.target.files?.[0])}
          />
        </label>
        {file && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f0f3ee] p-3">
            <Icon icon="solar:file-text-linear" width="21" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{file.name}</p>
              <p className="mt-0.5 text-[10px] text-[#858a82]">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <Icon
              icon="solar:check-circle-bold"
              width="19"
              className="text-[#5d8759]"
            />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs font-medium text-[#9a5953]">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-black/10 px-4 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAttach}
            disabled={!file || uploading}
            className="h-10 rounded-xl bg-[#252724] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            {uploading ? "Uploading…" : "Attach file"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionMessage({
  message,
  messages,
  onReviewMilestone,
}: {
  message: ClientMessage;
  messages: ClientMessage[];
  onReviewMilestone: (
    message: Extract<ClientMessage, { kind: "milestone" }>,
    action: "APPROVE" | "REQUEST_CHANGES",
    feedback?: string,
  ) => Promise<void>;
}) {
  const [reviewing, setReviewing] = useState<
    "APPROVE" | "REQUEST_CHANGES" | null
  >(null);
  const [reviewDialog, setReviewDialog] = useState<
    "APPROVE" | "REQUEST_CHANGES" | null
  >(null);
  const [modificationMessage, setModificationMessage] = useState("");
  useEffect(() => {
    if (!reviewDialog) return;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousOverflow;
    };
  }, [reviewDialog]);
  if (message.kind === "text") {
    const repliedMessage = message.replyToId
      ? messages.find((item) => item.id === message.replyToId)
      : undefined;
    return (
      <div
        className={`flex ${
          message.sender === "client" ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-6 ${
            message.sender === "client"
              ? "bg-[#252724] text-white"
              : "bg-[#edf2eb]"
          }`}
        >
          {repliedMessage && (
            <div
              className={`mb-2 rounded-lg border-l-3 px-3 py-2 ${
                message.sender === "client"
                  ? "border-[#9fbd9b] bg-white/10"
                  : "border-[#6f966b] bg-white/65"
              }`}
            >
              <p
                className={`text-[9px] font-semibold tracking-wide uppercase ${
                  message.sender === "client"
                    ? "text-white/65"
                    : "text-[#52784f]"
                }`}
              >
                Replying to proposal
              </p>
              <p className="mt-0.5 truncate text-[10px] font-medium opacity-80">
                {repliedMessage.kind === "proposal"
                  ? repliedMessage.title
                  : "Previous message"}
              </p>
            </div>
          )}
          <p className="whitespace-pre-wrap">{message.text}</p>
          {message.attachment && (
            <div
              className={`mt-3 flex items-center gap-3 rounded-xl p-3 ${message.sender === "client" ? "bg-white/10" : "bg-white"}`}
            >
              <Icon icon="solar:file-text-linear" width="20" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {message.attachment.name}
                </span>
                <span className="block text-[9px] opacity-60">
                  {message.attachment.size}
                </span>
              </span>
              {message.attachment.url && (
                <a
                  href={message.attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Download ${message.attachment.name}`}
                >
                  <Icon icon="solar:download-minimalistic-linear" width="17" />
                </a>
              )}
            </div>
          )}
          <p
            className={`mt-1 text-[9px] ${
              message.sender === "client" ? "text-white/50" : "text-[#8a8f87]"
            }`}
          >
            {message.time}
          </p>
        </div>
      </div>
    );
  }

  if (message.kind === "meeting_ended") {
    return (
      <div className="mx-auto flex items-center gap-2 text-[10px] font-medium text-[#8a8f87]">
        <Icon icon="solar:videocamera-record-linear" width="14" />
        Meeting ended · {message.durationMinutes} min
      </div>
    );
  }

  if (message.kind === "payment") {
    return (
      <div className="mx-auto flex max-w-xl items-center gap-3 rounded-xl border border-[#d1dfcd] bg-[#edf4ea] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#52784f]">
          <Icon icon="solar:shield-check-linear" width="19" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold text-[#486d45]">
            Payment {message.status.toLowerCase()}
          </p>
          <p className="mt-1 truncate text-[10px] text-[#697467]">
            {message.title}
          </p>
        </div>
        <strong className="text-xs">${message.amount.toLocaleString()}</strong>
      </div>
    );
  }

  const eventStyle = {
    proposal: {
      icon: "solar:document-text-linear",
      eyebrow: "Proposal received",
      tone: "bg-[#eef3eb] text-[#52784f]",
    },
    meeting: {
      icon: "solar:videocamera-record-linear",
      eyebrow: "Project meeting",
      tone: "bg-[#e8eff4] text-[#527187]",
    },
    contract: {
      icon: "solar:case-round-linear",
      eyebrow: "Contract offer",
      tone: "bg-[#eeeaf5] text-[#6b5d82]",
    },
    contract_completed: {
      icon: "solar:check-circle-bold",
      eyebrow: "Contract completed",
      tone: "bg-[#edf4ea] text-[#52784f]",
    },
    milestone: {
      icon: "solar:flag-linear",
      eyebrow: "Milestone update",
      tone: "bg-[#f2efe3] text-[#7b7044]",
    },
  }[message.kind];

  return (
    <>
    <article
      className={`w-full rounded-2xl border border-black/8 bg-white p-5 ${
        message.sender === "client" ? "ml-auto" : "mr-auto"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${eventStyle.tone}`}
        >
          <Icon icon={eventStyle.icon} width="20" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold tracking-wide text-[#798077] uppercase">
              {eventStyle.eyebrow}
            </p>
            <span className="text-[9px] text-[#969b94]">{message.time}</span>
          </div>
          <h3 className="mt-2 text-sm font-semibold">{message.title}</h3>

          {message.kind === "proposal" && (
            <>
              <p className="mt-3 text-xs leading-5 text-[#6c736a]">
                {message.summary}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {message.skills.slice(0, 4).map((skill) => (
                  <span
                    key={skill}
                    className="rounded-lg bg-[#f0f3ed] px-2.5 py-1.5 text-[10px]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
              <EventFooter
                detail={`$${message.bid.toLocaleString()} · ${message.duration}`}
                href={message.href}
                action="View proposal"
              />
            </>
          )}

          {message.kind === "meeting" &&
            (message.ended ? (
              <p className="mt-3 border-t border-black/6 pt-3 text-[10px] font-semibold text-[#8a8f87]">
                Meeting ended
              </p>
            ) : (
              <EventFooter
                detail={message.startsAt}
                href={message.meetUrl}
                action="Join meeting"
                external
              />
            ))}

          {message.kind === "contract" && (
            <>
              <div className="mt-3 rounded-xl bg-[#f7f5fa] p-3">
                <p className="text-[9px] font-medium text-[#81758e]">
                  First milestone funded
                </p>
                <p className="mt-1 text-lg font-semibold text-[#29252d]">
                  ${message.amount.toLocaleString()}
                </p>
              </div>
              <div
                className={`mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-[10px] font-semibold ${
                  message.status === "Completed"
                    ? "bg-[#edf4ea] text-[#52784f]"
                    : message.status === "Active"
                      ? "bg-[#edf4ea] text-[#52784f]"
                      : "bg-[#faf5e8] text-[#80672f]"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Icon
                    icon={
                      message.status === "Completed" || message.status === "Active"
                        ? "solar:check-circle-bold"
                        : "solar:clock-circle-linear"
                    }
                    width="17"
                  />
                  {message.status === "Completed"
                    ? "Contract completed"
                    : message.status === "Active"
                      ? "Offer accepted · Contract is now active"
                      : "Waiting for the freelancer to accept"}
                </span>
                {(message.status === "Active" || message.status === "Completed") && (
                  <Link href={message.href} className="shrink-0 underline">
                    View contract
                  </Link>
                )}
              </div>
            </>
          )}

          {message.kind === "contract_completed" && (
            <>
              <div className="mt-3 rounded-xl border border-[#d2e4ce] bg-[#edf4ea]/70 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-[#486d45]">
                  <Icon
                    icon="solar:check-circle-bold"
                    width="18"
                    className="text-[#52784f]"
                  />
                  The contract “{message.title}” was completed.
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[#5e695c]">
                  This contract has been completed. Feedback has been recorded and all remaining payments have been settled.
                </p>
              </div>
              <EventFooter
                detail="Contract completed"
                href={message.href}
                action="View contract"
              />
            </>
          )}

          {message.kind === "milestone" && (
            <>
              <div className="mt-3 rounded-xl bg-[#f4f6f2] p-4">
                <p className="flex items-center gap-2 text-[10px] font-semibold text-[#52784f]">
                  <Icon
                    icon={
                      message.status === "Added"
                        ? "solar:add-circle-linear"
                        : message.status === "Funded"
                          ? "solar:shield-check-bold"
                          : "solar:upload-minimalistic-linear"
                    }
                    width="16"
                  />
                  {message.status === "Added"
                    ? "New milestone added"
                    : message.status === "Funded"
                      ? "Milestone funded and activated"
                      : "Work submitted for review"}
                </p>
                {message.submissionMessage && (
                  <p className="mt-2 text-xs leading-5 text-[#697067]">
                    {message.submissionMessage}
                  </p>
                )}
                {message.submissionDeliveryLink && (
                  <a
                    href={message.submissionDeliveryLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-[10px] font-semibold text-[#52784f] underline"
                  >
                    Open deliverable
                    <Icon icon="solar:arrow-right-up-linear" width="12" />
                  </a>
                )}
                {message.status === "Added" && message.dueDate && (
                  <p className="mt-2 text-[10px] text-[#697067]">
                    Due {message.dueDate}
                  </p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/6 pt-4">
                <span className="text-[10px] font-semibold text-[#747b72]">
                  ${message.amount.toLocaleString()} · {message.status}
                </span>
                {message.status === "Submitted" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={Boolean(reviewing)}
                      onClick={() => setReviewDialog("REQUEST_CHANGES")}
                      className="h-9 rounded-lg border border-black/10 px-3 text-[10px] font-semibold disabled:opacity-50"
                    >
                      {reviewing === "REQUEST_CHANGES"
                        ? "Requesting…"
                        : "Request modification"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(reviewing)}
                      onClick={() => setReviewDialog("APPROVE")}
                      className="h-9 rounded-lg bg-[#252724] px-3 text-[10px] font-semibold text-white disabled:opacity-50"
                    >
                      {reviewing === "APPROVE" ? "Accepting…" : "Accept work"}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </article>
    {reviewDialog && message.kind === "milestone" && (
      <div
        className="fixed w-full h-screen inset-0 z-60 flex items-center justify-center bg-black/35 p-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reviewing)
            setReviewDialog(null);
        }}
      >
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h3 className="text-lg font-semibold">
            {reviewDialog === "APPROVE"
              ? "Accept submitted work?"
              : "Request modifications"}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[#72776f]">
            {reviewDialog === "APPROVE"
              ? "Confirming will approve this milestone and release the funded amount to the freelancer."
              : "Tell the freelancer exactly what needs to be changed."}
          </p>
          {reviewDialog === "REQUEST_CHANGES" && (
            <textarea
              autoFocus
              value={modificationMessage}
              onChange={(event) => setModificationMessage(event.target.value)}
              placeholder="Describe the required modifications..."
              className="mt-4 min-h-32 w-full resize-none rounded-xl border border-black/10 p-3 text-sm outline-none focus:border-[#638b60]"
            />
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={Boolean(reviewing)}
              onClick={() => setReviewDialog(null)}
              className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                Boolean(reviewing) ||
                (reviewDialog === "REQUEST_CHANGES" &&
                  !modificationMessage.trim())
              }
              onClick={() => {
                const action = reviewDialog;
                setReviewing(action);
                void onReviewMilestone(
                  message,
                  action,
                  action === "REQUEST_CHANGES"
                    ? modificationMessage.trim()
                    : undefined,
                )
                  .then(() => {
                    setReviewDialog(null);
                    setModificationMessage("");
                  })
                  .finally(() => setReviewing(null));
              }}
              className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {reviewing
                ? "Processing…"
                : reviewDialog === "APPROVE"
                  ? "Accept and release funds"
                  : "Send request"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function EventFooter({
  detail,
  href,
  action,
  external = false,
}: {
  detail: string;
  href: string;
  action: string;
  external?: boolean;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/6 pt-3">
      <span className="truncate text-[9px] font-medium text-[#747b72]">
        {detail}
      </span>
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[#252724] px-3 text-[9px] font-semibold text-white"
      >
        {action}
        <Icon icon="solar:arrow-right-up-linear" width="12" />
      </a>
    </div>
  );
}
