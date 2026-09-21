import type { Destination } from "./types";

/**
 * Mẫu checklist bay (PRD §5.9) — chuyển từ nguyên mẫu
 * docs/prototypes/checklist-bay.html. Món có `destinations` chỉ hiện
 * cho điểm đến đó; món Mai tự thêm nằm trong Trip.customItems.
 */

export interface ChecklistItem {
  id: string;
  title: string;
  hint?: string;
  destinations?: Destination[];
}

export interface ChecklistGroup {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export type ChecklistTab = "pack" | "todo";

function group(
  id: string,
  title: string,
  rows: [string, string?, Destination[]?][],
): ChecklistGroup {
  return {
    id,
    title,
    items: rows.map(([t, hint, destinations], i) => ({
      id: `${id}::${i}`,
      title: t,
      hint: hint || undefined,
      destinations,
    })),
  };
}

export const PACK_GROUPS: ChecklistGroup[] = [
  group("docs", "Giấy tờ", [
    ["Hộ chiếu", "Còn hạn ít nhất 6 tháng"],
    ["Vé máy bay / boarding pass trên điện thoại"],
    ["Visa hoặc giấy tờ nhập cảnh nếu cần"],
    ["Ảnh chụp hộ chiếu lưu trong điện thoại"],
    ["Địa chỉ khách sạn / nơi ở", "Bản tiếng địa phương để đưa tài xế"],
    ["Bảo hiểm du lịch"],
    ["Danh thiếp", "Nếu có gặp khách, đối tác"],
    ["Visit Japan Web (mã QR nhập cảnh + hải quan)", "", ["tokyo"]],
    ["Mã QR TDAC", "Nếu áp dụng cho quốc tịch của Mai", ["bkk"]],
  ]),
  group("tech", "Công nghệ & làm việc", [
    ["Laptop + sạc"],
    ["Điện thoại + sạc + cáp"],
    ["Pin dự phòng", "Để hành lý xách tay, không ký gửi"],
    ["Tai nghe chống ồn"],
    ["Ổ cắm chuyển đổi đa năng"],
    ["eSIM / SIM data đã kích hoạt"],
    ["Tài liệu, slide đã tải offline", "Pitch deck, proposal bản PDF"],
    ["Sổ + bút", "Điền tờ khai, ghi chú"],
    ["Thẻ IC (Suica/Pasmo) trên điện thoại", "", ["tokyo"]],
  ]),
  group("money", "Tiền & thẻ", [
    ["Thẻ tín dụng + thẻ dự phòng để riêng"],
    ["Tiền mặt yên", "Nhiều nơi ở Nhật vẫn chỉ nhận tiền mặt", ["tokyo"]],
    ["Tiền mặt đồng", "", ["hcmc"]],
    ["Tiền mặt baht cho taxi/xe từ sân bay", "", ["bkk"]],
  ]),
  group("beauty", "Làm đẹp & cá nhân", [
    ["Túi zip trong suốt cho chất lỏng xách tay", "Mỗi chai tối đa 100ml"],
    ["Skincare: sữa rửa mặt, toner, kem dưỡng"],
    ["Kem chống nắng"],
    ["Đồ make up"],
    ["Xịt khoáng + son dưỡng + mặt nạ", "Máy bay rất khô"],
    ["Bàn chải, kem đánh răng"],
    ["Dây buộc tóc, lược"],
  ]),
  group("clothes", "Quần áo", [
    ["Áo khoác mỏng / khăn choàng mặc trên máy bay"],
    ["Quần áo theo thời tiết nơi đến", "Xem dự báo 3 ngày trước"],
    ["Một bộ đi gặp khách"],
    ["Đồ ngủ"],
    ["Giày đi bộ thoải mái", "Ở Tokyo đi bộ nhiều", ["tokyo"]],
    ["Đồ lót, tất"],
  ]),
  group("health", "Sức khỏe & trên máy bay", [
    ["Thuốc cá nhân", "Để hành lý xách tay"],
    ["Thuốc đau đầu, đau bụng, say xe"],
    ["Gối cổ + bịt mắt"],
    ["Bình nước rỗng", "Đổ đầy sau khi qua an ninh"],
    ["Khẩu trang, nước rửa tay"],
  ]),
];

export const TODO_GROUPS: ChecklistGroup[] = [
  group("w1", "1 tuần trước", [
    ["Kiểm tra hạn hộ chiếu và yêu cầu nhập cảnh"],
    ["Đặt khách sạn / nơi ở"],
    ["Mua bảo hiểm du lịch"],
    ["Mua eSIM"],
    ["Báo cộng sự lịch vắng, chặn lịch trên Google Calendar"],
    ["Dời hoặc chuyển sang online các cuộc họp trùng ngày bay"],
    ["Đặt lịch spa / làm tóc nếu muốn trước chuyến"],
  ]),
  group("d3", "3 ngày trước", [
    ["Điền Visit Japan Web", "", ["tokyo"]],
    [
      "Nộp TDAC (trong vòng 3 ngày trước khi đến)",
      "Nếu áp dụng; chỉ dùng trang chính thức tdac.immigration.go.th, miễn phí",
      ["bkk"],
    ],
    ["Xem dự báo thời tiết nơi đến"],
    ["Giặt đồ cần mang"],
    ["Đổi tiền mặt"],
    ["Tải bản đồ offline + tài liệu làm việc"],
    ["Check-in online khi mở, chọn chỗ ngồi"],
  ]),
  group("n0", "Tối hôm trước", [
    ["Sạc laptop, điện thoại, pin dự phòng, tai nghe"],
    ["Xếp hành lý theo checklist đồ mang theo"],
    ["Cân hành lý"],
    ["Kiểm tra lại giờ bay, nhà ga"],
    [
      "Tính giờ đi sân bay, đặt báo thức",
      "Chuẩn bị 1 tiếng 30 + di chuyển + có mặt trước 2 tiếng 30",
    ],
    ["Đặt xe ra sân bay nếu cần"],
    ["Thanh toán các hóa đơn sắp đến hạn"],
    ["Bật trả lời tự động email nếu đi dài ngày"],
  ]),
  group("day", "Sáng ngày bay", [
    ["Kiểm tra lần cuối: hộ chiếu, điện thoại, ví"],
    ["Kiểm tra chuyến bay có đổi giờ không"],
    ["Tắt điện, bình nóng lạnh, điều hòa"],
    ["Đổ rác, tưới cây"],
    ["Khóa cửa"],
  ]),
  group("air", "Ở sân bay", [
    ["Có mặt trước giờ bay 2 tiếng 30", "Bay quốc tế"],
    ["Ký gửi hành lý, lấy thẻ lên máy bay"],
    ["Đổ đầy bình nước sau an ninh"],
    ["Nhắn cho người đón / cộng sự giờ đến"],
  ]),
];

export const DESTINATION_LABELS: Record<Destination, string> = {
  tokyo: "Tokyo",
  hcmc: "HCMC",
  bkk: "Về Bangkok",
};

/** Lọc các nhóm theo tab + điểm đến (giữ id ổn định để lưu tick). */
export function groupsFor(tab: ChecklistTab, dest: Destination): ChecklistGroup[] {
  const src = tab === "pack" ? PACK_GROUPS : TODO_GROUPS;
  return src.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.destinations || it.destinations.includes(dest)),
  }));
}
