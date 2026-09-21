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
