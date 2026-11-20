import type { Metadata } from "next";
import { SystemsExplorer } from "./systems-explorer";

export const metadata: Metadata = { title: "Systems" };

export default function SystemsPage() {
  return <SystemsExplorer />;
}
