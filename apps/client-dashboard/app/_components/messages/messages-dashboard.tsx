"use client";

import { Icon } from "@iconify/react";
import { formatCents } from "@onemarketplace/api-client";
import {
  useAccount,
  useConversations,
  useMessagingSocket,
} from "@onemarketplace/web-core";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useConversationMessages,
  useMarkConversationRead,
  useReviewMilestone,
  useSendMessage,
  useStartMeeting,
} from "@/app/hooks/use-messages";
import {
  isCounterpartyTyping,
  latestServerMessageId,
  messageErrorMessage,
  readMarkKey,
  toConversationView,
  toThread,
  validateAttachment,
} from "@/lib/messages";
import { isHttpsUrl } from "@/lib/url";
import {
  type ClientConversation,
  type ClientMessage,
} from "../data/client-data";

const CONVERSATIONS_STEP = 20;
const CONVERSATIONS_MAX = 100;

export function MessagesDashboard({
  conversationId,
}: {
  conversationId?: string;
}) {
  const router = useRouter();
  const account = useAccount();
  const actorId = account.actorId;
  const socket = useMessagingSocket();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [conversationLimit, setConversationLimit] =
    useState(CONVERSATIONS_STEP);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const userScrolledMessagesRef = useRef(false);
  const markedReadRef = useRef<string | null>(null);
  const sendLockRef = useRef(false);

  const {
    data: inbox,
    isLoading: inboxLoading,
    error: inboxError,
  } = useConversations({ limit: conversationLimit });

  const selectedConversation = inbox?.results.find(
    ({ id }) => id === conversationId,
  );
  const thread = useConversationMessages(
    conversationId,
    Boolean(selectedConversation),
  );
  const {
    messages: loadedMessages,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = thread;
  const messagesLoading = thread.isLoading || account.status === "loading";

  const sendMessageMutation = useSendMessage(actorId);
  const markRead = useMarkConversationRead();
  const startMeeting = useStartMeeting();
  const reviewMutation = useReviewMilestone();

  const conversations: ClientConversation[] = useMemo(
    () =>
      (inbox?.results ?? []).map((conversation) =>
        toConversationView(conversation, conversationId),
      ),
    [conversationId, inbox],
  );

  const selectedBase = conversations.find(({ id }) => id === conversationId);
  const selectedMessages: ClientMessage[] = useMemo(
    () => toThread(loadedMessages, actorId),
    [actorId, loadedMessages],
  );
  const selected = selectedBase
    ? { ...selectedBase, messages: selectedMessages }
    : undefined;
  const counterpartyTyping = selected
    ? isCounterpartyTyping(socket.typingIn(selected.id), actorId)
    : false;
  const socketOffline = socket.status === "closed" || socket.status === "error";

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

  const selectedId = selectedConversation?.id;
  const selectedUnread = selectedConversation?.unreadCount ?? 0;
  const { mutate: markConversationRead } = markRead;
  useEffect(() => {
    if (!selectedId || selectedUnread === 0) return;
    const lastId = latestServerMessageId(loadedMessages);
    if (!lastId) return;
    const readKey = readMarkKey(selectedId, lastId);
    if (markedReadRef.current === readKey) return;
    markedReadRef.current = readKey;
    markConversationRead(
      { conversationId: selectedId, lastReadMessageId: lastId },
      {
        onError: () => {
          if (markedReadRef.current === readKey) markedReadRef.current = null;
        },
      },
    );
  }, [loadedMessages, markConversationRead, selectedId, selectedUnread]);

  const selectConversation = (conversation: ClientConversation) =>
    router.push(`/messages?conversationId=${conversation.id}`);

  const sending = sendMessageMutation.isPending;

  const sendMessage = async (file?: File) => {
    const text = draft.trim();
    if (
      (!text && !file) ||
      !selected ||
      sendLockRef.current ||
      selected.activeMeeting
    )
      return;
    sendLockRef.current = true;
    setDraft("");
    setFileError("");
    try {
      await sendMessageMutation.mutateAsync({
        conversationId: selected.id,
        body: text || null,
        file: file ?? null,
      });
    } catch (error) {
      setDraft(text);
      setFileError(messageErrorMessage(error));
      return;
    } finally {
      sendLockRef.current = false;
    }
    socket.setTyping(selected.id, false);
    setSelectedFile(null);
    setAttachmentOpen(false);
  };

  const reviewMilestone = async (
    message: Extract<ClientMessage, { kind: "milestone" }>,
    action: "APPROVE" | "REQUEST_CHANGES",
    feedback?: string,
  ) => {
    if (!message.contractId || !message.milestoneId || !selected) return;
    await reviewMutation.mutateAsync({
      contractId: message.contractId,
      milestoneId: message.milestoneId,
      conversationId: selected.id,
      action,
      feedback,
    });
  };

  const openMeeting = (joinUrl: string) => {
    if (isHttpsUrl(joinUrl)) {
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    } else {
      setFileError("The meeting link is not valid.");
    }
  };

  const createMeeting = async () => {
    if (!selected) return;
    if (selected.activeMeeting) {
      openMeeting(selected.activeMeeting.joinUrl);
      return;
    }
    if (startMeeting.isPending) return;
    setFileError("");
    try {
      const meeting = await startMeeting.mutateAsync(selected.id);
      openMeeting(meeting.joinUrl);
    } catch (error) {
      setFileError(messageErrorMessage(error));
    }
  };
  const creatingMeeting = startMeeting.isPending;

  const chooseFile = (file?: File) => {
    setSelectedFile(null);
    setFileError("");
    if (!file) return;
    const problem = validateAttachment(file);
    if (problem) {
      setFileError(problem);
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
          {inbox?.totalUnread ?? 0} unread messages
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
            {!filtered.length && !inboxLoading && (
              <p className="p-8 text-center text-xs text-[#858a82]">
                {inboxError
                  ? messageErrorMessage(inboxError)
                  : "No project threads found."}
              </p>
            )}
            {inbox?.hasMore && conversationLimit < CONVERSATIONS_MAX && (
              <button
                type="button"
                onClick={() =>
                  setConversationLimit((limit) =>
                    Math.min(CONVERSATIONS_MAX, limit + CONVERSATIONS_STEP),
                  )
                }
                className="w-full cursor-pointer p-4 text-xs font-semibold text-[#52784f]"
              >
                Load more threads
              </button>
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
                    {counterpartyTyping ? "Typing..." : selected.accountType}
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

            {socketOffline && (
              <p
                role="status"
                className="shrink-0 border-t border-black/7 bg-[#f5eed4] px-5 py-2 text-[10px] font-medium text-[#806d31]"
              >
                Reconnecting… new messages will appear when the connection is
                back.
              </p>
            )}
            {fileError && !attachmentOpen && (
              <p
                role="alert"
                className="shrink-0 border-t border-black/7 bg-[#f6e3e3] px-5 py-2 text-xs text-[#a65050]"
              >
                {fileError}
              </p>
            )}
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
                    socket.setTyping(
                      selected.id,
                      Boolean(event.target.value.trim()),
                    );
                  }}
                  onBlur={() => socket.setTyping(selected.id, false)}
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
                  : inboxError
                    ? "Conversations could not be loaded"
                    : "Conversation does not exist"}
              </h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#7b8078]">
                {inboxLoading
                  ? "Please wait while the conversation is loaded."
                  : inboxError
                    ? messageErrorMessage(inboxError)
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
  const [reviewError, setReviewError] = useState("");
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
        <strong className="text-xs">{formatCents(message.amountCents)}</strong>
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
                  detail={`${formatCents(message.bidCents)} · ${message.duration}`}
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
                    {formatCents(message.amountCents)}
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
                        message.status === "Completed" ||
                        message.status === "Active"
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
                  {(message.status === "Active" ||
                    message.status === "Completed") && (
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
                    This contract has been completed. Feedback has been recorded
                    and all remaining payments have been settled.
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
                    {formatCents(message.amountCents)} · {message.status}
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
              {reviewError && (
                <p role="alert" className="mr-auto text-xs text-[#a65050]">
                  {reviewError}
                </p>
              )}
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
                      setReviewError("");
                    })
                    .catch((error: unknown) =>
                      setReviewError(messageErrorMessage(error)),
                    )
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
