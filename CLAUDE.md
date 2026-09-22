# CLAUDE.md — hướng dẫn làm việc trong repo này

Mai Lowtechie là trợ lý AI chief-of-staff cá nhân của Mai. **Nguồn sự thật sản phẩm là `docs/PRD.md` (v0.7)** cùng hai prototype trong `docs/prototypes/`. Khi PRD và code lệch nhau, ưu tiên PRD hoặc hỏi Mai.

Quyết định của Mai (đã sửa PRD §5.2.1/§5.3 cho khớp): 21/9 — **Học tập là dự án riêng** với category Tiếng Thái (`hoctap:tiengthai`); 22/9 — **bỏ Favstay & Edge**, và **dự án/category là dữ liệu Mai tự quản** (màn Dự án → Quản lý). Seed 5 dự án: Sorene, Circle, Cá nhân, Học tập, Admin chung. `ProjectId` là chuỗi mở; mọi id từ `classify()`/Claude phải đi qua `sanitizeTaxonomy(projects, categories, …)` trước khi lưu (dự án đã xóa rơi về Cá nhân). Client gửi taxonomy thật kèm `/api/parse` và `/api/parse-image` (`src/lib/taxonomy.ts`); dự án tự thêm được phân loại nhờ học-từ-sửa (feedback), không cần thêm luật cứng.

## Ngôn ngữ & giọng điệu

- Toàn bộ UI, copy, commit message: **tiếng Việt**. Code (tên biến, hàm, type) tiếng Anh.
- Persona của Lowtechie (PRD §6.1): xưng **"mình"**, gọi **"Mai"**; mỗi lần hỏi đúng **một** câu; đề xuất kèm lý do, không ra lệnh; vui vẻ nhưng nói thẳng khi Mai ôm quá nhiều việc.
- Chú ý: "mai" trong câu lệnh thường là *ngày mai*, còn "Mai" là tên người dùng — parser đã xử lý, đừng phá.

## Lệnh

```bash
npm run dev      # dev server
npm test         # vitest — bắt buộc xanh trước khi commit
npm run build    # bắt buộc xanh trước khi push
```

## Kiến trúc hiện tại (Giai đoạn 1, local-first)

- **`src/core/` là logic thuần**: không import React, không gọi mạng, mọi thời điểm là chuỗi ISO. Mỗi file có unit test trong `src/core/__tests__/`. Thêm logic mới → thêm test.
- **Phân loại (PRD §5.2.1)**: bảng luật duy nhất là `RULES` trong `src/core/classify.ts` — `parse.detectProject` cũng lấy từ đây, đừng tạo bảng từ khóa thứ hai. Category mặc định ở `DEFAULT_CATEGORIES` (`src/core/projects.ts`). Học từ sửa đổi: mọi chỗ Mai đổi dự án/category phải gọi `recordFeedback(learnableTerms(title) → entries)`; `classify()` với feedback thắng luật. Ảnh nguồn của nhóm triage lưu tạm trong `triageImages` và bị xóa khi nhóm duyệt xong — đừng giữ ảnh lâu trong localStorage.
- **Store**: Zustand + persist vào `localStorage` (key `lowtechie-v1`), xem `src/lib/store.ts`. Ngày giờ lưu dạng ISO string, không lưu `Date`. Đây là chỗ sẽ thay bằng Supabase (+RLS) ở Giai đoạn 3 — giữ mọi truy cập dữ liệu đi qua store, đừng đọc localStorage trực tiếp.
- **Màn hình** trong `src/app/` là client component; mọi màn hình phải render được khi store rỗng (empty state tử tế).
- **`/api/parse`**: proxy Claude API (fetch trực tiếp, không SDK) khi có `ANTHROPIC_API_KEY`; không có key thì trả 501 và **client tự chạy `src/core/parse.ts` trên trình duyệt** — cố ý như vậy để ngày giờ tính theo múi giờ của Mai chứ không phải server (UTC). Model qua env `LOWTECHIE_MODEL`, mặc định `claude-sonnet-5`.
- **Google Calendar (PRD §5.4)**: OAuth thuần fetch trong `src/lib/googleServer.ts` — refresh token MÃ HÓA AES-GCM nằm trong cookie httpOnly (khóa dẫn xuất từ `GOOGLE_CLIENT_SECRET`; đổi secret = mọi thiết bị nối lại), server không lưu gì (đúng local-first, mỗi thiết bị tự nối). Routes: `/api/google/{auth,callback,status,disconnect}` + `/api/calendar/events` (GET/POST/DELETE). Client chỉ đụng qua `src/lib/useGoogle.ts`. Block ghi sang GCal mang `gcalId` trong store để dedupe khi fetch về và xóa được khi gỡ chuỗi. Ghi lịch LUÔN sau bước Mai bấm duyệt. Scope: `calendar.events` + `gmail.readonly` + email — cờ `gm` trong cookie cho biết đã cấp Gmail chưa (cookie nối trước khi thêm scope thì chưa, UI đưa nút nối lại). `/api/gmail/flights` quét email vé máy bay → Claude trích chuyến ứng viên, chỉ tạo trip khi Mai bấm ở màn Chuyến đi. `/api/maps/route` (Routes API, cần `GOOGLE_MAPS_API_KEY`): transit dùng `arrivalTime` (giờ đến), tách walk/transit/walk đổ vào form chuỗi; drive chỉ có `departureTime` nên là ước lượng — kết quả chỉ điền form, Mai vẫn bấm Khóa.
- Font nạp bằng `<link>` Google Fonts (giống prototype) — đừng đổi sang `next/font` (build offline sẽ vỡ).

## Design system

- Token màu ở `src/app/globals.css`, lấy đúng từ mockup: vàng mai `#FFC93C` (hành động chính), mực chàm `#1E2150` (chữ/dữ liệu), nền sương `#EEF1F8`, má hồng `#FF8FA3`, xanh lá `#2FA97C` **chỉ dành cho "đã xong"**.
- Màu dự án cố định: Sorene `#8B7BFF` · Circle `#1FA9B8` · Favstay `#FF8A5B` · Edge `#3D62E0` · Cá nhân `#FF7FA8` · Học tập `#7C9A3E` · Admin chung `#7D8AA5` (hai màu cuối không có trong mockup, đã chọn thêm).
- Chữ: Baloo 2 (tiêu đề, số, lời Lowtechie), Be Vietnam Pro (nội dung). Dark mode theo `prefers-color-scheme` + override `data-theme`.
- Linh vật bông mai: component `src/components/Blossom.tsx` (SVG 5 cánh mặt cười, lấy từ prototype). Bông mai cũng là nút giao việc giữa tab bar.

## Nguyên tắc sản phẩm phải giữ trong mọi tính năng

1. **Duyệt trước, tự động sau** — không có hành động ra ngoài (ghi lịch, gửi tin, gửi recap) nào không qua bước Mai bấm duyệt.
2. **Luôn có nguồn** — việc trích tự động phải kèm trích dẫn gốc + độ tin cậy.
3. **Hỏi lại tối đa một câu** khi thiếu thông tin.
4. Mọi tính năng đều dùng được bằng **chat hoặc voice**, màn hình chỉ để xem/duyệt nhanh (PRD §5.0).

## Việc lớn tiếp theo (theo README, PRD §10)

Google Calendar OAuth (đọc/ghi có duyệt) → Google Maps Routes cho §5.4.1 (nhớ: chọn *giờ đến* chỉ có ở phương tiện công cộng) → STT server cho voice note → sync Google Sheets → ghi âm họp + recap → Giai đoạn 2 (bot Telegram/Zalo 1:1) → Giai đoạn 3 (Supabase + RLS).
