# Mai Lowtechie 🌼

Trợ lý AI chief-of-staff cá nhân cho Mai — người vận hành song song Sorene, The Circle Technology, Favstay và The Intelligent Edge. Nói một câu (tiếng Việt, tiếng Thái, tiếng Anh hoặc trộn lẫn), Lowtechie tự xếp việc vào đúng dự án, giữ lịch, tính giờ chuẩn bị + di chuyển, nhặt việc từ group chat và ghi recap cuộc họp.

Tài liệu gốc:

- [PRD v3.1](docs/PRD.md) — yêu cầu sản phẩm đầy đủ
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
  priority.ts      Điểm ưu tiên §5.2: deadline, thứ tự dự án Mai đặt, đang chặn ai, năng lượng
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
- [x] **Dự án & category tự quản** (Dự án → ⚙️ Quản lý): thêm/đổi tên/màu (v2.9: bỏ dòng mô tả — dự án chỉ cần tên và màu), thêm-sửa-xóa category; xóa dự án thì việc chuyển về Cá nhân (22/9: đã bỏ Favstay & Edge)
- [x] Thẻ xác nhận trước khi lưu: tóm tắt nhóm, sửa phân loại một chạm, bắt việc trùng (đề xuất gộp), cảnh báo hạn đã qua
- [x] Nhập việc từ **ảnh** (§5.1.1): chụp checklist/bảng trắng → Claude vision đọc → nhóm trong Hộp duyệt kèm ảnh nguồn, bỏ qua mục đã tick (cần `ANTHROPIC_API_KEY`)
- [x] `/api/parse` dùng Claude API khi có key, tự fallback bộ phân tích luật
- [x] Ưu tiên theo **thứ tự dự án Mai đặt** (v2.8 — bỏ hẳn trọng số giờ/tuần) + cảnh báo dự án bị bỏ quên
- [x] Lịch v0: sự kiện local + chuỗi Chuẩn bị → Di chuyển → Hẹn tính ngược (mặc định BTS từ Bang Na)
- [x] Chuyến đi + checklist bay theo điểm đến, học món tự thêm
- [x] Brief sáng + weekly review (v2.8: đếm việc xong/trễ theo dự án — không so số giờ vì Mai không bấm giờ; việc dời ≥ 3 lần)
- [x] Google Calendar thật (OAuth trong app, PRD §5.4): sự kiện Google hiện trong Lịch + brief sáng; chuỗi chuẩn bị/di chuyển ghi vào GCal khi Mai bấm khóa (tick tắt được); token nằm trong cookie mã hóa của từng thiết bị, không có database — cần `GOOGLE_CLIENT_ID/SECRET` (xem `.env.example`)
- [x] Google Maps Routes (§5.4.1): nút "Tính bằng Google Maps" trong form chuỗi — tàu tính theo *giờ đến*, tách đi bộ → tàu → đi bộ đổ vào phép tính ngược; ô tô ước lượng theo giao thông (cần `GOOGLE_MAPS_API_KEY`)
- [x] Gmail vé máy bay (§5.9): nút "Quét vé máy bay trong Gmail" ở Chuyến đi — Claude trích chuyến sắp tới, Mai duyệt mới tạo chuyến + checklist (scope gmail.readonly, cần nối lại Google sau khi cập nhật)
- [x] Vé bay **đúng ngày, đúng chuyến** (§5.9 v1.0): mốc "🕐 Hôm nay" theo giờ thiết bị Mai đi kèm mọi lần trích; chỉ lấy chặng tương lai (server chặn lần hai); chặng đã bay/hủy hiện ở mục "Bỏ qua"; trùng PNR → Cập nhật giờ, không tạo bản sao
- [x] Trích vé **theo chặng** (§5.9 6b, sửa lỗi vé OADC5J): AI trả thô mọi chặng từ email + PDF đính kèm, `src/core/flights.ts` khử trùng (PNR+số hiệu+ngày) và phân loại bằng code có test hồi quy; chuỗi ngày bay đề "Cất cánh SGN (nhà ga 2) → BKK", đệm sân bay theo quy định trên vé; chuyến đã bay chuyển vào mục "Lịch sử", không vẽ chuỗi nữa
- [x] Thẻ duyệt v1.6 (§5.2.1 3b, sửa lỗi thẻ chỉ có một danh sách phẳng): 3 ô chọn riêng Dự án · Category · Khách hàng, có tìm kiếm và "Tạo mới: …" ngay trên thẻ; nhóm ảnh đặt chung dự án/category/khách/hạn trước khi nhận cả nhóm
- [x] Deadline từng việc (§5.2.1 3c): nguồn có hạn → tự điền kèm trích dẫn, không có → để trống + làm nổi (không đoán); nút nhanh Hôm nay/Ngày mai/Thứ Sáu này/Tuần sau/Cuối tháng, hạn cứng/mềm, "Không có hạn"; cảnh báo hạn đã qua · rơi ngày bay · ngày lịch dày; lịch sử đổi hạn lưu lại
- [x] Khách hàng & đối tác (§5.3.2): trường riêng (không phải category), danh bạ theo dự án kèm tên gọi tắt; tự khớp tên khi trích việc, tên lạ không đoán; quản lý ở Quản lý dự án
- [x] Sắp xếp thứ tự (§5.3.1): chế độ Sắp xếp cho dự án, category, khách (⤒↑↓⤓ + Hoàn tác); chuyển category (kèm việc) sang dự án khác; thứ tự Mai đặt dùng ở mọi màn và ô chọn
- [x] Quy tắc UI 0 (v1.6): gỡ mọi câu giải thích cơ chế và tham chiếu "PRD §…" khỏi màn hình
- [x] Voice ổn định (§5.0 v2.0, sửa lỗi 22/9): ghi âm trên máy → `/api/stt` Whisper (VI/TH/EN, cần `OPENAI_API_KEY`); trạng thái nghe/xử lý/lỗi kèm lý do; Web Speech chỉ còn là dự phòng; ô gõ chữ luôn có
- [x] Chuỗi ngày bay **hai đầu, chỉnh sửa được** (§5.9 v2.0): 6 block Chuẩn bị → Ra sân bay → Check-in → Bay → Nhập cảnh → Về nơi ở, phương tiện + điểm đi/đến từng đầu, "Mở Maps"; kiểm tra bắt buộc (block đè nhau → báo lỗi không vẽ, khác ngày kèm ngày, cảnh báo >3h & nửa đêm) — test theo đúng bảng VU-131
- [x] Màn Chuyến đi gọn (v2.0): kết quả quét là thẻ hiện một lần (mốc Hôm nay + Lịch sử nằm trong đó), tab chỉ chuyến sắp tới, nhãn theo tuyến "SGN → BKK · 2/10"
- [x] Xóa chuyến (§5.9 6a): thẻ xác nhận liệt kê block/lịch/file vé, chọn nhiều trong Lịch sử, Hoàn tác 10 phút, không hủy vé với hãng
- [x] Tự lưu vé PDF vào chuyến (v2.0): xác nhận chuyến là vé trong email tự tải về máy (IndexedDB), tên chuẩn `Ve_SGN-BKK_2026-10-02_OADC5J.pdf`, đổi vé → bản mới nhất + lịch sử
- [x] Book lịch có xem trước (§5.4, bản đầu): thẻ sự kiện cảnh báo trùng giờ/ngày bay, tick mới book lên Google Calendar, có Hoàn tác
- [x] Cảnh báo chuỗi bay theo GIỜ ĐỊA PHƯƠNG (v2.3, sửa lỗi "7:13 sáng bị coi là nửa đêm"): đọc offset từ vé, dữ liệu cũ suy từ mã sân bay; test 7:13/4:30 giờ HCMC
- [x] Phương tiện v2.3: Grab/taxi · Ô tô riêng · Tàu điện · Xe bus · Xe máy (chế độ hai bánh, tự rơi về lái xe); bỏ "Người đón"
- [x] Màn Lịch v2.3 (§5.4.0): xem Ngày/Tuần/Tháng/Danh sách (app nhớ chế độ), lưới tháng chấm màu dự án + ✈️❗📄, không giới hạn quá khứ/tương lai (tải theo tháng), tìm kiếm toàn bộ lịch (app + Google), lọc dự án/loại/nguồn
- [x] Hẹn định kỳ dài hạn (§5.4.0): chu kỳ bất kỳ (3 tháng, năm, N ngày), "Đã làm" tính lại từ ngày thật, đếm ngược 30/14/7/1, việc chuẩn bị tự vào Hộp duyệt trước 30 ngày, lịch sử từng lần, cảnh báo trùng ngày bay
- [x] Khách hàng nhập MỘT lần (v2.3, sửa lỗi nhập lại "Đô Thị"): tên gõ tay rồi Lưu là vào danh bạ, tìm không dấu, tên gần giống dùng lại không tạo trùng, gợi ý theo gần đây → hay dùng → thứ tự Mai đặt
- [x] Chạm để XEM việc (5.2.2 v2.6, sửa lỗi chạm dòng là đóng): màn chi tiết việc đầy đủ (dự án/khách/hạn/ghi chú/nguồn/lịch sử); đóng CHỈ bằng tick hoặc nút Xong, có "Hoàn tác" 6 giây; đóng qua chat có thẻ xác nhận; mục "Đã xong" + Mở lại (hạn qua → gợi ý hạn mới)
- [x] Hạn chỉ-có-ngày không hiện "0:00" (lỗi 22/9); việc còn hạn xa >14 ngày không leo lên Ưu tiên hôm nay trừ khi Mai gắn ⭐ hoặc việc đang chặn người khác
- [x] Ghi chú trong từng việc (3d): nhật ký có giờ, sửa/xóa từng dòng, tách riêng với trích dẫn Nguồn; ô ghi chú ngay trên thẻ duyệt; lệnh "ghi chú cho việc X: …"
- [x] Nhắc đặt lịch trước (§5.4.2): danh bạ nơi cần đặt (spa, nhà hàng…) với số ngày đặt trước + cách đặt; lịch ở đó mang "🔖 Chưa đặt" đến khi bấm Đã đặt, việc "Đặt lịch…" tự vào Hộp duyệt đúng hạn, cảnh báo khi còn <24h, nút Gọi/link đặt chỗ
- [x] Địa điểm đã lưu theo thành phố (§8, trả nợ v2.0): "Nhà ở HCM", "Nhà Bang Na"… kèm địa chỉ + link Mở Maps; chuỗi ngày bay tự chọn đúng nhà 🏠 theo đầu chặng (chặng từ SGN đi từ nhà HCM), ô chọn nhanh ở cả chuỗi bay lẫn chuỗi hẹn
- [x] Sửa nút "Mở" vé máy bay không hoạt động trên điện thoại: đổi window.open (bị chặn popup) thành link trực tiếp + nút Tải
- [x] Tạm ngưng dự án + xóa phải chọn nơi chuyển việc (§5.3.1)
- [x] Màn Dự án = **lưới ô như thư mục** (§5.3.0 v2.8, sửa lỗi 22–23/9): mỗi dự án một ô chạm được (kể cả Cá nhân/Học tập/Admin), hiện số mở/quá hạn/7 ngày; bỏ danh sách "Việc đang mở" trùng với Hôm nay
- [x] **Màn chi tiết dự án** (§5.3.0 v2.9): nhóm theo Category / Khách hàng / Hạn + bộ lọc gom vào **hai dropdown một dòng** (app nhớ lựa chọn), "Đã xong (N)" từng nhóm, Book block, lịch sắp tới của dự án
- [x] Ô **"+ Thêm việc" đầy đủ trường** trong dự án (v2.9): Tên · Ghi chú · Category · Khách · Deadline · ⭐, nút 🎤 nói một câu là tự điền các ô; thiếu category/khách/hạn thì hỏi **đúng một câu** với 2–3 lựa chọn bấm nhanh + Bỏ qua; lưu xong giữ nguyên category để nhập liên tiếp
- [x] Nhóm **"Chưa gắn khách"** (v2.9): chạm tiêu đề nhóm để gắn cả nhóm cho một khách, ô 🤝 trên từng dòng gắn một việc một chạm (chạm dòng vẫn mở chi tiết), kèm "Tạo khách mới"
- [x] "Deadline 7 ngày tới" **đầy đủ** (§5.3.3 v2.8, sửa lỗi thiếu việc 23/9): tiêu đề có số đếm, nhóm theo ngày, "Xem tất cả (N)" thay vì cắt bớt; khoảng tính theo ngày địa phương — có test 20+ việc cùng hạn
- [x] Danh bạ ↔ voice/ảnh (§5.3.2 v2.8): tên khách làm từ vựng ưu tiên cho Whisper; thẻ duyệt ghi rõ *nhận từ "đô thị"*; cách viết Mai gõ cho khách đã có tự thành tên gọi khác; ô "+ khách hàng" hết bị cắt chữ, chọn loại ngay khi thêm
- [x] **Nhiều tài khoản Google/Lark cùng lúc (§5.3.4)**: màn Kết nối — mỗi tài khoản một dòng bật/tắt Lịch·Mail·Drive, thêm nhiều Google song song với Lark (OAuth Lark, cần `LARK_APP_ID/SECRET`); lịch mọi tài khoản gộp một góc nhìn + khử trùng sự kiện mời chéo; lịch đích mặc định theo dự án + chọn ngay trên thẻ xem trước; quét vé chạy trên mọi hộp thư, kết quả ghi rõ hộp nào (Lark Mail best-effort, chờ kiểm chứng quyền của tổ chức); cookie Google cũ giữ nguyên — không phải nối lại
- [x] **Chụp ảnh banner sự kiện → tạo lịch** (§5.1.1 v3.0): ảnh banner/poster/thiệp mời → thẻ xem trước sự kiện (tên, giờ, địa điểm + Mở Maps, tổ chức, giá, hạn đăng ký, link kể cả mã QR giải trên máy); năm suy theo hôm nay, banner đã qua → báo "đã diễn ra"; thiếu giờ hỏi đúng một câu; trùng tên + ngày → Cập nhật thay vì tạo trùng; việc "Đăng ký / mua vé" tự vào Hộp duyệt với hạn đăng ký; ảnh gốc đính vào sự kiện (nút 🖼 ở Lịch)
- [x] **Phân loại ảnh trước khi trích** (§5.1.1 v3.1, sửa lỗi "không đọc được dòng việc nào" 23/9): checklist · banner sự kiện · screenshot chat/email · tài liệu · **danh thiếp** (→ thẻ thêm vào danh bạ khách) · khác; không chắc thì hiện những gì đọc được + hỏi một câu + nút tạo thủ công; ảnh mờ/chữ nhỏ báo rõ lý do
- [x] **Lịch đích hiện sẵn theo dự án** trên thẻ banner + **tùy chọn ⚡ book thẳng từng dự án** (đủ giờ + địa điểm + không trùng mới book, luôn có Hoàn tác; việc "Đăng ký / mua vé" vẫn qua Hộp duyệt)
- [ ] Lịch con từng tài khoản + dấu tài khoản trên sự kiện + trạng thái đồng bộ từng dòng; soạn email trả lời từ đúng hộp thư
- [ ] Sync Google Sheets · ghi âm họp offline + recap
- [ ] Giai đoạn 2: Lark (bot group, Mail, Calendar) trước, sau đó bot 1:1 WhatsApp/Zalo
- [ ] Giai đoạn 3: Supabase + RLS, tài khoản cộng sự, giao việc chéo, danh bạ đồng bộ máy chủ

Nguyên tắc không đổi (PRD §6.5): giao việc < 10 giây · **duyệt trước, tự động sau** · mọi việc tự trích đều có nguồn · dễ thương nhưng thật thà.
