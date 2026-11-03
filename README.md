# Phòng học TOEIC 3D

Web app học nhóm (nhóm kín, vào bằng mã phòng / link mời) trong một map 3D có 3 khu:

| Khu | Làm gì |
|---|---|
| **Thư viện** | Đến bàn trống để ngồi (vòng xanh = trống). Ngồi xong, bảng ôn tập mở ra: chọn Part 5/6/7, làm từng câu rồi xem đáp án, giải thích, bản dịch. Có Pomodoro chung 25/5 và nút gật đầu. Giờ ngồi bàn được tính vào thống kê. |
| **Khu thư giãn** | Chat chữ (kênh chung + kênh theo khu) và voice theo khoảng cách: đứng gần thì nghe rõ, xa thì nhỏ dần, quá 14 m thì ngắt. Mic mặc định tắt. |
| **Phòng thi** | Thi cá nhân ~15 câu theo Part tự chọn, hoặc phòng thi chung (đăng ký trước, đến giờ cùng làm một đề, có bảng xếp hạng). Đếm ngược, hết giờ tự nộp, sau đó xem lại từng câu kèm giải thích. Lịch sử cho thấy Part hay sai. |

Tài khoản không cần email/mật khẩu: tên hiển thị + **mã khôi phục**. Có bạn bè (kết bạn bằng mã), thống kê theo ngày/chuỗi/tổng và bảng xếp hạng tuần (giờ học, điểm thi).

## Cài đặt trên máy mới

Repo **không chứa dữ liệu đề**. `data/`, `certs/`, `assets-src/` đều bị `.gitignore`. Clone về chạy được ngay, nhưng phần ôn tập và thi sẽ trống cho tới khi có `data/bank/`.

Cấu hình nằm trong file `.env` ở gốc repo (không đưa lên git). File mẫu là `.env.example`.

### Bước 1: Cài Node

Cần **Node ≥ 22.13**, vì app dùng `node:sqlite` có sẵn trong Node nên không phải cài DB.

```bash
node -v
```

### Bước 2: Clone và cài package

```bash
git clone https://github.com/Tuan-Quyen/GiaoLuuTiengAnh.git
```

```bash
cd GiaoLuuTiengAnh
```

```bash
npm install
```

### Bước 3: Tạo file `.env`

```bash
# macOS / Linux / Git Bash:
cp .env.example .env

# Windows (PowerShell / CMD):
copy .env.example .env
```

Mở `.env` và sửa **`TOEIC_VAULT`** thành đường dẫn vault trên máy này (chỉ cần nếu lấy đề theo Cách B ở bước 4). Các biến còn lại để nguyên là chạy được. Ý nghĩa từng biến xem [Biến môi trường](#biến-môi-trường).

### Bước 4: Lấy dữ liệu đề (chọn một cách)

**Cách A: chép từ máy đang chạy (nhanh nhất).** Chép hai thư mục sau sang cùng vị trí trên máy mới:

```
data/
├── bank/    đề đã import (*.json)
└── media/   ảnh đoạn văn Part 6/7
```

Không chép `app.db` nếu muốn DB mới trống, vì DB tự tạo khi server chạy lần đầu. Muốn mang theo tài khoản và thống kê thì **tắt server trước**, rồi chép đủ cả `app.db`, `app.db-wal`, `app.db-shm`.

**Cách B: import từ vault TOEIC.** Chép vault Markdown sang máy mới, đặt `TOEIC_VAULT` trong `.env` rồi chạy:

```bash
npm run import
```

Hoặc chỉ định thẳng: `npm run import -- --path /đường/dẫn/tới/TOEIC`. Nếu không đặt cả hai, import sẽ dùng đường dẫn của máy gốc và báo lỗi.

Kiểm tra: `ls data/bank` phải thấy các file `*.json`.

### Bước 5: Chạy (Chế độ Dev)

```bash
npm run dev
```
*(Trên Windows PowerShell nếu muốn chạy HTTPS dev: `$env:HTTPS=1; npm run dev`)*

Mở http://localhost:5173 → tạo hồ sơ → **Tạo phòng mới** → bấm **Mời** để chép link gửi bạn.

Cổng 3001 (server) và 5173 (Vite) phải còn trống. Nếu 3001 bị chiếm thì đổi `PORT` trong `.env` (Vite tự proxy theo).

### Bước 6 (tuỳ chọn): Cho máy khác hoặc điện thoại trong LAN vào

Micro chỉ dùng được trên HTTPS (trừ `localhost`). Có hai cách:

| Cách | Lệnh | Mở ở |
|---|---|---|
| Dev nhanh | đặt `HTTPS=1` trong `.env`, `npm run dev` | `https://<IP-máy>:5173` |
| Docker ổn định | xem [Chạy trong LAN bằng docker](#chạy-trong-lan-bằng-rancher-desktop-docker) | `https://<IP-máy>:3443` |

Không chép `certs/` từ máy cũ sang, vì cert gắn với IP của máy cũ. Hãy tạo lại bằng `.\scripts\make-cert.ps1` (Windows) hoặc `./scripts/make-cert.sh` (macOS/Linux).

### Mẹo khi dùng

- **Thử 2 người trên một máy**: mở thêm một tab với `&profile=b` ở cuối URL (mỗi profile giữ phiên đăng nhập riêng), hoặc dùng cửa sổ ẩn danh.
- **Điều khiển**: WASD/mũi tên để đi, Shift để chạy, kéo chuột để xoay camera, lăn chuột để zoom; `E` ngồi/đứng/vào phòng thi, `N` gật đầu, `Enter` để chat. Trên điện thoại dùng joystick ảo, kéo một ngón để xoay camera, chụm hai ngón để zoom.
- **Mở từ điện thoại trong cùng mạng LAN**: trình duyệt chỉ cho dùng micro trên HTTPS, nên chạy `HTTPS=1 npm run dev` rồi mở `https://<IP-máy>:5173` (chấp nhận chứng chỉ tự ký).

### Bản production

```bash
npm run build
```

```bash
npm start
```

Server phục vụ cả client tại http://localhost:3001 (đổi bằng `PORT`). Đặt sau reverse proxy có HTTPS để dùng micro.

### Biến môi trường

Server, `npm run import`, `smoke`, `bots` và Vite đều tự nạp `.env` ở gốc repo (`server/src/env.ts`). Thứ tự ưu tiên:

```
bien trong shell  >  .env  >  mac dinh trong code
```

Để trống một biến trong `.env` nghĩa là dùng mặc định. Docker **không** đọc `.env`: biến cho container đặt trong `docker-compose.yml`.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3001` | Cổng server; Vite dev proxy về cổng này |
| `HOST` | `0.0.0.0` | Địa chỉ listen |
| `APP_TZ` | `Asia/Ho_Chi_Minh` | Múi giờ tính "hôm nay", chuỗi ngày, tuần |
| `DATA_DIR` | `./data` | Nơi chứa `bank/`, `media/`, `app.db` |
| `DB_PATH` | `$DATA_DIR/app.db` | File SQLite |
| `TOEIC_VAULT` | vault trên máy gốc | Nguồn đề cho `npm run import` |
| `HTTPS` | (tắt) | `1` = Vite dev chạy HTTPS tự ký |
| `TLS_CERT`, `TLS_KEY` | (trống) | Có cả hai thì server chạy HTTPS |
| `ICE_SERVERS` | STUN Google | JSON ICE server; thêm TURN cho NAT chặt |
| `EXAM_TIME_SCALE` | `1` | Nhân thời gian thi (`0.01` để test) |
| `BASE` | `localhost:$PORT` | Server cho `smoke` / `bots` |

### Chạy trong LAN bằng Rancher Desktop (docker)

Trình duyệt chỉ cho phép dùng micro trên HTTPS (trừ `localhost`), nên bản chạy LAN sử dụng HTTPS với chứng chỉ tự ký (self-signed cert).

#### 1. Chuẩn bị đề thi
Docker chỉ cần thư mục `data/bank/` và `data/media/` có sẵn trên máy host (xem [Bước 4](#bước-4-lấy-dữ-liệu-đề-chọn-một-cách)). Nếu có vault TOEIC thì chạy:
```bash
npm run import
```

#### 2. Tạo chứng chỉ SSL
Chạy script tạo chứng chỉ tự ký (script tự động nhận diện IP LAN của máy trên Windows, macOS và Linux):

- **Trên Windows PowerShell**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\make-cert.ps1
  ```
- **Trên macOS / Linux / Git Bash**:
  ```bash
  ./scripts/make-cert.sh
  ```
*(Nếu muốn chỉ định thủ công IP LAN: `.\scripts\make-cert.ps1 192.168.1.10` hoặc `./scripts/make-cert.sh 192.168.1.10`)*.

#### 3. Khởi động Docker
```bash
docker compose up -d --build
```

#### 4. Truy cập trên trình duyệt
- **Trên máy tính hiện tại**: Mở **`https://localhost:3443`** *(BẮT BUỘC gõ rõ `https://`, nếu gõ `http://` trình duyệt sẽ ngắt kết nối)*.
- **Bỏ qua cảnh báo chứng chỉ**: Trình duyệt sẽ hiện cảnh báo bảo mật do cert tự ký. Bấm **Nâng cao (Advanced)** → **Tiếp tục truy cập (Proceed)**. *(Mẹo Chrome: click vào khoảng trống trang cảnh báo rồi gõ phím `thisisunsafe` nếu không thấy nút tiếp tục)*.

#### 5. Cấu hình mở cho điện thoại / thiết bị khác trong LAN (Windows)
Trên Windows, Rancher Desktop (hoặc Docker chạy qua WSL2) mặc định chỉ chuyển tiếp cổng vào loopback `127.0.0.1:3443`, các máy khác trong mạng WiFi chưa kết nối được ngay. Để mở cho điện thoại/máy khác:

1. Mở **PowerShell bằng quyền Administrator** (Run as Administrator).
2. Chạy 2 lệnh sau để Windows chuyển tiếp cổng 3443 từ card mạng LAN vào localhost và mở Firewall:
   ```powershell
   # Lưu ý: listenaddress phải là IP LAN của máy (ví dụ 192.168.1.12), không dùng 0.0.0.0 để tránh bị lặp cổng
netsh interface portproxy add v4tov4 listenaddress=<IP-LAN> listenport=3443 connectaddress=127.0.0.1 connectport=3443
   netsh advfirewall firewall add rule name="TOEIC 3D HTTPS" dir=in action=allow protocol=TCP localport=3443
   ```
3. Từ điện thoại hoặc máy khác trong cùng WiFi, truy cập: **`https://<IP-LAN>:3443`** (ví dụ `https://192.168.1.12:3443`).

#### 6. Lưu ý khi khởi động lại máy tính (Reset máy)
- **Container tự bật lại**: Cấu hình `restart: unless-stopped` đảm bảo chỉ cần bạn mở Rancher Desktop lên là web server tự chạy, không cần gõ lại lệnh `docker compose up`.
- **Dữ liệu an toàn**: Tài khoản và thống kê lưu trong Docker volume `toeic3d-db`, đề thi mount trực tiếp từ máy host, hoàn toàn không bị mất khi reset máy.
- **Đổi mạng WiFi**: Khi máy tính đổi sang mạng WiFi khác (IP LAN của máy thay đổi), chứng chỉ cũ sẽ không khớp với IP mới. Chỉ cần chạy lại script tạo cert rồi restart container:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\make-cert.ps1
  docker compose restart
  ```

- Đề (`data/bank`) và ảnh (`data/media`) mount chỉ-đọc từ máy host. Sau `npm run import` thì `docker compose restart` (theo dõi file qua mount của VM không chắc nhận được thay đổi).
- DB nằm trong volume `toeic3d-db`, không mất khi build lại image. Xoá hẳn: `docker compose down -v`.
- Đồng hồ trong VM của Rancher có thể lệch vài trăm ms so với máy host; giờ thi chung luôn tính theo đồng hồ server.
- Test qua LAN mà không đụng DB thật: chạy thêm một container cổng khác với `DB_PATH=/tmp/app.db -e EXAM_TIME_SCALE=0.01`, rồi `BASE=https://<IP>:<cổng> NODE_EXTRA_CA_CERTS=certs/cert.pem npm run smoke`.

## Import lại đề

```bash
npm run import
```

Đọc vault (mặc định `/Users/ctquyen/Documents/project/self-project/core/private-storage/TOEIC`, đổi bằng `--path` hoặc `TOEIC_VAULT`), **chỉ đọc**, ghi ra `data/bank/<đề>.json` và copy ảnh đoạn văn vào `data/media/`. Server đang chạy sẽ **tự nạp lại** khi `data/bank/` thay đổi, không cần khởi động lại.

```bash
npm run import -- --path /đường/dẫn/TOEIC
```

```bash
npm run import -- --only ETS_2026_Test_1
```

```bash
npm run import -- --strict
```

`--strict` trả mã lỗi nếu có cảnh báo (dùng cho CI). Lần import hiện tại cho 16 đề, 1.595 câu Reading, kèm 2 cảnh báo do **dữ liệu nguồn** (không phải lỗi parser):

- `ETS_2026_Test_6` câu 143–146: file nguồn ghi "Đoạn văn gốc không có sẵn" → bỏ cả nhóm (không có đoạn văn thì không làm được).
- `Hacker_3_Test_7` câu 167: phương án A trong nguồn bị lỗi mà lại là đáp án đúng → bỏ câu này.

### Parser xử lý những gì

Định dạng thực tế có 2 biến thể, parser xử lý cả hai và tự kiểm tra:

| | ETS | Hacker |
|---|---|---|
| Phương án | `- A. text` | `- (A) text` |
| Đoạn văn Part 6/7 | ảnh `images/part7_q147-148.png` (có thể nhiều ảnh) | code block, hoặc chữ thường trước dòng "Dịch nghĩa" |
| Đáp án | phương án in đậm + dòng `**Đáp án đúng: X**` | như ETS |

- Câu Part 6/7 được nhóm theo heading `### Câu 147-148`; mỗi nhóm giữ nguyên thứ tự câu.
- Giải thích lấy từ `explain/explaination.md`, bản dịch câu từ `vi/translate.md`, bản dịch đoạn văn lấy từ phần "Dịch nghĩa" trong file đề chính.
- Kiểm tra lúc import: đủ 4 phương án, đáp án khớp phương án in đậm, số câu khớp heading, có giải thích/bản dịch, và **không có dấu hiệu lộ đáp án** trong nội dung gửi cho client. (Đã bắt được một trường hợp thật: nguồn đánh dấu đáp án bằng `***` ở cuối phương án.)
- Listening (Part 1–4) chưa import, nhưng kiểu dữ liệu đã có chỗ (`Group.audio`), và `--parts 1,2,3,4` sẽ dùng cùng parser khi thêm.

### Đổi bộ đề

Nguồn đề là một lớp riêng (`server/src/bank/sources/`). Phần còn lại của app chỉ đọc `data/bank/*.json`.

```
server/src/bank/
├── sources/
│   ├── types.ts          QuestionSource { listTests, loadTest }
│   ├── vaultMarkdown.ts  nguồn hiện tại (vault Markdown)
│   └── index.ts          đăng ký nguồn → thêm nguồn mới ở đây
├── import.ts             npm run import --source <tên>
└── bank.ts               QuestionBank runtime (chọn đề, ẩn đáp án)
```

## Kiến trúc

```
Browser (Three.js + DOM UI)          Node server (1 process)
  │                                    │
  ├─ REST /api ──────────────────────▶ Express ── SQLite (node:sqlite)
  │   auth, ôn tập, thi, thống kê      │            users, rooms, friends,
  │                                    │            study_daily, answer_log,
  ├─ Socket.IO ──────────────────────▶ realtime.ts  exam_attempts, shared_exams
  │   move 10Hz, ghế, chat, emote,     │   trạng thái phòng trong RAM,
  │   tín hiệu WebRTC                  │   gom vị trí → "snap" 10Hz
  │                                    │
  └─ WebRTC audio P2P ◀──────────────▶ người chơi gần nhau (tối đa 8)
```

```
├── shared/           kiểu dữ liệu + map + giao thức dùng chung client/server
├── server/src/       Express + Socket.IO + SQLite, chấm thi
├── client/src/       Three.js (game/), UI DOM (ui/), voice.ts
├── client/public/models/   nhân vật KayKit đã lọc gọn
├── scripts/          smoke test, bot thử tải, lọc model
└── data/             (sinh ra) bank/, media/, app.db
```

### Vì sao chọn stack này

- **Three.js thuần + DOM, không React**: cảnh 3D là phần nặng nhất; UI chỉ là vài bảng. Không thêm framework giúp bundle gọn và dễ kiểm soát hiệu năng trên điện thoại. Mọi khối hộp cùng vật liệu gom thành `InstancedMesh` nên cả map chỉ vài chục draw call.
- **Socket.IO**: tự nối lại, có room, ack, `volatile` cho gói vị trí (mất thì bỏ, không xếp hàng). Với 20–30 người/phòng, một process Node là đủ: thử 30 người di chuyển liên tục, mỗi client nhận ~12 KB/s, client desktop render ~3 ms/frame.
- **WebRTC P2P cho voice, không qua media server**: nhóm nhỏ, chỉ người đứng gần mới nối nhau (tối đa 8 kết nối mỗi người) nên không cần SFU. Âm lượng chỉnh bằng Web Audio `GainNode` (iOS không cho chỉnh `audio.volume`).
- **SQLite (`node:sqlite`)**: không cần cài DB, không cần build native module, đủ cho nhóm kín.
- **Chấm thi ở server**: client chỉ nhận đề không có đáp án/giải thích/bản dịch (bản dịch có thể lộ đáp án). Đáp án được lưu dần lên server; server có timer riêng tự nộp nếu client mất kết nối lúc hết giờ.
- **TypeScript chạy bằng `tsx`**: server và client dùng chung `shared/` (map, giao thức, kiểu đề) nên va chạm, khu và ghế được tính giống nhau ở cả hai phía.

## Kiểm thử

```bash
EXAM_TIME_SCALE=0.01 npm run dev
```

```bash
npm run smoke
```

`smoke` chạy 20 kiểm tra đầu-cuối qua API + socket: hai người thấy nhau di chuyển, ghế đã có người, chat, ôn Part 5 có giải thích + bản dịch, thi Part 7 không lộ đáp án và câu cùng đoạn văn đi liền nhau, server tự nộp khi hết giờ, phòng thi chung cùng đề + bảng xếp hạng, thống kê, bạn bè. Server test riêng: `BASE=http://localhost:3099 npm run smoke`.

Thử tải với 28 người giả lập đi lại trong một phòng có sẵn:

```bash
npm run bots -- MÃPHÒNG 28 60
```

## Asset & bản quyền

- Nhân vật: **KayKit Adventurers Character Pack 1.0** của Kay Lousberg, giấy phép **CC0** (`client/public/models/KAYKIT_LICENSE.txt`). Model đã được `npm run slim-models` lọc: chỉ giữ 8 animation dùng tới, bỏ vũ khí. Muốn chạy lại bước lọc, tải bản gốc từ [repo KayKit](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0) vào `assets-src/kaykit/`.
- Map, đồ vật, UI: tự dựng bằng khối hình học, không dùng code/asset của ngoike.online (chỉ tham khảo trải nghiệm).
- Nội dung đề nằm ngoài repo (vault riêng); `data/` đã được `.gitignore`.

## Giới hạn đã biết

- Trạng thái phòng (vị trí, ghế, chat gần đây) nằm trong RAM của một process: khởi động lại server thì mất lịch sử chat, mọi người tự vào lại. Muốn chạy nhiều process cần Redis adapter cho Socket.IO.
- Voice P2P chỉ dùng STUN; mạng NAT chặt (4G, mạng công ty) có thể cần TURN server (`ICE_SERVERS`).
- `/media` (ảnh đoạn văn) không yêu cầu đăng nhập; ai biết đường dẫn ảnh thì xem được. Ảnh không chứa đáp án.
- Giờ học chỉ tính khi ngồi bàn thư viện, cộng dồn mỗi 30 giây.
