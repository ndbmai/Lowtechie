"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input v2.0 (PRD §5.0 — sửa lỗi voice 22/9): KHÔNG dựa vào nhận
 * dạng giọng nói của trình duyệt (hỗ trợ không đều, nhất là iPhone và
 * tiếng Việt/Thái). Ghi âm bằng MediaRecorder rồi gửi lên `/api/stt`
 * (Whisper). Web Speech API chỉ còn là đường DỰ PHÒNG khi server chưa có
 * key. Trạng thái rõ ràng: đang nghe / đang xử lý / lỗi kèm lý do — và ô
 * gõ chữ luôn là dự phòng.
 */

export type SpeechState = "idle" | "listening" | "processing" | "error";

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* trình duyệt cũ */
    }
  }
  return "";
}

export function useSpeech(onFinal: (text: string) => void) {
  const [state, setState] = useState<SpeechState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sttReady, setSttReady] = useState(false);
  const [srReady, setSrReady] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const textRef = useRef("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  // Server đã có STT chưa (OPENAI_API_KEY)?
  useEffect(() => {
    let alive = true;
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d: { stt?: boolean }) => {
        if (alive) setSttReady(Boolean(d.stt));
      })
      .catch(() => {
        /* status lỗi → chỉ còn dự phòng trình duyệt */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Web Speech API — dự phòng.
  useEffect(() => {
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSrReady(true);
    const rec = new Ctor();
    rec.lang = "vi-VN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (ev) => {
      let s = "";
      for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript;
      textRef.current = s;
    };
    rec.onend = () => {
      setState("idle");
      if (textRef.current.trim()) onFinalRef.current(textRef.current.trim());
      textRef.current = "";
    };
    rec.onerror = (ev) => {
      setState("error");
      setError(
        ev.error === "not-allowed" || ev.error === "service-not-allowed"
          ? "Chưa có quyền micro — Mai bật lại trong cài đặt trình duyệt (🔒 cạnh thanh địa chỉ) rồi thử lại."
          : "Trình duyệt không nghe được — Mai gõ giúp mình nhé.",
      );
    };
    recRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.stop();
      } catch {
        /* đã dừng */
      }
    };
  }, []);

  // Dọn micro khi rời màn.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const finishServer = useCallback(async () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const blob = new Blob(chunksRef.current, {
      type: mediaRef.current?.mimeType || "audio/webm",
    });
    chunksRef.current = [];
    if (blob.size < 800) {
      // Chạm nhầm / thả quá nhanh — không coi là lỗi.
      setState("idle");
      return;
    }
    setState("processing");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
      const res = await fetch("/api/stt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audio: dataUrl }),
      });
      const d = (await res.json().catch(() => null)) as { text?: string; detail?: string } | null;
      if (!res.ok || !d?.text?.trim()) {
        setState("error");
        setError(
          res.status === 501
            ? "Server chưa có OPENAI_API_KEY cho voice — Mai gõ giúp mình nhé."
            : `Không chuyển được giọng nói thành chữ (${d?.detail ?? `mã ${res.status}`}) — thử lại hoặc gõ nhé.`,
        );
        return;
      }
      setState("idle");
      setError(null);
      onFinalRef.current(d.text.trim());
    } catch {
      setState("error");
      setError("Mạng chập chờn — không gửi được bản ghi. Mai thử lại nhé.");
    }
  }, []);

  const startServer = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("Trình duyệt này không cho ghi âm (voice cần HTTPS) — Mai gõ giúp mình nhé.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        void finishServer();
      };
      mediaRef.current = mr;
      mr.start();
      setError(null);
      setState("listening");
    } catch (e) {
      setState("error");
      const name = (e as DOMException | undefined)?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Chưa có quyền micro — Mai bật lại trong cài đặt trình duyệt (🔒 cạnh thanh địa chỉ) rồi thử lại."
          : name === "NotFoundError"
            ? "Không tìm thấy micro trên thiết bị này."
            : "Không mở được micro — Mai gõ giúp mình nhé.",
      );
    }
  }, [finishServer]);

  const start = useCallback(() => {
    if (state === "listening" || state === "processing") return;
    if (sttReady) {
      void startServer();
      return;
    }
    if (recRef.current) {
      textRef.current = "";
      try {
        recRef.current.start();
        setError(null);
        setState("listening");
      } catch {
        /* start gọi hai lần */
      }
      return;
    }
    setState("error");
    setError("Thiết bị này chưa ghi âm được — Mai gõ giúp mình nhé.");
  }, [state, sttReady, startServer]);

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
      return;
    }
    recRef.current?.stop();
  }, []);

  return {
    supported: sttReady || srReady,
    /** Voice đi qua STT server (chuẩn v2.0) hay đang dùng dự phòng trình duyệt. */
    serverStt: sttReady,
    listening: state === "listening",
    processing: state === "processing",
    state,
    error,
    start,
    stop,
  };
}
