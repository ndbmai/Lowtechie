# PRD — Mai Lowtechie: Trợ lý AI Chief of Staff cá nhân & nhóm

*Phiên bản 0.7 — 18/09/2026. Bổ sung: UX/UI, user flow, ghi recap cuộc họp, điều phối thời gian chuẩn bị + di chuyển (mặc định BTS từ ga Bang Na), chuyến đi & checklist bay, nguyên tắc chat/voice cho mọi tính năng, nhập việc từ hình chụp, kiểm tra trước khi lưu và phân loại thông minh theo dự án + category.*

Tài liệu đi kèm: **Mai Lowtechie — UI & user flow** (mockup màn hình) và **Checklist bay của Mai** (mẫu checklist tick được, dùng làm nguyên mẫu cho module 5.9).

---

## 1. Bối cảnh & vấn đề

Mai vận hành song song nhiều mảng: **Sorene AI** (sản phẩm + gọi vốn), **The Circle Technology** (tư vấn AI tại Bangkok, HCMC, Tokyo), **Favstay/Favultimate** (revenue management cho 150+ khách sạn), **The Intelligent Edge** (newsletter ~10.000 subscriber), cộng thêm việc cá nhân (học tiếng Thái, spa, sức khỏe, giấy tờ).

Vấn đề cốt lõi không phải là thiếu công cụ to-do, mà là:

1. **Việc sinh ra ở khắp nơi** — Zalo, WhatsApp, email, cuộc họp, trong đầu — và không ai gom lại.
2. **Chi phí sắp xếp cao** — ghi task, gắn dự án, đặt deadline, xếp lịch đều là việc thủ công.
3. **Không nhìn thấy trade-off** — không biết tuần này thời gian thực sự đổ vào dự án nào, và dự án nào đang bị bỏ đói.
4. **Phối hợp với cộng sự rời rạc** — cam kết trong group chat ("mai em gửi nhé") bị trôi, không ai theo dõi.

## 2. Mục tiêu

| Mục tiêu | Đo bằng |
|---|---|
| Giao việc trong < 10 giây (chat hoặc voice) | Thời gian từ lúc nói đến lúc task được tạo |
| ≥ 80% đầu việc từ group chat được bắt tự động | So sánh với review thủ công hàng tuần |
| Tỷ lệ task trích xuất bị xóa vì sai/không cần < 20% | Precision của triage inbox |
| ≥ 90% việc được xếp đúng dự án + category mà Mai không phải sửa (sau 4 tuần dùng) | Log sửa phân loại |
| Mỗi sáng có brief, mỗi tuần có review | Tỷ lệ mở brief |
| Biết được % thời gian mỗi dự án/tuần | Báo cáo tuần |

**Không phải mục tiêu (v1):** thay thế Notion/Drive làm kho tài liệu; quản lý dự án kiểu Jira cho team lớn; tự động gửi tin nhắn thay Mai mà không duyệt.

## 3. Người dùng

- **Chính: Mai** — founder đa dự án, di chuyển giữa 3 múi giờ (ICT, ICT, JST), dùng tiếng Việt / Thái / Anh, thích nói hơn gõ khi di chuyển.
- **Phụ: cộng sự** — mỗi người có một assistant riêng, cùng chia sẻ không gian dự án chung.

## 4. Use case chính (user stories)

1. *"Nhắc chị gọi cho anh A bên OKR thứ Ba tuần sau, liên quan hợp đồng Circle"* → task gắn dự án Circle, deadline, reminder.
2. *(voice, đang đi taxi)* "Tuần này dời spa sang thứ Năm, và book 2 tiếng deep work cho Sorene pitch deck" → agent đề xuất slot, Mai bấm duyệt, lịch được tạo.
3. Group Zalo "Favstay Ops" bàn 40 tin nhắn → cuối ngày agent tóm tắt: 3 quyết định, 4 đầu việc (ai làm, hạn khi nào), 2 câu hỏi chưa có ai trả lời.
4. Sáng thứ Hai: "Hôm nay có gì?" → brief: lịch, 3 việc ưu tiên nhất, việc đang chờ người khác, deadline trong 7 ngày.
5. Cộng sự của Circle hỏi assistant của họ: "Mai đã duyệt proposal chưa?" → assistant trả lời từ không gian chung (không lộ việc riêng của Mai).
6. Chủ nhật: weekly review — thời gian đã dùng theo dự án, việc trễ hạn, đề xuất việc nên **bỏ hoặc hoãn**.
7. Họp với khách ở Bangkok (offline) → Mai bấm Ghi âm; 30 giây sau khi kết thúc có recap: quyết định, việc cần làm theo người, câu hỏi bỏ ngỏ.
8. Cuộc gọi Google Meet trong lịch → Lowtechie hỏi trước, vào họp ghi chú, gửi recap để Mai duyệt.

## 5. Yêu cầu chức năng

### 5.0 Nguyên tắc xuyên suốt: mọi thứ làm được bằng chat hoặc voice
Mai có thể ra **mọi** yêu cầu bằng chat (gõ) hoặc voice (nói), bằng tiếng Việt, tiếng Thái, tiếng Anh hoặc trộn lẫn. Không có tính năng nào bắt buộc phải bấm qua nhiều màn hình; giao diện chỉ để xem, duyệt nhanh và chỉnh sửa.

- **Kênh nhận lệnh:** ô chat và nút bông mai (giữ để nói) trong app; bot 1:1 trên Zalo, WhatsApp, Telegram (gõ hoặc gửi voice note); widget màn hình khóa / phím tắt điện thoại để nói ngay không cần mở app.
- **Lệnh nhiều ý trong một câu:** Lowtechie tách thành từng hành động và trình bày lại trong một thẻ tóm tắt.
- **Xác nhận bằng chính kênh đó:** trả lời "ok", "lưu đi", "đổi sang thứ Năm" bằng chat hoặc voice đều được; không bắt mở app để bấm.
- **Phản hồi bằng giọng nói (tùy chọn):** khi Mai dùng voice lúc đang di chuyển, Lowtechie có thể đọc tóm tắt ngắn thay vì chỉ hiển thị chữ.
- **Hỏi lại tối đa một câu** khi thiếu thông tin quan trọng.

**Ví dụ lệnh theo module**
| Module | Chat / voice ví dụ |
|---|---|
| Giao việc | "Thứ Ba nhắc chị gửi báo giá cho OKR, dự án Circle, gấp" |
| Ảnh | *(gửi ảnh checklist)* + "việc của Favstay, hạn thứ Sáu" |
| Lịch & di chuyển | "Tối nay 7 giờ hẹn ở Thonglor, đi tàu" / "Mai đi ô tô ra sân bay nhé" |
| Hồ sơ chuẩn bị | "Lần này chỉ cần 30 phút chuẩn bị thôi" |
| Chuyến đi | "Thứ Tư tuần sau chị bay Tokyo 4 ngày" / "Thêm máy uốn tóc vào checklist Tokyo" |
| Group chat | "Hôm nay group Favstay Ops có gì cần chị xử lý?" |
| Họp | "Ghi âm cuộc họp này" / "Gửi recap cho anh Tuấn" |
| Review | "Tuần này chị dồn thời gian vào đâu?" / "Bỏ việc viết lại trang About" |
| Cá nhân | "Đặt lịch spa thứ Năm 4 giờ" / "Hôm nay chị học tiếng Thái rồi" |

### 5.1 Capture (thu thập)
- Nhập qua: chat trong app, voice note (VI/TH/EN, trộn ngôn ngữ), forward tin nhắn/email vào bot, chia sẻ ảnh chụp màn hình.
- Agent tự tách 1 câu nói thành nhiều task, gắn dự án, người, deadline, ưu tiên.
- Nếu độ tin cậy thấp → hỏi lại **một** câu, không hỏi dồn.

### 5.1.1 Nhập việc từ hình chụp
Mai gửi ảnh, Lowtechie tự trích danh sách việc.

- **Nguồn ảnh:** checklist viết tay trên giấy, bảng trắng sau buổi họp, sticky note, ảnh chụp màn hình (ghi chú điện thoại, tin nhắn, email, file Excel), tài liệu in.
- **Kênh gửi:** chụp trong app, chia sẻ từ thư viện ảnh (share sheet), gửi vào bot Zalo/WhatsApp/Telegram 1:1. Gửi nhiều ảnh một lần được.
- **Ảnh + lời nhắn đi kèm:** gửi ảnh kèm chat hoặc voice, ví dụ "đây là việc của Favstay, hạn thứ Sáu", để gắn dự án và hạn cho cả danh sách.
- **Trích xuất:**
  - Từng dòng thành một việc; giữ cấu trúc nhóm/mục con nếu có.
  - Nhận biết ô đã tick / gạch ngang: mục đã xong được đánh dấu xong (hoặc bỏ qua), chỉ mục chưa xong thành việc mới.
  - Đọc ngày, tên người, dấu ưu tiên (*, !, gạch chân, khoanh tròn) nếu có.
  - Tiếng Việt, tiếng Thái, tiếng Anh, kể cả viết trộn.
- **Kết quả vào Hộp duyệt** dưới dạng một nhóm, ảnh gốc đính kèm làm nguồn; Mai nhận cả nhóm, hoặc sửa/bỏ từng dòng.
- **Dòng đọc không chắc** (chữ tay khó đọc, ảnh mờ, lóa) được đánh dấu riêng kèm vùng cắt từ ảnh để Mai xem và sửa nhanh.
- **Biến ảnh thành mẫu:** ảnh một danh sách dùng lặp lại (ví dụ đồ mang theo khi bay) có thể lưu thành mẫu checklist cho module 5.9 thay vì thành việc một lần.
- **Lưu ảnh:** ảnh gốc lưu theo thời hạn (ví dụ 90 ngày) rồi xóa, danh sách việc giữ lâu dài.

Độ khó kỹ thuật: thấp. Mô hình Claude đọc ảnh trực tiếp; phần việc chính là thiết kế bước duyệt và xử lý dòng đọc không chắc.

### 5.2 Task engine
- Trường dữ liệu: tiêu đề, dự án, người phụ trách, deadline (cứng/mềm), ưu tiên, trạng thái, ước lượng thời gian, nguồn (kênh + link/trích đoạn tin nhắn gốc), độ tin cậy.
- **Triage inbox**: mọi task trích xuất tự động vào hàng chờ duyệt trước, swipe để nhận/sửa/bỏ. Task do Mai tự giao đi thẳng vào danh sách.
- Ưu tiên tính theo: deadline, trọng số dự án (Mai đặt, ví dụ Sorene 40%, Circle 30%...), phụ thuộc (đang chặn người khác?), năng lượng cần (deep/shallow).
- Loại đặc biệt: **Waiting-on** (việc đã giao/đang chờ người khác, tự nhắc follow-up), **Routine** (học tiếng Thái hằng ngày, spa định kỳ), **Hard deadline hành chính** (thuế, gia hạn, báo cáo pháp lý).

### 5.2.1 Kiểm tra trước khi lưu & phân loại thông minh
**Nguyên tắc:** không việc nào được ghi vào danh sách hay file checklist (Google Sheets / Notion) khi chưa qua bước kiểm tra và Mai chưa xác nhận. Áp dụng cho mọi nguồn: chat, voice, ảnh, group chat, recap họp, email.

**Luồng**
```mermaid
flowchart LR
  A[Nhận việc từ bất kỳ nguồn nào] --> B[Tách & chuẩn hóa]
  B --> C[Phân loại: dự án + category]
  C --> D[Kiểm tra: trùng, thiếu, mâu thuẫn]
  D --> E[Thẻ xác nhận]
  E --> F{Mai xác nhận bằng chat / voice / bấm}
  F -- Đồng ý --> G[Ghi vào danh sách + file checklist]
  F -- Sửa --> C
  F -- Bỏ --> H[Không lưu, ghi nhận để học]
```

**1. Tách & chuẩn hóa**
- Một câu nhiều ý thành nhiều việc; mỗi việc bắt đầu bằng động từ rõ ràng ("Gửi báo giá cho OKR", không phải "báo giá OKR").
- Việc quá to hoặc mơ hồ ("làm marketing Favstay") → đề xuất tách thành 2–4 việc cụ thể hoặc hỏi lại.

**2. Phân loại vào đúng dự án và category**
- Hai tầng: **Dự án** → **Category**.

| Dự án | Category mặc định |
|---|---|
| Sorene | Sản phẩm · Gọi vốn · Tăng trưởng & cohort · Pháp lý & công ty |
| The Circle Technology | Khách hàng & bán hàng · Delivery dự án · Đào tạo · Marketing & nội dung · Hợp đồng |
| Cá nhân | Sức khỏe & làm đẹp · Chuyến đi · Nhà cửa · Giấy tờ & tài chính cá nhân |
| Học tập | Tiếng Thái |
| Admin chung | Thuế & hạn pháp lý · Hóa đơn · Công cụ & tài khoản |

  Mai thêm, đổi tên, gộp category bằng chat/voice ("tạo category Tuyển dụng cho Circle").
- **Tín hiệu dùng để phân loại:** từ khóa và tên riêng (khách hàng, khách sạn, đối tác gắn với dự án); nguồn (group chat, email, cuộc họp đã gắn dự án); người liên quan (cộng sự thuộc dự án nào); lịch sử (việc tương tự trước đây Mai xếp vào đâu); lời Mai nói kèm ("việc của Favstay").
- **Mỗi việc có độ chắc chắn phân loại.** Dưới ngưỡng → hiện 2 lựa chọn dự án/category có khả năng nhất để Mai chọn một chạm, không đoán bừa.
- **Việc liên quan nhiều dự án:** một dự án chính + gắn tag dự án phụ.
- **Học từ sửa đổi:** mỗi lần Mai đổi dự án/category, hệ thống ghi lại và áp dụng cho lần sau (ví dụ: tên "Rạng Đông" luôn là Favstay / Khách sạn & vận hành).

**3. Kiểm tra trước khi lưu**
| Kiểm tra | Xử lý |
|---|---|
| Trùng với việc đã có | Đề xuất gộp, hoặc cập nhật việc cũ thay vì tạo mới |
| Thiếu hạn / thiếu người làm với việc cần có | Đề xuất hạn hợp lý hoặc hỏi một câu |
| Hạn đã qua, rơi vào ngày Mai đang bay, hoặc trùng lịch dày | Cảnh báo và đề xuất ngày khác |
| Mâu thuẫn với việc/quyết định trước | Nêu rõ mâu thuẫn, để Mai chọn |
| Việc đã xong (ô đã tick trong ảnh, đã báo xong trong chat) | Đánh dấu xong, không tạo việc mới |
| Việc phụ thuộc việc khác | Gắn liên kết phụ thuộc |
| Ưu tiên | Gợi ý theo hạn + trọng số dự án; Mai chỉnh được |

**4. Thẻ xác nhận**
- Tóm tắt theo nhóm, ví dụ: *"5 việc mới: 3 Sorene / Gọi vốn, 2 Cá nhân / Chuyến đi. 1 việc trùng (đề xuất gộp), 1 việc thiếu hạn."*
- Mỗi dòng hiện: việc · dự án / category · hạn · người · ưu tiên · độ chắc chắn · nguồn.
- Xác nhận bằng bấm, chat hoặc voice: "ok lưu hết", "việc số 2 chuyển sang Circle", "bỏ việc cuối".
- Chỉ sau xác nhận mới ghi vào file; file ghi thêm cột **Nguồn** và **Ngày tạo** để truy vết.
- **Tự động dần:** khi độ chính xác phân loại của một loại việc đủ cao trong thời gian dài (ví dụ routine cá nhân), Mai có thể bật "lưu thẳng, báo sau" cho riêng loại đó. Mặc định luôn hỏi.

### 5.3 Dự án
- Mỗi dự án có: mục tiêu quý, trọng số thời gian, thành viên, kênh chat liên kết, file liên kết, decision log.
- Dự án khởi tạo: Sorene, Circle, Cá nhân, Học tập, Admin chung. *(Quyết định 22/9/2026: bỏ Favstay và Intelligent Edge khỏi danh sách.)*
- **Mai tự thêm / đổi tên / xóa dự án và category** trong app (Dự án → Quản lý) hoặc bằng chat/voice; xóa dự án thì việc đang mở chuyển về Cá nhân.

### 5.4 Calendar agent
- Đọc/ghi Google Calendar.
- Tìm slot trống có tính múi giờ, thời gian di chuyển, và "vùng bảo vệ" (deep work, nghỉ).
- **Time-blocking**: tự đặt block cho task lớn trước deadline.
- **Mọi hành động ghi lịch đều cần Mai bấm duyệt** ở v1; cho phép tự động hóa dần theo từng loại (ví dụ: routine cá nhân được tự đặt).
- Đặt lịch với người khác: soạn tin đề xuất giờ, Mai duyệt trước khi gửi.

### 5.4.1 Điều phối thời gian: chuẩn bị + di chuyển
Mục tiêu: Mai chỉ cần nói "hẹn 19:00 ở Thonglor" hoặc "bay 10:30 từ Suvarnabhumi", Lowtechie tự tính ngược và khóa lịch để biết **khi nào bắt đầu chuẩn bị** và **khi nào phải đi**.

**Tính ngược từ giờ hẹn**
```
Giờ hẹn 19:00 (Thonglor)
  − đệm đến sớm (10 phút)
  − di chuyển (Google Maps, giao thông dự báo lúc 18:xx, mô hình "ngày xấu")
  − đệm rời nhà (10 phút: thang máy, gọi xe)
  − chuẩn bị (1 tiếng 30: tắm + make up)
  = giờ bắt đầu chuẩn bị
```
Kết quả trên lịch: 3 block liên tiếp, **Chuẩn bị** → **Di chuyển** → **Cuộc hẹn**, màu nhạt hơn cuộc hẹn chính, đánh dấu "bận".

**Hồ sơ chuẩn bị (Mai tự đặt, dùng lại)**
| Loại | Thời gian | Khi nào áp dụng |
|---|---|---|
| Ra ngoài đầy đủ (tắm + make up) | 1 tiếng 30 | Hẹn gặp trực tiếp, sự kiện |
| Ra ngoài nhanh | 30 phút | Cà phê gần nhà, spa |
| Họp online có quay mặt | 20 phút | Họp video với khách |
| Không cần chuẩn bị | 0 | Việc cá nhân, họp chỉ audio |
Lowtechie gợi ý hồ sơ theo loại sự kiện; Mai đổi bằng một chạm.

**Sân bay**
- Chuyến bay có block riêng: chuẩn bị + di chuyển + **đệm sân bay** (mặc định 2 tiếng 30 cho bay quốc tế, 1 tiếng 30 nội địa; Mai chỉnh được theo sân bay, có hành lý ký gửi hay không, có fast track hay không).
- Đọc email xác nhận vé (Gmail) để lấy giờ bay, sân bay, nhà ga; giờ bay luôn lưu theo múi giờ địa phương của sân bay đi/đến.
- Đổi giờ bay → cả chuỗi block tự dời theo.

**Địa điểm & điểm xuất phát**
- Lưu các địa điểm quen: Nhà (Bangkok), Nhà (HCMC), khách sạn khi ở Tokyo, văn phòng.
- Điểm xuất phát = nơi Mai ở ngay trước đó trên lịch (nếu có cuộc hẹn trước), không mặc định là nhà. Hai cuộc hẹn liền nhau thì tính đường giữa hai nơi.
- Hỏi lại khi địa điểm mơ hồ ("Thonglor" là cả một khu → xin tên quán hoặc dùng điểm giữa khu, ghi chú rõ).

**Phương tiện: mặc định tàu điện**
- Ở Bangkok, Lowtechie **mặc định tính theo tàu điện (BTS)**. Chỉ tính theo ô tô khi Mai nói rõ ("tối nay đi ô tô", "book Grab").
- **Tuyến quen từ nhà:** Nhà (Bangkok) → đi bộ → **BTS Bang Na** → tàu → ga gần điểm hẹn → đi bộ đến nơi.
- **Thời gian đi bộ nhà → BTS Bang Na:** Google Maps tính một lần từ địa chỉ nhà đã lưu (chế độ đi bộ), Mai xem và chỉnh nếu thực tế khác (ví dụ tính cả thang máy, lên ga). Lưu lại, không gọi API mỗi lần.
- **Chuỗi tính ngược khi đi tàu:**
```
Giờ hẹn
  − đệm đến sớm (10 phút)
  − đi bộ từ ga xuống đến nơi hẹn (Google Maps)
  − thời gian tàu + đổi tuyến nếu có (Google Maps, chế độ phương tiện công cộng)
  − đệm chờ tàu / qua cổng (5 phút)
  − đi bộ nhà → BTS Bang Na (giá trị đã lưu)
  − đệm rời nhà (10 phút)
  − chuẩn bị (theo hồ sơ)
  = giờ bắt đầu chuẩn bị
```
- Với phương tiện công cộng, Google Maps cho phép nhập thẳng **giờ muốn đến**, nên phép tính gọn và chính xác hơn so với ô tô.
- **Trời mưa:** nếu dự báo mưa vào giờ đi, cộng thêm đệm cho đoạn đi bộ (mặc định +10 phút) và nhắc mang ô.
- **Khi tàu điện không hợp lý** (ví dụ sân bay Suvarnabhumi phải đổi nhiều tuyến, hoặc điểm hẹn cách ga quá xa để đi bộ): Lowtechie vẫn tính theo tàu, nhưng hiện thêm phương án ô tô bên cạnh để Mai chọn; không tự đổi.
- Ở HCMC và Tokyo: phương tiện mặc định đặt riêng cho từng thành phố.

**Cảnh báo "đến giờ"**
- Thông báo lúc bắt đầu chuẩn bị, và lúc phải đi (kèm link mở Google Maps chỉ đường).
- 45–60 phút trước giờ đi, kiểm tra lại giao thông thực tế; nếu chậm hơn dự kiến > 10 phút → báo "đi sớm hơn 15 phút" và dời block.
- Xung đột (chuẩn bị chồng lên cuộc họp trước) → cảnh báo ngay lúc đặt lịch, đề xuất dời hoặc chuẩn bị rút gọn.

**Giới hạn cần biết**
- Google Maps Routes API cho phép chọn giờ **đến** chỉ với phương tiện công cộng (đúng với lựa chọn mặc định BTS của Mai); với ô tô chỉ nhập được giờ **đi**, nên khi Mai đi ô tô hệ thống phải thử vài giờ đi và chọn giờ muộn nhất vẫn đến kịp.
- Cần kiểm tra chất lượng dữ liệu lịch tàu BTS/MRT trên Google Maps bằng vài chuyến thật trước khi tin hoàn toàn.
- Dự báo giao thông nhiều ngày trước chỉ là ước lượng lịch sử; con số chính xác nhất là lần kiểm tra lại trước giờ đi.
- Không lấy được thời gian chờ Grab thực tế qua API; dùng đệm cố định.

### 5.5 Ingest group chat (Zalo / WhatsApp)
- Đọc tin nhắn các group được cho phép (allowlist), tóm tắt theo lịch (cuối ngày hoặc khi có `@bot`).
- Trích xuất: đầu việc, người nhận, hạn, quyết định, câu hỏi bỏ ngỏ, cam kết ngầm ("để em lo").
- Lưu kèm trích dẫn gốc để kiểm chứng.
- Xem mục 8 về giới hạn kỹ thuật — **đây là phần rủi ro nhất của sản phẩm.**

### 5.6 Không gian chung & assistant của cộng sự
- Mô hình quyền 3 lớp: **Riêng tư** (chỉ Mai) / **Dự án** (thành viên dự án) / **Công khai trong team**.
- Mỗi cộng sự có assistant riêng, truy vấn được dữ liệu cấp Dự án họ tham gia.
- Giao việc chéo: assistant của Mai tạo task cho cộng sự → xuất hiện trong inbox của họ để nhận/từ chối.
- v1 dùng **một hệ thống, nhiều người dùng** (shared database + phân quyền), không làm giao thức agent-nói-chuyện-với-agent — đơn giản và an toàn hơn nhiều.

### 5.7 Xuất ra file
- Chỉ ghi vào file sau bước xác nhận ở mục 5.2.1.
- Cấu trúc file checklist (Google Sheets): một tab mỗi dự án + một tab "Tất cả". Cột: Dự án · Category · Việc · Người làm · Hạn · Ưu tiên · Trạng thái · Nguồn · Ngày tạo · Ghi chú. Lọc và nhóm theo category có sẵn.
- Đồng bộ task sang Google Sheets (một tab / dự án) và/hoặc Notion — để cộng sự không dùng app vẫn xem được.
- Ghi chú & biên bản họp lưu vào Google Drive theo thư mục dự án.

### 5.8 Họp & recap
- **Họp online (Google Meet, Zoom, Teams):** Lowtechie đọc lịch, thấy sự kiện có link họp thì hỏi trước "Mình tham dự ghi chú nhé?". Nếu Mai đồng ý, một bot tham gia cuộc họp như một thành viên có tên "Mai Lowtechie (ghi chú)", ghi âm, chép lời theo từng người nói.
- **Họp offline:** nút Ghi âm trong app; trước khi ghi phải xác nhận đã báo cho người tham dự. Ghi được khi màn hình tắt, tải lên theo đoạn để không mất dữ liệu khi mạng yếu.
- **Upload file:** thả file ghi âm/ghi hình có sẵn để làm recap.
- **Recap theo mẫu cố định:** Tóm tắt (3–5 câu), Quyết định, Việc cần làm (người + hạn), Câu hỏi bỏ ngỏ, Trích đoạn quan trọng có mốc thời gian.
- Việc cần làm vào Hộp duyệt; recap lưu vào Google Drive theo thư mục dự án; Mai chọn có gửi recap vào group Zalo/WhatsApp hay email cho người tham dự không.
- Ngôn ngữ: tiếng Việt, tiếng Thái, tiếng Anh và câu trộn; recap xuất theo ngôn ngữ Mai chọn.
- Chuẩn bị trước họp: 30 phút trước giờ họp gửi brief về người/công ty, lần gặp trước, việc còn treo.

### 5.9 Chuyến đi & checklist bay
Mục tiêu: mỗi chuyến bay tự có kế hoạch chuẩn bị, Mai không phải nhớ gì.

**Tạo chuyến đi**
- Tự động khi Lowtechie đọc được email xác nhận vé (Gmail), hoặc khi Mai nói/gõ ("Thứ Tư tuần sau chị bay Tokyo 4 ngày").
- Một chuyến gồm: điểm đến, giờ bay đi/về (theo múi giờ địa phương), nơi ở, mục đích (gặp khách / cá nhân), ai đi cùng.

**Checklist đồ mang theo** (mẫu gốc: trang "Checklist bay của Mai")
- Nhóm: Giấy tờ · Công nghệ & làm việc · Tiền & thẻ · Làm đẹp & cá nhân · Quần áo · Sức khỏe & trên máy bay.
- **Mẫu theo điểm đến:** Tokyo (Visit Japan Web, tiền mặt yên, thẻ Suica/Pasmo, giày đi bộ), HCMC (tiền đồng), về Bangkok (TDAC nếu áp dụng, baht đi taxi). Mẫu mở rộng được cho điểm đến mới.
- **Theo ngữ cảnh chuyến:** có lịch gặp khách → thêm bộ đồ gặp khách, danh thiếp, tài liệu offline; theo dự báo thời tiết → áo mưa/áo ấm; theo độ dài chuyến → số bộ quần áo.
- Mai thêm/xóa món bằng chat, voice hoặc trong app; món tự thêm được học và giữ cho các chuyến sau cùng điểm đến.
- Nhắc riêng các quy định hay quên: chất lỏng xách tay tối đa 100ml mỗi chai, pin dự phòng không ký gửi.

**Việc trước khi bay: tự đặt thành task có mốc thời gian**
| Mốc | Việc |
|---|---|
| 1 tuần trước | Kiểm tra hộ chiếu (còn ≥ 6 tháng) và yêu cầu nhập cảnh; đặt nơi ở; bảo hiểm; eSIM; báo cộng sự lịch vắng; dời/chuyển online các cuộc họp trùng ngày bay; đặt spa/làm tóc nếu muốn |
| 3 ngày trước | Tờ khai nhập cảnh điện tử theo điểm đến (Visit Japan Web; TDAC trong vòng 3 ngày trước khi đến Thái Lan, chỉ dùng trang chính thức, miễn phí); xem thời tiết; giặt đồ; đổi tiền; tải bản đồ và tài liệu offline; check-in online |
| Tối hôm trước | Sạc thiết bị; xếp hành lý theo checklist; cân hành lý; kiểm tra giờ bay và nhà ga; đặt xe; thanh toán hóa đơn sắp đến hạn; bật trả lời tự động email nếu đi dài ngày |
| Sáng ngày bay | Kiểm tra hộ chiếu, điện thoại, ví; kiểm tra chuyến bay có đổi giờ; tắt điện, bình nóng lạnh, điều hòa; đổ rác, tưới cây; khóa cửa |
| Ở sân bay | Có mặt trước 2 tiếng 30 (quốc tế); nhắn giờ đến cho người đón/cộng sự |

**Kết nối với các module khác**
- Chuỗi lịch ngày bay dùng module 5.4.1: Chuẩn bị (hồ sơ 1 tiếng 30) → Di chuyển ra sân bay → Đệm sân bay → Chuyến bay. Riêng sân bay, Lowtechie hiện thêm phương án ô tô bên cạnh phương án tàu.
- Tối hôm trước, brief buổi tối chuyển thành "brief chuyến bay": giờ phải dậy, giờ phải đi, những món còn chưa tick.
- Ngày về: tự tạo việc "gửi recap chuyến đi / follow-up khách đã gặp".
- Yêu cầu nhập cảnh thay đổi theo quốc tịch và theo thời gian; Lowtechie luôn nhắc kiểm tra trang chính thức, không khẳng định thay.

### 5.10 Briefing & review
- **Brief sáng** (qua app + đẩy sang Zalo/WhatsApp/Telegram): lịch, top 3, chờ người khác, deadline 7 ngày.
- **Shutdown tối**: việc xong, việc dời, nhắc chuẩn bị cho mai.
- **Weekly review**: thời gian theo dự án vs trọng số mục tiêu, việc trễ, đề xuất cắt/hoãn, cam kết chưa ai giữ.

## 6. UX/UI

### 6.1 Thương hiệu
- **Tên:** Mai Lowtechie. Ý tưởng: công nghệ cao nhưng dùng như không cần biết công nghệ.
- **Linh vật:** bông hoa mai năm cánh có mặt cười. Bông mai đồng thời là nút giao việc ở giữa thanh điều hướng, và "nở" khi đang nghe.
- **Tính cách:** smart, dễ thương nhưng không trẻ con; vui vẻ nhưng nói thẳng khi Mai ôm quá nhiều việc.
- **Màu:** vàng mai `#FFC93C` cho hành động chính, mực chàm `#1E2150` cho chữ và dữ liệu, nền sương `#EEF1F8`, má hồng `#FF8FA3` điểm xuyết, xanh lá `#2FA97C` chỉ dành cho "đã xong". Mỗi dự án một màu cố định: Sorene tím, Circle xanh ngọc, Favstay cam san hô, Edge xanh dương, Cá nhân hồng.
- **Chữ:** Baloo 2 (tiêu đề, con số, lời của Lowtechie), Be Vietnam Pro (nội dung, hiển thị dấu tiếng Việt tốt). Cần kiểm tra thêm hiển thị tiếng Thái; dự phòng Noto Sans Thai.
- **Giọng:** xưng "mình", gọi "Mai"; mỗi lần hỏi một câu; đề xuất kèm lý do, không ra lệnh.
- Hỗ trợ chế độ tối ngay từ đầu.

### 6.2 Kiến trúc thông tin
Thanh điều hướng 5 mục: **Hôm nay** · **Dự án** · **Bông mai** (giao việc: giữ để nói, chạm để gõ) · **Lịch** · **Hộp duyệt**. Họp, Weekly review và Cài đặt mở từ Hôm nay hoặc ảnh đại diện.

### 6.3 Màn hình chính
| Màn hình | Mục đích | Thành phần chính |
|---|---|---|
| Hôm nay | Biết ngay nên làm gì | Lời chào + một đề xuất có nút bấm, top 3, việc chờ người khác, lịch trong ngày |
| Giao việc | Nói một câu thành nhiều việc | Sóng âm, lời chép trực tiếp, thẻ việc đã tách, Lưu cả hai / Sửa |
| Hộp duyệt | Kiểm soát việc tự trích | Thẻ vuốt (bỏ / sửa / nhận), nguồn, trích dẫn gốc, độ chắc chắn |
| Dự án | Thấy phân bổ thời gian | Vòng tiến độ thời gian thật so với mục tiêu, cảnh báo dự án bị bỏ đói |
| Lịch | Đặt giờ có kiểm soát | 3 khung đề xuất kèm lý do, ghi chú múi giờ, nút đặt |
| Họp | Ghi và recap | Thanh ghi âm, recap 4 phần, Lưu việc / Gửi recap |
| Chuyến đi | Không quên gì khi bay | Checklist tick được theo điểm đến, việc trước khi bay theo mốc, chuỗi lịch ngày bay |
| Weekly review | Giúp nói "không" | Biểu đồ thời gian vs mục tiêu, việc dời nhiều lần, Bỏ / Giao / Hoãn |

### 6.4 User flow chính

**Giao việc nhanh**
```mermaid
flowchart LR
  A[Giữ bông mai, nói/gõ] --> B[Tách việc, gắn dự án, hạn, ưu tiên]
  B --> C{Thiếu thông tin quan trọng?}
  C -- Có --> D[Hỏi đúng 1 câu] --> E
  C -- Không --> E[Thẻ tóm tắt]
  E --> F[Mai bấm Lưu]
  F --> G{Việc lớn có hạn?}
  G -- Có --> H[Đề xuất khung giờ làm]
```

**Group chat thành việc**
```mermaid
flowchart LR
  A[Tin nhắn trong group có bot] --> B[Cuối ngày hoặc @Lowtechie]
  B --> C[Tóm tắt + trích việc, quyết định, câu hỏi]
  C --> D[Hộp duyệt kèm trích dẫn]
  D --> E{Mai duyệt}
  E -- Nhận --> F[Việc vào danh sách, cộng sự nhận thông báo]
  E -- Bỏ --> G[Ghi nhận để học]
```

**Recap cuộc họp**
```mermaid
flowchart LR
  A{Loại họp} -- Online --> B[Lịch có link họp] --> C[Hỏi Mai có tham dự không] --> D[Bot vào họp, ghi âm]
  A -- Offline --> E[Bấm Ghi âm, xác nhận đã báo mọi người] --> F[Ghi trên điện thoại]
  D --> G[Chép lời, tách người nói]
  F --> G
  G --> H[Soạn recap 4 phần]
  H --> I[Mai duyệt]
  I --> J[Lưu Drive theo dự án]
  I --> K[Việc vào Hộp duyệt]
  I --> L[Gửi recap vào group, nếu chọn]
```

**Nhịp ngày và tuần**
```mermaid
flowchart LR
  A[Brief sáng] --> B[Nhắc việc chờ người khác] --> C[Shutdown tối]
  C --> D[Chủ nhật: weekly review]
  D --> E[Mai quyết bỏ / giao / hoãn]
  E --> F[Khóa lịch tuần mới theo trọng số dự án]
```

### 6.5 Nguyên tắc UX
1. Giao một việc không bao giờ quá 10 giây, bằng chat hoặc voice, từ bất kỳ kênh nào.
2. Duyệt trước, tự động sau: mở tự động dần cho từng loại hành động khi độ chính xác đủ cao.
3. Mọi việc tự trích đều có nguồn gốc (tin nhắn hoặc đoạn ghi âm).
3b. Không lưu gì khi chưa kiểm tra và chưa được Mai xác nhận; phân loại sai thì sửa một chạm và hệ thống nhớ.
4. Dễ thương nhưng thật thà: nói thẳng khi quá tải.

## 7. Kiến trúc đề xuất

```
[Giao diện]  PWA mobile (chat + voice)  |  Bot Telegram/Zalo/WhatsApp 1:1
        │
[Agent layer]  Claude API (tool use) — router → các tool: task, calendar, project, search, file
        │
[Dữ liệu]  Supabase: Postgres + Auth + Row-Level Security + pgvector (tìm lại ngữ cảnh)
        │
[Jobs]  Scheduler (cron / Trigger.dev / Inngest): brief, tóm tắt group, follow-up
        │
[Tích hợp]  Google Calendar · Google Drive/Sheets · Gmail · Zalo · WhatsApp · Speech-to-text
```

Ghi chú lựa chọn:
- **Row-Level Security** của Postgres giải quyết phần phân quyền Riêng tư / Dự án / Team ngay từ tầng dữ liệu — đừng để LLM tự quyết ai được xem gì.
- **Speech-to-text** cần test thật với tiếng Việt, tiếng Thái và câu trộn tiếng Anh trước khi chọn nhà cung cấp.
- Mọi hành động có tác động ra ngoài (ghi lịch, gửi tin) đi qua một lớp **"đề xuất → duyệt → thực thi"** có log.

## 8. Mô hình dữ liệu (rút gọn)

- `projects` (id, name, weight, goal, members, linked_channels)
- `categories` (id, project_id, name)
- `classification_feedback` (task_id, suggested_project, suggested_category, final_project, final_category, signals)
- `tasks` (id, project_id, category_id, title, owner_id, assignee_id, due_at, due_type, priority, status, est_minutes, energy, source_channel, source_ref, source_quote, confidence, visibility)
- `waiting_on` (task_id, person_id, follow_up_at)
- `routines` (title, rrule, project_id)
- `events` (calendar_event_id, task_id)
- `messages_ingested` (channel, group_id, sender, text, ts, processed)
- `decisions` (project_id, text, decided_at, source_ref)
- `people` (name, org, channels, last_contact_at)
- `places` (name, address, place_id, city, is_home, home_station, walk_to_station_min)
- `city_defaults` (city, default_mode, rain_walk_buffer_min)
- `prep_profiles` (name, minutes, applies_to)
- `event_chains` (event_id, prep_block_id, travel_block_id, origin_place_id, mode, last_checked_at)
- `trips` (destination, depart_at, return_at, flight_refs, stay_place_id, purpose)
- `checklist_templates` (destination, group, item, hint, learned_from_user)
- `trip_checklist_items` (trip_id, template_item_id / custom_text, done)
- `voice_inputs` (audio_ref, transcript, language, parsed_actions, channel)
- `image_inputs` (image_ref, channel, caption, extracted_items, low_confidence_regions, expires_at)
- `meetings` (calendar_event_id, mode online/offline, recording_ref, transcript_ref, recap, consent_confirmed, project_id)
- `actions_log` (proposed, approved_by, executed_at, result)

## 9. Tính khả thi tích hợp — đọc kỹ phần này

| Kênh | Chính thức làm được gì | Giới hạn thực tế | Khuyến nghị |
|---|---|---|---|
| **Google Calendar / Drive / Gmail** | Đọc/ghi đầy đủ qua API | Không đáng kể | Làm ngay ở v1 |
| **WhatsApp** | Bot 1:1 qua Cloud API; Groups API (2026) chỉ cho group **do doanh nghiệp tạo**, tối đa 8 thành viên, yêu cầu Official Business Account | **Không đọc được các group WhatsApp hiện có của Mai** | v1: bot 1:1 để capture + forward. Group mới nhỏ có thể tạo qua Groups API nếu đạt điều kiện |
| **Zalo** | Zalo Bot / OA chính thức chủ yếu cho hội thoại 1:1 | Đọc group cá nhân chỉ khả thi qua thư viện **không chính thức** (dựa trên zca-js) chạy trên tài khoản cá nhân | Có rủi ro khóa tài khoản & vi phạm điều khoản. Nếu dùng: tài khoản Zalo phụ riêng cho bot, không dùng tài khoản chính |
| **Google Maps (Routes, Places)** | Thời gian di chuyển có dự báo giao thông (kể cả mô hình "ngày xấu"), tìm địa điểm, deep link chỉ đường | Chọn giờ đến chỉ hỗ trợ phương tiện công cộng; tính phí theo lượt gọi | Làm ở v1 cùng Calendar; cache tuyến quen để giảm chi phí |
| **Họp online (Meet/Zoom/Teams)** | Dịch vụ meeting-bot (ví dụ Recall.ai) cho bot vào họp chỉ bằng link, trả về ghi âm và lời chép theo người nói; Zoom còn có luồng media không cần bot | Bot hiện tên trong danh sách người họp, có thể cần chủ trì cho vào, một số tổ chức chặn bot; tính phí theo phút | Dùng dịch vụ bên ngoài, không tự xây bot. Tự động hỏi trước mỗi cuộc họp |
| **Họp offline** | Ghi âm trên điện thoại + speech-to-text có tách người nói | Chất lượng phụ thuộc micro, phòng ồn, và độ chính xác tiếng Việt/Thái | Test 3 nhà cung cấp STT với ghi âm thật trước khi chọn |
| **Telegram / Lark / Slack** | API group đầy đủ, bot đọc được group khi được thêm vào | Phải thuyết phục team chuyển kênh | Cân nhắc nghiêm túc cho các group làm việc cốt lõi |

**Ghi âm cuộc họp:** luôn thông báo cho người tham dự; bot online dùng tên rõ ràng "Mai Lowtechie (ghi chú)"; bản ghi âm gốc có thời hạn lưu (ví dụ 30 ngày), recap lưu lâu dài.

**Đồng thuận & dữ liệu cá nhân:** đọc và lưu tin nhắn của cộng sự là xử lý dữ liệu cá nhân (Nghị định 13/2023 tại Việt Nam, PDPA tại Thái Lan). Cần thông báo rõ và có sự đồng ý của thành viên group; bot nên hiện diện công khai trong group, không đọc ngầm.

## 10. Lộ trình

**Giai đoạn 0 — 1 tuần: dùng thử trước khi code**
Dùng Claude (đã kết nối Google Calendar, Drive, Gmail) + một Project làm "trợ lý" thủ công; forward tin nhắn vào để trích task. Ghi lại những gì thực sự hữu ích. Mục đích: không xây nhầm.

**Giai đoạn 1 — MVP cá nhân (3–4 tuần, build bằng Claude Code)**
Capture **chat + voice + ảnh** cho mọi module (app và bot Telegram/Zalo 1:1) → task engine + **kiểm tra trước khi lưu + phân loại dự án/category** + triage inbox → dự án → Google Calendar (có duyệt) → sync Google Sheets → **tự khóa block chuẩn bị + di chuyển (Google Maps)** → brief sáng → **chuyến đi + checklist bay** → **ghi âm họp offline + recap** (rẻ, giá trị cao, không phụ thuộc bên thứ ba). Chỉ Mai dùng.

**Giai đoạn 2 — Ingest chat (3–4 tuần)**
Bot họp online qua dịch vụ meeting-bot; bot 1:1 WhatsApp/Zalo để forward; thử nghiệm ingest 1–2 group (Telegram hoặc tài khoản Zalo phụ) có sự đồng ý; tóm tắt cuối ngày; waiting-on & follow-up.

**Giai đoạn 3 — Team (4–6 tuần)**
Tài khoản cho cộng sự, phân quyền RLS, giao việc chéo, assistant riêng mỗi người, weekly review theo dự án.

**Giai đoạn 4 — Tùy chọn**
Đóng gói thành sản phẩm cho SME Việt Nam/Thái Lan (xem mục 11).

## 11. Rủi ro & câu hỏi mở

| Rủi ro | Giảm thiểu |
|---|---|
| Dự án này thành thêm một dự án ngốn thời gian | Timebox cứng; chỉ build giai đoạn 1 rồi dùng 2 tuần trước khi đi tiếp |
| Phân loại sai dự án/category làm file lộn xộn | Ngưỡng tin cậy + hỏi một chạm + học từ sửa đổi; báo cáo tỷ lệ phải sửa mỗi tuần |
| Trích xuất nhiễu → mất niềm tin → bỏ app | Triage inbox, ngưỡng tin cậy, trích dẫn nguồn |
| Khóa tài khoản Zalo khi dùng thư viện không chính thức | Tài khoản phụ; phương án dự phòng là forward thủ công |
| Rò rỉ việc riêng tư sang cộng sự | Phân quyền ở tầng database, mặc định Riêng tư |
| Agent tự hành động sai (book nhầm, gửi nhầm) | Duyệt trước mọi hành động ra ngoài; log & hoàn tác |
| Người tham dự khó chịu khi bị ghi âm / bot vào họp | Hỏi trước, tên bot rõ ràng, cho phép tắt theo cuộc họp hoặc theo khách hàng |
| STT tiếng Việt/Thái sai tên riêng, thuật ngữ | Từ điển riêng (tên người, dự án, khách sạn) đưa vào bước chép lời và soạn recap |

Câu hỏi mở:
- Cộng sự đang dùng công cụ gì? Họ có sẵn sàng cài app mới không, hay chỉ tương tác qua Zalo?
- Có group nào có thể chuyển sang Telegram/Lark không?
- Dữ liệu tài chính/pháp lý có được phép đi qua LLM API không, hay cần tách?

## 12. Góc nhìn sản phẩm (tùy chọn)

Một Mai Lowtechie phiên bản thương mại, "chief of staff AI hiểu Zalo, nói tiếng Việt/Thái" cho chủ doanh nghiệp nhỏ ở Đông Nam Á là khoảng trống thật — và phù hợp với dịch vụ intelligent automation của The Circle Technology. Nhưng chỉ nên nghĩ đến sau khi bản cá nhân chứng minh được giá trị với chính Mai.
