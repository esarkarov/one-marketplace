import type { Metadata } from "next";
import { LogsStream } from "./logs-stream";

export const metadata: Metadata = { title: "Logs" };

export default function LogsPage() {
  return <LogsStream />;
}
