"use client";

import { useEffect } from "react";
import { rehydrateStore } from "@/lib/store";

/** Nạp localStorage sau khi mount để HTML server và client khớp nhau. */
export function StoreHydrator() {
  useEffect(() => {
    rehydrateStore();
  }, []);
  return null;
}
