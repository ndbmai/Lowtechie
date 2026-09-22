# CLAUDE.md — hướng dẫn làm việc trong repo này

Mai Lowtechie là trợ lý AI chief-of-staff cá nhân của Mai. **Nguồn sự thật sản phẩm là `docs/PRD.md` (v2.0, 22/9/2026)** cùng hai prototype trong `docs/prototypes/`. Khi PRD và code lệch nhau, ưu tiên PRD hoặc hỏi Mai.

**Voice (PRD §5.0 v2.0 — sửa lỗi thật 22/9):** KHÔNG dựa vào Web Speech của trình duyệt. `src/lib/speech.ts` ghi âm bằng MediaRecorder rồi gửi `/api/stt` (OpenAI Whisper qua fetch thuần, env `OPENAI_API_KEY`, model `LOWTECHIE_STT_MODEL` mặc định whisper-1; thiếu key → 501 và client rơi về Web Speech nếu có). Trạng thái rõ: đang nghe / đang xử lý / lỗi kèm lý do (quyền micro, mạng); ô gõ chữ luôn là dự phòng; nhắc xin quyền micro chỉ hiện lần đầu. Cờ `stt` nằm trong `/api/google/status`.

**Chuyến đi (PRD §5.9 v2.0):** màn GỌN — chỉ nút quét, tab chuyến SẮP TỚI (nhãn theo tuyến "SGN → BKK · 2/10", tuyệt đối không hiện tab chuyến đã bay), chuỗi ngày bay, checklist. Kết quả quét (mốc "🕐 Hôm nay", ứng viên, dòng Lịch sử) nằm trong MỘT thẻ đóng được, không nằm cố định trên màn. **Chuỗi ngày bay HAI ĐẦU**: `fullFlightChain` + `validateChainBlocks` trong `src/core/timeback.ts` (test hồi quy bảng VU-131 ở `__tests__/fullchain.test.ts`): Chuẩn bị → Ra sân bay (điểm đi + phương tiện, Maps) → Check-in (max(quy định vé, 150/90), Mai override được) → Bay → Nhập cảnh (60/30) → Di chuyển sau khi đáp → "Về đến nơi". Block chỉnh/tắt được; block sai thứ tự → hiện lỗi, KHÔNG vẽ chuỗi; block khác ngày kèm ngày; cảnh báo di chuyển >3h + chuẩn bị rơi 0:00–5:00. **Giờ bay lưu NGUYÊN ISO kèm offset sân bay** (đừng `toISOString()` trần — mất múi giờ là cảnh báo đêm sai; chuyến tạo tay dùng `deviceOffsetIso`). **Xóa chuyến (6a)**: `deleteTrip` vào `tripTrash` (10 phút, Hoàn tác `undoDeleteTrip`), thẻ xác nhận liệt kê block/GCal/checklist/file vé (mặc định giữ file), chọn nhiều trong Lịch sử, ghi rõ "không hủy vé với hãng". **Tự lưu vé PDF**: quét trả `attachments` refs; khi Mai xác nhận chuyến, client tải qua `/api/gmail/attachment`, blob vào IndexedDB (`src/lib/fileStore.ts`), metadata vào `trip.attachments` (tên chuẩn `Ve_SGN-BKK_2026-10-02_OADC5J.pdf`, trùng tên → bản mới isLatest, bản cũ giữ lịch sử).

**Book lịch có xem trước (§5.4, bản đầu):** thẻ sự kiện ở Giao việc hiện cảnh báo (trùng giờ, ngày bay) + ô tick "Book lên Google Calendar" (mặc định KHÔNG book); book xong có "Hoàn tác book Google" (xóa GCal + gỡ event local). Chưa làm: recurrence, mời người (LUÔN cần xác nhận riêng khi làm), link Meet/Lark VC, sửa-qua-thẻ-xem-trước, đồng bộ hai chiều, "book thẳng báo sau" theo loại lịch, lịch đích theo dự án.

**Trích vé máy bay (PRD §5.9 quy tắc 6b — rút từ lỗi thật vé OADC5J):** trích **theo chặng, không theo vé**. AI (tool `emit_segments` trong `/api/gmail/flights`) chỉ trả THÔ mọi chặng tìm thấy trong email **và PDF đính kèm** (tối đa 3 tệp ≤1,5MB — hành trình đầy đủ, nhất là chặng về, hay chỉ nằm trong PDF), chỉ đánh dấu `cancelled`/`superseded` theo sự kiện trong email, KHÔNG tự lọc theo thời gian. Việc lọc là của CODE: `classifyAndGroup` trong `src/core/flights.ts` (test hồi quy OADC5J bắt buộc ở `__tests__/flights.test.ts` — đừng xóa) khử trùng theo **PNR + số hiệu + ngày bay** (không bao giờ chỉ PNR), so `departLocal` với epochMs + tzOffsetMin thật của thiết bị Mai (server chạy UTC, cấm `new Date()` trần làm "hôm nay"), gán đã bay/đã hủy/lịch cũ vào Lịch sử, gộp chặng sắp tới cùng PNR thành ứng viên kèm `route` ("SGN (nhà ga 2) → BKK") + `airportBufferMin` (quy định "có mặt trước X phút" trên vé). UI: dòng mốc "🕐 Hôm nay: …"; trùng PNR → nút "Cập nhật giờ" (updateTrip), không tạo bản sao; chuỗi ngày bay đề "Cất cánh {route}"; chuyến qua (giờ về ?? giờ đi +24h) chỉ còn ở mục **Lịch sử**, không bao giờ vẽ chuỗi ngày bay nữa. Chưa làm từ §5.9: đối chiếu dịch vụ dữ liệu lịch bay + realtime 24h trước, điểm xuất phát theo thành phố của chặng về, lưu vé (PDF/QR offline).

Taxonomy theo v1.6: seed 5 dự án Sorene, Circle, Cá nhân, Học tập (3 category: Tiếng Thái · Khóa học & chứng chỉ · Đọc & nghiên cứu, màu `#9BC53D`), Admin chung (màu `#8A8FB0`); Favstay & Edge đã bỏ. Dự án/category là dữ liệu Mai tự quản (Dự án → Quản lý): thêm/sửa/màu/giờ mục tiêu, **tạm ngưng (status archived — ẩn khỏi mọi màn chính qua `activeProjects()`)**, **xóa phải chọn dự án nhận việc** (`deleteProject(id, moveTo)`). `ProjectId` là chuỗi mở; mọi id từ `classify()`/Claude phải đi qua `sanitizeTaxonomy(projects, categories, …)` trước khi lưu (dự án đã xóa rơi về Cá nhân). Client gửi taxonomy thật (kèm danh bạ khách) với `/api/parse` và `/api/parse-image` (`src/lib/taxonomy.ts`); dự án tự thêm được phân loại nhờ học-từ-sửa (feedback), không cần thêm luật cứng.

**Khách hàng / đối tác (PRD §5.3.2, v1.6): là TRƯỜNG RIÊNG, không phải category.** Danh bạ `clients` trong store (`Client`: name, type khachhang/doitac/nhacungcap, aliases, projectIds — một khách thuộc được nhiều dự án, status). `matchClient` (`src/core/clients.ts`, có test) so tên + tên gọi tắt trong nội dung để tự điền `clientId`; **tên lạ KHÔNG đoán**; id từ Claude phải qua `sanitizeClientId`. Tín hiệu phân loại: dự án của khách khớp tên được đề lên đầu lựa chọn thay thế (`clientProjectHint`).

**Thẻ duyệt (PRD §5.2.1 3b — sửa lỗi thật 22/9):** 3 ô chọn RIÊNG, sửa độc lập — Dự án · Category (lọc theo dự án) · Khách hàng (lọc theo dự án, không bắt buộc) + ô Deadline; mỗi ô là `SearchSelect` (`src/components/`) có tìm kiếm và dòng **"Tạo mới: …"** tạo tại chỗ, KHÔNG quay lại danh sách phẳng "Dự án · Category". Nhận cả nhóm ảnh cho đặt chung dự án/category/khách/hạn trước khi nhận. Đổi tên/xóa category, khách làm ở màn Quản lý dự án.

**Deadline từng việc (PRD §5.2.1 3c):** `DueEditor` + `src/core/due.ts` (có test). Nguồn có hạn → tự điền (`dueSource: "nguon"`, hiện dạng đầy đủ "Thứ Sáu 25/9/2026" + trích dẫn); **nguồn không có hạn → ĐỂ TRỐNG + làm nổi ô, cấm đoán** (prompt hai route AI cũng cấm). Nút nhanh Hôm nay · Ngày mai · Thứ Sáu này · Tuần sau · Cuối tháng (9:00 sáng, cùng quy ước parse.ts); loại hạn cứng/mềm; "Không có hạn" chọn rõ; Lưu & nhận khi ô trống → nhắc đúng một lần. Cảnh báo nhẹ (`dueWarnings`): hạn đã qua · rơi ngày bay · ngày lịch dày — Mai vẫn giữ được. Đổi hạn ghi vào `dueChanges` (store v7).

**Sắp xếp thứ tự (PRD §5.3.1):** thứ tự mảng trong store CHÍNH LÀ thứ tự Mai đặt, mọi màn/ô chọn render theo đó — đừng sort lại. Quản lý dự án có chế độ "Sắp xếp": `moveProject`/`moveCategory`/`moveClient` (⤒↑↓⤓) + "Hoàn tác" (`setOrders` khôi phục snapshot); mục mới luôn vào cuối. Chuyển category sang dự án khác: `moveCategoryToProject` (đổi id theo prefix mới, việc + feedback đi theo, hỏi xác nhận trước).

**Quy tắc UI số 0 (v1.6):** màn hình KHÔNG chứa câu giải thích cách hoạt động hay tham chiếu nội bộ ("PRD §…") — hướng dẫn chỉ nằm ở empty state (lần dùng đầu). Đừng thêm lại các đoạn "mẹo"/giải thích đã gỡ.

Chưa làm từ v1.6: kéo-thả cảm ứng khi sắp xếp (đang dùng nút), gộp dự án, icon/keywords, quản lý dự án·category·khách bằng chat/voice, gợi ý cấu trúc + hoàn tác structure_changes, màn chi tiết khách hàng + weekly review theo khách + gộp khách trùng tên, nhắc việc trước hạn (cần push), sửa hạn ngay trong danh sách việc, mục "Dùng gần đây" trong ô chọn, cột Khách hàng trong Google Sheets (sync Sheets chưa làm).

Chưa làm từ v2.0: **toàn bộ Lark (§5.5.1 — bot group, Lark Mail, Lark Calendar; kênh ưu tiên của Giai đoạn 2, cần tạo app trên larksuite.com + admin tổ chức duyệt quyền)**; sửa block chuỗi bay bằng chat/voice + thêm block tùy ý + khóa một block; địa điểm đã lưu theo thành phố (đang nhập tay, mặc định homeAddress khi đi/đến Bangkok); email không có PDF → in email thành PDF; vé từ ảnh chụp; lưu file vào Drive + gắn link vào sự kiện; tự dọn chuyến sau 90 ngày; đối chiếu dịch vụ dữ liệu lịch bay + realtime.

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
- **Google Calendar (PRD §5.4)**: OAuth thuần fetch trong `src/lib/googleServer.ts` — refresh token MÃ HÓA AES-GCM nằm trong cookie httpOnly (khóa dẫn xuất từ `GOOGLE_CLIENT_SECRET`; đổi secret = mọi thiết bị nối lại), server không lưu gì (đúng local-first, mỗi thiết bị tự nối). Routes: `/api/google/{auth,callback,status,disconnect}` + `/api/calendar/events` (GET/POST/DELETE). Client chỉ đụng qua `src/lib/useGoogle.ts`. Block ghi sang GCal mang `gcalId` trong store để dedupe khi fetch về và xóa được khi gỡ chuỗi. Ghi lịch LUÔN sau bước Mai bấm duyệt. Scope: `calendar.events` + `gmail.readonly` + email — cờ `gm` trong cookie cho biết đã cấp Gmail chưa (cookie nối trước khi thêm scope thì chưa, UI đưa nút nối lại). `/api/gmail/flights` quét email vé máy bay (kèm PDF đính kèm) → Claude trích chặng thô, `src/core/flights.ts` phân loại/gộp thành ứng viên, chỉ tạo trip khi Mai bấm ở màn Chuyến đi. `/api/maps/route` (Routes API, cần `GOOGLE_MAPS_API_KEY`): transit dùng `arrivalTime` (giờ đến), tách walk/transit/walk đổ vào form chuỗi; drive chỉ có `departureTime` nên là ước lượng — kết quả chỉ điền form, Mai vẫn bấm Khóa.
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

## Việc lớn tiếp theo (theo README, PRD §10 v2.0)

Hoàn thiện §5.4 book lịch (recurrence, mời người — luôn xác nhận riêng, Meet link, đồng bộ hai chiều) → sync Google Sheets (cột Khách hàng) → ghi âm họp + recap → **Giai đoạn 2: Lark trước (bot group @Lowtechie → đọc-toàn-bộ cho group nội bộ, Lark Mail quét vé, Lark Calendar hai-lịch-một-góc-nhìn; cần app Lark Open Platform + admin duyệt), sau đó bot 1:1 WhatsApp/Zalo** → Giai đoạn 3 (Supabase + RLS).
