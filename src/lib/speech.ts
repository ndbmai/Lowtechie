"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice input v1: Web Speech API của trình duyệt (giữ bông mai để nói).
 * Nhận dạng tiếng Việt; câu trộn Thái/Anh sẽ cần STT server ở giai đoạn
 * sau (PRD §7 — test nhà cung cấp trước khi chọn).
 */

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

export function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const textRef = useRef("");

  useEffect(() => {
    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
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
      setListening(false);
      if (textRef.current.trim()) onFinal(textRef.current.trim());
      textRef.current = "";
    };
    rec.onerror = () => setListening(false);
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
  }, [onFinal]);

  const start = useCallback(() => {
    if (!recRef.current || listening) return;
    textRef.current = "";
    try {
      recRef.current.start();
      setListening(true);
    } catch {
      /* start gọi hai lần */
    }
  }, [listening]);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
