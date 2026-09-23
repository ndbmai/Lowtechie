"use client";

/**
 * Nén ảnh phía client trước khi gửi đọc (PRD §5.1.1): thu về tối đa
 * 1280px, JPEG ~0.72 — đủ để Claude đọc chữ, nhẹ để lưu tạm trong
 * localStorage khi thẻ còn chờ duyệt.
 */
export async function compressImage(file: File, maxDim = 1280): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Không đọc được file ảnh"));
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Ảnh hỏng hoặc định dạng lạ"));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/**
 * Giải mã QR trong ảnh banner NGAY TRÊN MÁY (jsQR) — AI không tự đọc
 * được QR, nên link đăng ký từ QR phải giải ở client rồi gửi kèm
 * (PRD §5.1.1 v3.0). Lỗi gì cũng trả null, không chặn luồng đọc ảnh.
 */
export async function decodeQr(dataUrl: string): Promise<string | null> {
  try {
    const { default: jsQR } = await import("jsqr");
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("bad image"));
      i.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(px.data, px.width, px.height);
    const text = code?.data?.trim();
    return text && /^https?:\/\//i.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** Data URL → Blob để cất vào IndexedDB (ảnh banner đính vào sự kiện). */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}
