"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon";
import type { AgencyChatMessage, AgencyConversation } from "./types";

export function ConversationPanel({
  conversation,
  agencyName,
  onBack,
  onSend,
  onSendFile,
  onAcceptOffer,
  acceptingContractId,
  onTyping,
  otherPartyTyping,
  sending,
  messagesLoading,
  hasMoreMessages,
  loadingMore,
  onLoadMore,
  onCreateMeeting,
  creatingMeeting,
  meetingError,
}: {
  conversation: AgencyConversation;
  agencyName: string;
  onBack: () => void;
  onSend: (text: string) => void;
  onSendFile: (file: File) => void;
  onAcceptOffer: (contractId: string) => void;
  acceptingContractId: string | null;
  onTyping: (isTyping: boolean) => void;
  otherPartyTyping: boolean;
  sending: boolean;
  messagesLoading: boolean;
  hasMoreMessages: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onCreateMeeting: () => void;
  creatingMeeting: boolean;
  meetingError: string;
}) {
  const [message, setMessage] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const loadingOlderRef = useRef(false);

  useEffect(() => {
    userScrolledRef.current = false;
    if (loadingOlderRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.id, conversation.messages.length]);

  const loadOlder = async () => {
    const container = messagesContainerRef.current;
    if (!container || !hasMoreMessages || loadingMore) return;
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    loadingOlderRef.current = true;
    await onLoadMore();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        container.scrollTop = previousTop + container.scrollHeight - previousHeight;
        loadingOlderRef.current = false;
      }),
    );
  };

  const submit = () => {
    const text = message.trim();
    if (!text || sending || conversation.activeMeeting) return;
    onSend(text);
    setMessage("");
    onTyping(false);
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-black/8 bg-white">
      <header className="flex items-center gap-3 border-b border-black/7 px-4 py-3.5 sm:px-5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to inbox"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full hover:bg-black/4 lg:hidden"
        >
          <span className="text-lg">←</span>
        </button>
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#496e67] text-xs font-semibold text-white">
          {conversation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={conversation.avatarUrl}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            conversation.initials
          )}
          {conversation.online && (
            <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white bg-[#64a665]" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {conversation.client}
          </h2>
          <p className="truncate text-[11px] text-[#777d75]">
            {otherPartyTyping
              ? "Typing…"
              : conversation.online
                ? "Online"
                : "Offline"}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateMeeting}
          disabled={creatingMeeting}
          className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold hover:bg-black/3 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 ${
            conversation.activeMeeting
              ? "border-[#9dbc99] bg-[#e9f3e6] text-[#477344]"
              : "border-black/9"
          }`}
        >
          <Icon name="video" size={18} />
          <span className="hidden sm:inline">
            {creatingMeeting
              ? "Starting…"
              : conversation.activeMeeting
                ? "Join meeting"
                : "Create meeting"}
          </span>
        </button>
      </header>

      {meetingError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-black/7 bg-[#fdf1f0] px-5 py-2.5 text-xs font-medium text-[#a34a3f]">
          {meetingError}
        </div>
      )}

      {conversation.activeMeeting && (
        <div className="flex shrink-0 items-center gap-2 border-b border-black/7 bg-[#f2f7ef] px-5 py-2.5 text-xs font-medium text-[#52784f]">
          <Icon name="video" size={15} />
          Meeting in progress — chat is paused until it ends.
        </div>
      )}

      <div className="flex items-center justify-between border-b border-black/6 bg-[#fafbf9] px-5 py-2.5 text-[11px]">
        <span className="min-w-0 truncate text-[#737870]">
          {conversation.contextTitle}
        </span>
        <Link
          href={conversation.contextHref}
          className="ml-3 shrink-0 font-semibold text-[#52784f] hover:underline"
        >
          {conversation.contextLabel}
        </Link>
      </div>

      <div
        ref={messagesContainerRef}
        onWheel={() => {
          userScrolledRef.current = true;
        }}
        onTouchStart={() => {
          userScrolledRef.current = true;
        }}
        onScroll={(event) => {
          if (userScrolledRef.current && event.currentTarget.scrollTop <= 40) {
            void loadOlder();
          }
        }}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6"
      >
        {loadingMore && (
          <div className="flex justify-center pb-3">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/10 border-t-[#638b60]" />
          </div>
        )}
        {messagesLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-black/10 border-t-[#638b60]" />
          </div>
        ) : conversation.messages.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-xs text-[#858a82]">
            This conversation is ready. Send the first message.
          </p>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-black/7" />
              <span className="text-[10px] font-medium text-[#999d96]">
                Conversation
              </span>
              <span className="h-px flex-1 bg-black/7" />
            </div>
            <div className="grid min-w-0 gap-4">
              {conversation.messages.map((item) => (
                <TransactionMessage
                  key={item.id}
                  message={item}
                  messages={conversation.messages}
                  onAcceptOffer={onAcceptOffer}
                  accepting={
                    item.kind === "contract" &&
                    acceptingContractId === item.contractId
                  }
                />
              ))}
            </div>
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <footer className="border-t border-black/7 p-3 sm:p-4">
        <div className="flex items-end gap-2 rounded-2xl border border-black/9 bg-[#fbfcfa] p-2">
          <button
            type="button"
            aria-label="Attach a file"
            onClick={() => setAttachmentOpen(true)}
            disabled={Boolean(conversation.activeMeeting)}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#686e66] hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon name="paperclip" size={20} />
          </button>
          <textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              onTyping(Boolean(event.target.value.trim()));
            }}
            onBlur={() => onTyping(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            disabled={Boolean(conversation.activeMeeting)}
            placeholder={
              conversation.activeMeeting
                ? "Chat is paused during the meeting…"
                : `Write as ${agencyName}…`
            }
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:text-[#9a9e97]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={
              !message.trim() || sending || Boolean(conversation.activeMeeting)
            }
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#252724] text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Icon name="send" size={18} />
          </button>
        </div>
      </footer>

      {attachmentOpen && (
        <AttachmentModal
          sending={sending}
          onClose={() => setAttachmentOpen(false)}
          onAttach={(file) => {
            onSendFile(file);
            setAttachmentOpen(false);
          }}
        />
      )}
    </section>
  );
}

function TransactionMessage({
  message,
  messages,
  onAcceptOffer,
  accepting,
}: {
  message: AgencyChatMessage;
  messages: AgencyChatMessage[];
  onAcceptOffer: (contractId: string) => void;
  accepting: boolean;
}) {
  if (message.kind === "text") {
    const repliedMessage = message.replyToId
      ? messages.find((item) => item.id === message.replyToId)
      : undefined;
    return (
      <div
        className={`flex min-w-0 ${
          message.sender === "agency" ? "justify-end" : "justify-start"
        }`}
      >
        <div
          className="max-w-[82%] sm:max-w-[70%]"
          style={{ maxWidth: "min(82%, 640px)" }}
        >
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.sender === "agency"
                ? "rounded-br-md bg-[#252724] text-white"
                : "rounded-bl-md bg-[#eef2ec] text-[#343833]"
            }`}
          >
            {repliedMessage && (
              <div
                className={`mb-2 rounded-lg border-l-3 px-3 py-2 ${
                  message.sender === "agency"
                    ? "border-[#9fbd9b] bg-white/10"
                    : "border-[#6f966b] bg-white/65"
                }`}
              >
                <p
                  className={`text-[9px] font-semibold tracking-wide uppercase ${
                    message.sender === "agency"
                      ? "text-white/65"
                      : "text-[#52784f]"
                  }`}
                >
                  Replying to
                </p>
                <p className="mt-0.5 truncate text-[10px] font-medium opacity-80">
                  {repliedMessage.kind === "text"
                    ? repliedMessage.text
                    : "Previous message"}
                </p>
              </div>
            )}
            <p className="whitespace-pre-wrap wrap-break-word">
              {message.text}
            </p>
            {message.attachment && (
              <div
                className={`mt-3 flex items-center gap-3 rounded-xl p-3 ${
                  message.sender === "agency" ? "bg-white/10" : "bg-white"
                }`}
              >
                <Icon name="proposal" size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">
                    {message.attachment.name}
                  </span>
                  <span className="block text-[10px] opacity-60">
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
                    <Icon name="download" size={17} />
                  </a>
                )}
              </div>
            )}
          </div>
          <p
            className={`mt-1 text-[10px] text-[#9a9e97] ${
              message.sender === "agency" ? "text-right" : "text-left"
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
        <Icon name="video" size={14} />
        Meeting ended · {message.durationMinutes} min
      </div>
    );
  }

  const eventStyle = {
    contract: {
      icon: "contract" as const,
      eyebrow: "Contract offer",
      tone: "bg-[#eeeaf5] text-[#6b5d82]",
    },
    meeting: {
      icon: "video" as const,
      eyebrow: "Project meeting",
      tone: "bg-[#e8eff4] text-[#527187]",
    },
    contract_completed: {
      icon: "check-circle" as const,
      eyebrow: "Contract completed",
      tone: "bg-[#edf4ea] text-[#52784f]",
    },
    milestone: {
      icon: "flag" as const,
      eyebrow: "Milestone update",
      tone: "bg-[#f2efe3] text-[#7b7044]",
    },
  }[message.kind];

  return (
    <article
      className={`w-full min-w-0 rounded-2xl border border-black/8 bg-white p-5 ${
        message.sender === "agency" ? "ml-auto" : "mr-auto"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${eventStyle.tone}`}
        >
          <Icon name={eventStyle.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-semibold tracking-wide text-[#798077] uppercase">
              {eventStyle.eyebrow}
            </p>
            <span className="text-[9px] text-[#969b94]">{message.time}</span>
          </div>
          <h3 className="mt-2 text-sm font-semibold">{message.title}</h3>

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
              {message.status === "Awaiting acceptance" ? (
                <>
                  <p className="mt-3 text-[10px] leading-5 text-[#747a72]">
                    Review the offer carefully. The contract becomes active
                    after you accept it.
                  </p>
                  <div className="mt-4 flex justify-end gap-2 border-t border-black/6 pt-4">
                    <button
                      type="button"
                      disabled={accepting}
                      className="h-9 cursor-pointer rounded-lg border border-black/10 px-4 text-[10px] font-semibold text-[#656b64] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      onClick={() => onAcceptOffer(message.contractId)}
                      disabled={!message.contractId || accepting}
                      className="h-9 cursor-pointer rounded-lg bg-[#252724] px-4 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      {accepting ? "Accepting…" : "Accept offer"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-3 border-t border-black/6 pt-3 text-[10px] font-semibold text-[#52784f]">
                  {message.status === "Active"
                    ? "Contract accepted · The contract is active"
                    : message.status === "Completed"
                      ? "Contract completed"
                      : "Contract offer declined"}
                </p>
              )}
            </>
          )}

          {message.kind === "contract_completed" && (
            <>
              <div className="mt-3 rounded-xl border border-[#d2e4ce] bg-[#edf4ea]/70 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold text-[#486d45]">
                  <Icon
                    name="check-circle"
                    size={18}
                    className="text-[#52784f]"
                  />
                  The contract “{message.title}” was completed.
                </p>
                <p className="mt-1.5 text-xs leading-5 text-[#5e695c]">
                  This contract has been completed. Feedback has been
                  recorded and all remaining payments have been settled.
                </p>
              </div>
              <EventFooter
                detail="Contract completed"
                href={message.href}
                action="View contract"
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
              />
            ))}

          {message.kind === "milestone" && (
            <>
              <div
                className={`mt-3 rounded-xl p-4 ${
                  message.status === "Approved" || message.status === "Funded"
                    ? "bg-[#edf4ea]"
                    : message.status === "Changes requested"
                      ? "bg-[#faf5e8]"
                      : "bg-[#f4f6f2]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    name={
                      message.status === "Added"
                        ? "plus"
                        : message.status === "Approved"
                          ? "check-circle"
                          : message.status === "Funded"
                            ? "shield-check"
                            : message.status === "Changes requested"
                              ? "restart-circle"
                              : "upload"
                    }
                    size={18}
                    className={
                      message.status === "Approved" ||
                      message.status === "Funded"
                        ? "text-[#52784f]"
                        : message.status === "Changes requested"
                          ? "text-[#8a6d30]"
                          : "text-[#657064]"
                    }
                  />
                  <p className="text-xs font-semibold">
                    {message.status === "Added"
                      ? "Client added a new milestone"
                      : message.status === "Approved"
                        ? "Client accepted your submission"
                        : message.status === "Funded"
                          ? "Client funded and activated this milestone"
                          : message.status === "Changes requested"
                            ? "Client requested modifications"
                            : "Work submitted for client review"}
                  </p>
                </div>
                {(message.status === "Submitted" ||
                  message.status === "Funded") &&
                  message.note && (
                    <p className="mt-2 text-xs leading-5 text-[#697067]">
                      {message.note}
                    </p>
                  )}
                {message.status === "Added" && message.dueDate && (
                  <p className="mt-2 text-[10px] text-[#697067]">
                    Due {message.dueDate}
                  </p>
                )}
                {message.status === "Submitted" && message.deliveryLink && (
                  <a
                    href={message.deliveryLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[#52784f] underline"
                  >
                    Open deliverable
                    <Icon name="arrow" size={12} />
                  </a>
                )}
              </div>
              <EventFooter
                detail={
                  message.amount
                    ? `$${message.amount.toLocaleString()} · ${message.status}`
                    : message.status
                }
                href={message.href}
                action="View contract"
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

function EventFooter({
  detail,
  href,
  action,
}: {
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/6 pt-3">
      <span className="truncate text-[9px] font-medium text-[#747b72]">
        {detail}
      </span>
      <Link
        href={href}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-[#252724] px-3 text-[9px] font-semibold text-white"
      >
        {action}
        <Icon name="arrow" size={12} />
      </Link>
    </div>
  );
}

function AttachmentModal({
  sending,
  onClose,
  onAttach,
}: {
  sending: boolean;
  onClose: () => void;
  onAttach: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const chooseFile = (nextFile?: File) => {
    setFile(null);
    setError("");
    if (!nextFile) return;
    const allowedTypes = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!allowedTypes.includes(nextFile.type)) {
      setError("Use PDF, DOCX, PNG, JPG, or TXT files only.");
      return;
    }
    if (nextFile.size > 5 * 1024 * 1024) {
      setError("The maximum attachment size is 5 MB.");
      return;
    }
    setFile(nextFile);
  };

  return (
    <div className="fixed inset-0 z-90 grid place-items-center bg-[#1d221d]/45 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]">
            <Icon name="paperclip" size={23} />
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close attachment modal"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/8"
          >
            <Icon name="close" size={19} />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Add an attachment</h2>
        <p className="mt-2 text-sm leading-6 text-[#737970]">
          Review the file before sharing it in this conversation.
        </p>
        <label className="mt-5 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-black/15 bg-[#fafbf9] px-5 py-8 text-center">
          <Icon name="upload" size={25} className="text-[#52784f]" />
          <span className="mt-2 text-sm font-semibold">Choose a file</span>
          <span className="mt-1 text-[11px] text-[#858a82]">
            PDF, DOCX, PNG, JPG, or TXT · Maximum 5 MB
          </span>
          <input
            type="file"
            accept=".pdf,.docx,.png,.jpg,.jpeg,.txt"
            className="sr-only"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        </label>
        {file && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#f0f3ee] p-3">
            <Icon name="proposal" size={21} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{file.name}</p>
              <p className="mt-0.5 text-[10px] text-[#858a82]">
                {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <Icon name="verified" size={19} className="text-[#5d8759]" />
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
            className="h-10 cursor-pointer rounded-xl border border-black/10 px-4 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => file && onAttach(file)}
            disabled={!file || sending}
            className="h-10 cursor-pointer rounded-xl bg-[#252724] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            {sending ? "Uploading…" : "Attach file"}
          </button>
        </div>
      </div>
    </div>
  );
}
