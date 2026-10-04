# Wewiiz

เครื่องมือช่วยทำคอนเทนต์ TikTok งานก่อสร้าง/งานช่าง ลงพื้นที่ 1-3 ครั้งต่อเดือน แต่ได้คลิปพอโพสต์ทั้งเดือน

## ตัววางแผนคลิป (`content_planner`)

ใส่ไอเดียคลิปทั้งเดือนในไฟล์ JSON ไฟล์เดียว แล้วได้:

- **plan-YYYY-MM.md** shot list รวมต่อการลงพื้นที่ (ติ๊กเช็กที่หน้างาน ถ่ายครั้งเดียวได้หลายคลิป), รายละเอียดแต่ละคลิป และตารางโพสต์
- **schedule-YYYY-MM.csv** ตารางโพสต์ เปิดใน Excel/Google Sheets ได้ (ภาษาไทยไม่เพี้ยน)

ตัวตรวจจะไม่ยอมผ่านถ้าคลิปไหนขาด hook 3 วินาทีแรก, shot list, แคปชั่น หรือแฮชแท็ก, ยาวไม่อยู่ใน 15-60 วินาที หรือลงพื้นที่เกิน 3 ครั้ง
คลิปจะถูกจัดลงวันโพสต์หลังวันถ่าย + เวลาตัดต่อ (`edit_days`) เสมอ

```bash
python3 -m content_planner examples/ideas-2026-11.json -o /mnt/project-files/content/
python3 -m content_planner examples/ideas-2026-11.json --check   # ตรวจอย่างเดียว
```

ไม่ต้องติดตั้งอะไรเพิ่ม ใช้ Python 3.10 ขึ้นไป

### รูปแบบไฟล์ไอเดีย

ดูตัวอย่างเต็มที่ [examples/ideas-2026-11.json](examples/ideas-2026-11.json)

| ช่อง | ความหมาย |
|---|---|
| `month` | เดือนที่โพสต์ เช่น `"2026-11"` |
| `post_days` | วันโพสต์ (`mon` ... `sun`) ค่าเริ่มต้น จ. พ. ศ. ส. |
| `post_time` | เวลาโพสต์ ค่าเริ่มต้น `"19:00"` |
| `edit_days` | จำนวนวันตัดต่อหลังถ่าย ก่อนโพสต์ได้ ค่าเริ่มต้น 1 |
| `default_hashtags` | แฮชแท็กที่ใส่ทุกคลิป |
| `visits[]` | การลงพื้นที่: `id`, `date`, `site` |
| `ideas[]` | คลิป: `id`, `title`, `visit`, `hook` (ข้อความ หรือ `{text, seconds}`), `duration` (วินาที), `shots[]` (ข้อความ หรือ `{desc, type}`), `caption`, `hashtags[]` |

## รันเทสต์

```bash
python3 -m unittest discover -s tests -t .
```
