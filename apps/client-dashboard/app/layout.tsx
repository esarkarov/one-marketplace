import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Provider } from "./provider";
import { Toaster } from "sonner";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Client Dashboard | OneMarketplace.io",
    template: "%s | OneMarketplace.io",
  },
  description:
    "Post fixed-price projects, review proposals, manage contracts, and work with exceptional independent talent.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} antialiased`}>
      <body>
        <ClerkProvider>
          <Provider>{children}</Provider>
          <Toaster />
        </ClerkProvider>
      </body>
    </html>
  );
}
