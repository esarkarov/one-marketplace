"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";

export function ContractReviewModal({
  contractTitle,
  revieweeName,
  actionLabel,
  onClose,
  onSubmit,
}: {
  contractTitle: string;
  revieweeName: string;
  actionLabel: string;
  onClose: () => void;
  onSubmit: (input: { rating: number; comment: string }) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-[#172018]/50 p-5 backdrop-blur-sm">
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          void onSubmit({ rating, comment: comment.trim() })
            .then(onClose)
            .catch((error) => {
              setError(error instanceof Error ? error.message : "Review could not be submitted.");
              setSaving(false);
            });
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#edf4ea] text-[#52784f]"><Icon icon="solar:star-bold" width="22" /></span>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close review modal"><Icon icon="solar:close-circle-linear" width="23" /></button>
        </div>
        <h2 className="mt-4 text-xl font-semibold">Review {revieweeName}</h2>
        <p className="mt-2 text-sm text-[#737970]">Share your experience from “{contractTitle}”. A review is required to finish the contract.</p>
        <div className="mt-5 flex gap-1" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" onClick={() => setRating(value)} className={value <= rating ? "text-[#d5a62e]" : "text-[#d9ddd7]"} aria-label={`${value} stars`}><Icon icon="solar:star-bold" width="30" /></button>
          ))}
        </div>
        <textarea required minLength={10} maxLength={1000} rows={5} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Write your review..." className="mt-5 w-full resize-none rounded-xl border border-black/10 p-3 text-sm outline-none focus:border-[#6e916a]" />
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-xl border border-black/10 px-4 text-xs font-semibold">Cancel</button>
          <button type="submit" disabled={saving || rating === 0 || comment.trim().length < 10} className="h-10 rounded-xl bg-[#252724] px-4 text-xs font-semibold text-white disabled:opacity-40">{saving ? "Submitting…" : actionLabel}</button>
        </div>
      </form>
    </div>
  );
}
