"use client";

import { getToken } from "@clerk/nextjs";
import { Icon } from "@iconify/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

type FinanceModalProps = {
  onClose: () => void;
};

export function FinanceModal({ onClose }: FinanceModalProps) {
  const [connects, setConnects] = useState(40);

  const checkout = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SERVER_URI}/connects/checkout?role=freelancer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ connects }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      return result.data.url as string;
    },
    onSuccess: (url) => window.location.assign(url),
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="finance-modal-title"
      className="fixed inset-0 z-60 grid place-items-center bg-[#172018]/45 p-5 backdrop-blur-[2px]"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          checkout.mutate();
        }}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#62805f] uppercase">
              Proposal credits
            </p>
            <h2 id="finance-modal-title" className="mt-2 text-xl font-semibold">
              Buy Connects
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer"
          >
            <Icon icon="solar:close-circle-linear" width="25" />
          </button>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[20, 40, 80].map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setConnects(amount)}
              className={`cursor-pointer rounded-xl border p-4 text-center ${connects === amount ? "border-[#6b9167] bg-[#edf4ea]" : "border-black/9"}`}
            >
              <strong className="block text-lg">{amount}</strong>
              <span className="mt-1 block text-[10px] text-[#7b8078]">
                ${(amount * 0.15).toFixed(2)}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between rounded-xl bg-[#f3f5f1] p-4 text-sm">
          <span>Total</span>
          <strong>${(connects * 0.15).toFixed(2)}</strong>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-[#858a82]">
          Your saved payment method will be charged. Connects do not expire
          while your account remains active.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 cursor-pointer rounded-xl border border-black/10 px-5 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={checkout.isPending}
            className="h-11 cursor-pointer rounded-xl bg-[#252724] px-5 text-sm font-semibold text-white"
          >
            {checkout.isPending ? "Redirecting..." : "Buy Connects"}
          </button>
        </div>
      </form>
    </div>
  );
}
