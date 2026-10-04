# บ้านของเรา: Build & Harvest (เวอร์ชันเว็บ)

เกม 3D สไตล์ PS1 เล่นผ่านเบราว์เซอร์บนคอมพิวเตอร์ ไม่ต้องติดตั้งเกม

สถานะตอนนี้: **โครงต้นแบบ** เดินสำรวจรอบบ้านเก่าและแปลงผักได้ กด E หน้าประตูเพื่อดูบ้านก่อน/หลังซ่อม บันทึกและโหลดในเบราว์เซอร์พร้อมตรวจเซฟเสียแล้ว
ระบบปลูก เก็บของ เปลี่ยนวัน บทสนทนา และทางเลือกตอนจบ อยู่ใน [แผนบทที่ 1](docs/PLAN-chapter1.md)

## เทคโนโลยีที่ใช้ และเหตุผล

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | TypeScript | จับค่าผิดประเภทตั้งแต่ตอนเขียน สำคัญกับระบบเซฟ |
| 3D | Three.js | เบา เปิดในเบราว์เซอร์ได้ทันที คุมการเรนเดอร์เองได้ละเอียดพอจะทำลุค PS1 (ความละเอียดต่ำ, จุดยอดสั่น, พื้นผิวพิกเซล) |
| เครื่องมือ build | Vite | เปิดเครื่องพัฒนาเร็ว ได้ไฟล์ static ไปวางโฮสต์ไหนก็ได้ |
| ทดสอบ | Vitest + Playwright | ทดสอบระบบเซฟแบบหน่วย และเปิดเกมจริงในเบราว์เซอร์อัตโนมัติ |
| ฟอนต์ไทย | Noto Sans Thai (ฝังมากับเกม) | อ่านง่าย ใช้ได้ฟรี (OFL) ไม่ต้องโหลดจากเน็ต |

ไม่ใช้ Unity/Godot เพราะเป้าหมายคือเว็บ ไฟล์เกมของสองตัวนั้นใหญ่และเริ่มช้ากว่ามากในเบราว์เซอร์

## ติดตั้งโปรแกรมบนเครื่องของคุณ (ครั้งแรกครั้งเดียว)

ต้องมีแค่ **Git** และ **Node.js 22 LTS ขึ้นไป** (ใช้ฟรีทั้งคู่)

### Windows 10/11
เปิด PowerShell แล้วพิมพ์:
```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```
ปิดแล้วเปิด PowerShell ใหม่ ตรวจว่าติดตั้งแล้ว:
```powershell
git --version
node --version   # ต้องได้ v22.12 ขึ้นไป
```
(ถ้าไม่มี winget ให้ดาวน์โหลดตัวติดตั้งจาก https://git-scm.com และ https://nodejs.org เลือก LTS)

### macOS
เปิด Terminal แล้วพิมพ์:
```bash
xcode-select --install          # ได้ git มาด้วย (ถ้ามีอยู่แล้วจะแจ้งว่าติดตั้งแล้ว)
```
จากนั้นดาวน์โหลด Node.js LTS ตัวติดตั้ง `.pkg` จาก https://nodejs.org แล้วตรวจ:
```bash
git --version
node --version   # ต้องได้ v22.12 ขึ้นไป
```

## เปิดเกมในเครื่อง

```bash
git clone https://github.com/Wewiiz/Wewiiz.git
cd Wewiiz
git checkout claude/project-thread-e48hj5   # จนกว่า PR จะ merge
cd game
npm ci          # ติดตั้ง library ตาม package-lock.json (ครั้งแรก หรือเมื่อ dependencies เปลี่ยน)
npm run dev     # เปิด http://localhost:5173 ในเบราว์เซอร์
```

## คำสั่งอื่น

```bash
npm test             # ทดสอบระบบเซฟ (Vitest)
npm run typecheck    # ตรวจชนิดข้อมูล TypeScript
npm run build        # สร้างเกมพร้อมขึ้นโฮสต์ไว้ที่ game/dist/
npm run preview      # เปิดดูไฟล์ที่ build แล้ว http://localhost:4173
npm run smoke        # เปิดเกมจริงใน Chromium อัตโนมัติ: เริ่มเกม เดิน บันทึก เปิดใหม่ โหลด เซฟเสีย (ต้อง build ก่อน)
```
`npm run smoke` ใช้ Chromium ของ Playwright ครั้งแรกบนเครื่องคุณให้รัน `npx playwright install chromium` ก่อน (ดาวน์โหลดประมาณ 150 MB)

## วิธีนำขึ้นโฮสต์

`npm run build` จะได้โฟลเดอร์ `game/dist/` ที่เป็นไฟล์ static ล้วน (HTML/JS/CSS/ฟอนต์) ตั้งค่า path แบบ relative ไว้แล้ว จึงวางได้ทุกที่ที่เสิร์ฟไฟล์ static เช่น
- GitHub Pages, Netlify, Cloudflare Pages (มีแพ็กเกจฟรี)
- itch.io (บีบ `dist/` เป็น zip แล้วอัปโหลดแบบ HTML game)
- เว็บโฮสต์ทั่วไป อัปโหลดเนื้อหาใน `dist/` ขึ้นไปทั้งหมด

ยังไม่ได้นำขึ้นโฮสต์สาธารณะ จะทำเมื่อเจ้าของโปรเจกต์อนุมัติ

## โครงสร้าง

```
game/
  index.html            หน้าเกม
  src/main.ts           วนลูปเกม, ปุ่มควบคุม, HUD, บันทึก/โหลด
  src/render/ps1.ts     ตัวเรนเดอร์ความละเอียดต่ำ + material จุดยอดสั่นแบบ PS1 (ใช้ร่วมกัน)
  src/render/textures.ts  พื้นผิวพิกเซลวาดด้วยโค้ด ใช้ร่วมกันทุก mesh
  src/game/world.ts     ฉาก: บ้านเก่า/บ้านซ่อมแล้ว, แปลงผัก, ต้นไม้, ตัวละคร
  src/save/schema.ts    รูปแบบเซฟ + ตัวตรวจ (แยก story / inventory / world)
  src/save/storage.ts   อ่าน/เขียน localStorage, ไม่เขียนทับเซฟเสียโดยไม่ยืนยัน
  tests/save.test.ts    เทสต์ระบบเซฟ
  scripts/smoke.mjs     เทสต์เปิดเกมจริงในเบราว์เซอร์
  docs/                 แผนบทที่ 1, ผลทดสอบ, แหล่งที่มาและสิทธิ์ใช้งาน
```
