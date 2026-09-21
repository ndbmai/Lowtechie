import type { ReactNode } from "react";
import { Blossom } from "./Blossom";

/** Bubble lời của Lowtechie — xưng "mình", gọi "Mai" (PRD §6.1). */
export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="bubble">
      <Blossom size={36} />
      <div style={{ minWidth: 0, flex: 1 }}>{children}</div>
    </div>
  );
}
