"use client";

import { useEffect, useState } from "react";

/**
 * true sau khi mount — nội dung phụ thuộc giờ hiện tại / localStorage
 * chỉ render sau mốc này để HTML server và client không lệch nhau.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
