# Mai Lowtechie 🌼

Trợ lý AI chief-of-staff cá nhân cho Mai — người vận hành song song Sorene, The Circle Technology, Favstay và The Intelligent Edge. Nói một câu (tiếng Việt, tiếng Thái, tiếng Anh hoặc trộn lẫn), Lowtechie tự xếp việc vào đúng dự án, giữ lịch, tính giờ chuẩn bị + di chuyển, nhặt việc từ group chat và ghi recap cuộc họp.

Tài liệu gốc:

- [PRD v0.7](docs/PRD.md) — yêu cầu sản phẩm đầy đủ
- [Mockup UI & user flow](docs/prototypes/mai-lowtechie-ui.html) — hệ thống thiết kế + 7 màn hình
- [Checklist bay](docs/prototypes/checklist-bay.html) — nguyên mẫu module Chuyến đi (§5.9)

## Chạy thử

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit test cho phần logic lõi (src/core)
npm run build      # kiểm tra build production
```

Ứng dụng chạy được **không cần tài khoản hay API key nào**: dữ liệu lưu local-first trên máy (localStorage), phần tách câu lệnh dùng bộ phân tích tiếng Việt viết tay. Muốn tách lệnh thông minh hơn bằng Claude API:

```bash
cp .env.example .env.local
# điền ANTHROPIC_API_KEY
```

## Cấu trúc

```
src/core/        Logic thuần, có unit test — không phụ thuộc UI hay dịch vụ ngoài
  parse.ts         Tách 1 câu chat/voice thành nhiều hành động (VI, fallback khi không có API key)
  classify.ts      Phân loại 2 tầng Dự án → Category §5.2.1: luật + học từ sửa đổi + bắt trùng
  timeback.ts      Chuỗi tính ngược §5.4.1: chuẩn bị → di chuyển (BTS/ô tô) → hẹn; chuỗi ngày bay
  priority.ts      Điểm ưu tiên §5.2: deadline, trọng số dự án, đang chặn ai, năng lượng
  checklist.ts     Mẫu checklist bay theo điểm đến (Tokyo / HCMC / về Bangkok) + việc trước khi bay
  brief.ts         Brief sáng: top 3, đang chờ người khác, deadline 7 ngày
  slots.ts         Tìm khung giờ trống cho deep work
src/app/         Các màn hình (Next.js App Router, PWA, tiếng Việt)
src/components/  Bông mai linh vật, tab bar, bubble hội thoại…
src/lib/         Store local-first (Zustand + localStorage), voice input (Web Speech)
docs/            PRD + prototype — nguồn sự thật của sản phẩm
```

## Trạng thái theo lộ trình PRD (§10)

Giai đoạn 1 — MVP cá nhân, phần chạy offline được trước:

- [x] Khung app 5 tab: Hôm nay · Dự án · Bông mai (giao việc) · Lịch · Hộp duyệt
- [x] Design system từ mockup (vàng mai / mực chàm, Baloo 2 + Be Vietnam Pro, dark mode)
- [x] Task engine + triage inbox (nguồn gốc + độ tin cậy trên từng thẻ)
- [x] Giao việc bằng chat & voice (Web Speech; 1 câu → nhiều hành động; hỏi lại tối đa 1 câu)
- [x] Phân loại 2 tầng Dự án → Category (§5.2.1) + **học từ sửa đổi** — nhớ cả dự án Mai tự thêm
- [x] **Dự án & category tự quản** (Dự án → ⚙️ Quản lý): thêm/đổi tên/màu/mục tiêu giờ, thêm-sửa-xóa category; xóa dự án thì việc chuyển về Cá nhân (22/9: đã bỏ Favstay & Edge)
- [x] Thẻ xác nhận trước khi lưu: tóm tắt nhóm, sửa phân loại một chạm, bắt việc trùng (đề xuất gộp), cảnh báo hạn đã qua
- [x] Nhập việc từ **ảnh** (§5.1.1): chụp checklist/bảng trắng → Claude vision đọc → nhóm trong Hộp duyệt kèm ảnh nguồn, bỏ qua mục đã tick (cần `ANTHROPIC_API_KEY`)
- [x] `/api/parse` dùng Claude API khi có key, tự fallback bộ phân tích luật
- [x] Dự án + trọng số thời gian + cảnh báo dự án bị bỏ đói
- [x] Lịch v0: sự kiện local + chuỗi Chuẩn bị → Di chuyển → Hẹn tính ngược (mặc định BTS từ Bang Na)
- [x] Chuyến đi + checklist bay theo điểm đến, học món tự thêm
- [x] Brief sáng + weekly review (thời gian vs mục tiêu, việc dời ≥ 3 lần)
- [x] Google Calendar thật (OAuth trong app, PRD §5.4): sự kiện Google hiện trong Lịch + brief sáng; chuỗi chuẩn bị/di chuyển ghi vào GCal khi Mai bấm khóa (tick tắt được); token nằm trong cookie mã hóa của từng thiết bị, không có database — cần `GOOGLE_CLIENT_ID/SECRET` (xem `.env.example`)
- [x] Google Maps Routes (§5.4.1): nút "Tính bằng Google Maps" trong form chuỗi — tàu tính theo *giờ đến*, tách đi bộ → tàu → đi bộ đổ vào phép tính ngược; ô tô ước lượng theo giao thông (cần `GOOGLE_MAPS_API_KEY`)
- [x] Gmail vé máy bay (§5.9): nút "Quét vé máy bay trong Gmail" ở Chuyến đi — Claude trích chuyến sắp tới, Mai duyệt mới tạo chuyến + checklist (scope gmail.readonly, cần nối lại Google sau khi cập nhật)
- [x] Vé bay **đúng ngày, đúng chuyến** (§5.9 v1.0): mốc "🕐 Hôm nay" theo giờ thiết bị Mai đi kèm mọi lần trích; chỉ lấy chặng tương lai (server chặn lần hai); chặng đã bay/hủy hiện ở mục "Bỏ qua"; trùng PNR → Cập nhật giờ, không tạo bản sao
- [x] Tạm ngưng dự án + xóa phải chọn nơi chuyển việc (§5.3.1)
- [ ] Speech-to-text server (voice note VI/TH/EN trộn) — đang dùng Web Speech của trình duyệt
- [ ] Sync Google Sheets · ghi âm họp offline + recap
- [ ] Giai đoạn 2: bot Telegram/Zalo 1:1, ingest group chat
- [ ] Giai đoạn 3: Supabase + RLS, tài khoản cộng sự, giao việc chéo

Nguyên tắc không đổi (PRD §6.5): giao việc < 10 giây · **duyệt trước, tự động sau** · mọi việc tự trích đều có nguồn · dễ thương nhưng thật thà.
