# ส่งมอบ Student Panels - 30 ตุลาคม 2569

> **Superseded เฉพาะแบนเนอร์:** ใช้ [Student Banner Refinement](20261030-student-banner-refinement.md) เป็นข้อมูลล่าสุด ข้อความด้านล่างเรื่องพื้น identity ทึบ/ภาพจำกัด 180px, contrast 6.31:1 และ verdict 3 fixes เป็น snapshot รุ่นก่อน รุ่นโปร่งใสบนภาพได้ `ship` เฉพาะ 2 fixes ที่ `Resolved` แล้ว ไม่ใช่ whole-surface/WCAG certification; สถานะ QA ล่าสุดอยู่ในเอกสารใหม่

งาน code-led refinement ของหน้านักเรียนเดิมในโหมด Operate ไม่ใช่การเปลี่ยนอัตลักษณ์หรือสร้าง visual world ใหม่ คงงานเช็คชื่อและระบบรางวัลเดิม ไม่มี SQL/migration ใหม่ ไม่เปลี่ยน schema ฐานข้อมูลหรือกติกาธุรกิจ และยังไม่ได้ commit/push

**ผลตรวจล่าสุด:** finish reviewer ให้ `disposition: ship` ใน verdict pass เฉพาะ 3 รายการแก้ไข โดยให้ `resolved` ทั้งหมด: ระยะปุ่มเช็คชื่อเหนือ navigation, ความอ่านง่ายของ identity/ขอบเขตภาพ และเมนูไม่ทับชื่อ จากหลักฐาน synthetic Edge เท่านั้น ไม่ใช่การรับรองทั้งระบบหรือ production ดู [QA และขอบเขตคำตัดสิน](20261030-student-panels-qa.md#review)

## สิ่งที่ผู้ใช้เห็น

- **ร้านค้า:** เปลี่ยนชื่อที่แสดงจาก Magic Shop เป็น **ร้านค้า** ใช้หน้าต่างสีอ่อนกลางจอ ขนาดสูง `min(80dvh, 700px)` และไม่เกิน `100dvh - 32px` ส่วนหัว ยอดเหรียญ และแท็บคงอยู่ เลื่อนเฉพาะรายการสินค้า/ประวัติด้านใน มีพื้นที่แตะปิดด้านนอก ชื่อและรายละเอียดสินค้าตัดบรรทัดได้ อักขระพิเศษแสดงเป็นข้อความจริง ปุ่มแลกของปิดเมื่อเหรียญไม่พอ; Escape ปิดคำถามซื้อชั้นบนก่อนร้านค้า
- **ประวัติเข้าเรียน:** ใช้ Bootstrap utility modal แบบกระชับ แยกจากประวัติแลกของ แสดงสถานะและคะแนนทุกแถวของวันเดียวกันในกลุ่มเดียว เริ่ม 5 วันที่มีข้อมูลล่าสุดตาม `Asia/Bangkok` ไม่ใช่ 5 แถวหรือย้อนหลัง 5 วันปฏิทิน เลื่อนใกล้ท้ายหรือกด “ดูอีก 5 วัน” เพื่อเพิ่ม มีสถานะว่าง กำลังโหลด ครบแล้ว และลองใหม่
- **ข้อมูลนักเรียน:** เอาหัวชื่อแอปที่มองเห็นออก แต่คงหัวข้อสำหรับ screen reader และชื่อ PWA **เช็คชื่อเข้าเรียนครูอี้** / short name **เข้าเรียนครูอี้** ชื่อ เลเวล และเหรียญอยู่ข้าง avatar; ห้อง ภาคเรียน และรหัสนักเรียนเป็นข้อมูลรอง เมนูบัญชี/รีเฟรช/ติดตั้ง/ออกจากระบบย้ายไปแถวท้ายสัตว์เลี้ยงข้างปุ่มรายละเอียด
- **จอเตี้ย:** `@media(max-height:780px)` ลดช่องไฟ ขนาดภาพสัตว์เลี้ยงและความสูง PIN เพื่อให้ปุ่มหลักพ้นเมนูล่างในขนาดที่ตรวจ จอ 320x568 หรือข้อความขยายยังเลื่อนได้ ไม่รับรองว่าทุกอย่างต้องอยู่ใน viewport เดียว

## พฤติกรรมประวัติสำหรับผู้ดูแลโค้ด

`student-history.js` อ่านเฉพาะนักเรียนปัจจุบันด้วย `student_id` ทุก query; ค้น `max(id)` ของคนนั้นเมื่อเปิด แล้วใช้ `id <= ceiling` ตลอดรอบเพื่อกันรายการแทรกใหม่เข้ามาระหว่างไล่หน้า ไม่ใช่ transaction snapshot ของทั้งฐานข้อมูล

อ่านแบบ keyset ครั้งละไม่เกิน 12 แถว เรียง `timestamp DESC, id DESC`; cursor ถัดไปใช้ timestamp ที่น้อยกว่า หรือ timestamp เท่ากันและ id น้อยกว่า เก็บ timestamp ดิบจาก DB พร้อม microseconds/เขตเวลา ไม่แปลงผ่าน `Date.toISOString()` ตัว pager อ่านข้าม chunk จนวันสุดท้ายครบ เก็บแถวของวันถัดไปไว้ใน buffer และกัน id ซ้ำ จึงอาจอ่านหลาย chunk เพื่อให้ได้ 5 วันครบจริง

เมื่อโหลดพลาดจะไม่ทิ้งแถวที่อ่านค้างไว้และไม่บันทึกวันเป็นสำเร็จก่อนครบ จึง retry ต่อได้ ป้องกันโหลดซ้อน มี timeout 15 วินาที ใช้ `AbortController` และตรวจ identity ก่อนแสดงผล ปิด modal หรือ reset/เปลี่ยนบัญชียกเลิกรอบเดิม; response ที่มาช้าไม่เปิดหน้าต่างกลับมา Guest ใช้ข้อมูลจำลองใน session เส้นทางอ่านประวัติของครู/รายงานไม่ถูกแทนที่

## ธีม ภาพ และความอ่านง่าย

- เพิ่ม generated pet banners 21 ภาพและ rank overlays 4 ภาพใน `assets/student-banners/` ระดับตกแต่งเป็น 0/10/20/30/40: ต่ำกว่า 10 ไม่มี overlay, ตั้งแต่ 40 ใช้แบบสูงสุด ไม่เกี่ยวกับวิวัฒนาการสัตว์เลี้ยงเดิมซึ่งยังเริ่มที่ 0/16/31 และไม่เปลี่ยนคะแนน XP เหรียญ สิทธิ์เลือก/เปลี่ยนชื่อ หรือการแลกของ
- พื้นหน้าจอจริงเปลี่ยนตามสี pet และ rank ผ่าน `--student-page-bg`; accent ใช้สี pet ที่ปรับให้เข้มขึ้น หากยังไม่มี pet ซ่อนภาพ pet banner และใช้ธีมสำรอง ไม่สร้างสัตว์เลี้ยงหรือข้อมูลสมมติให้ผู้ใช้
- runtime ขอเฉพาะ WebP ของ pet และ rank ที่กำลังแสดง ไม่ preload ทั้งชุดและไม่โหลด `masters/`; catalog ใช้ JSON ภาพ runtime ทั้งหมดขนาด 1280x512 ต่ำกว่า 250KB ต่อไฟล์ ขนาดจริงที่ตรวจอยู่ที่ 111,978-198,446 bytes
- ชื่อ เลเวล เหรียญ และข้อมูลห้อง/เทอม/รหัสเป็น HTML บนพื้นทึบ `#f6faf8` ไม่พึ่งพื้นที่ว่างของงานภาพ ค่า contrast ที่บันทึกต่ำสุด 6.31:1 รวม accent ทุกธีม ภาพพื้นและ overlay ถูกจำกัดสูง 180px ไม่ยืดตามความสูงชื่อเมื่อขยายข้อความ 200%; รองรับ reduced motion
- ที่มาและ exact generation prompt อยู่ใน metadata ของ PNG master, `masters/*.prompt.txt`, sidecar `*.webp.json` และ `batch-a.json` / `batch-b.json`; `manifest.json` ระบุชุด pet/rank ที่ใช้จริง ภาพไม่มีข้อมูลส่วนตัวหรือข้อความ identity ฝังอยู่
- overlay รักษา native alpha เดิม แต่ยังมี residue/ขอบเล็กน้อยบริเวณกลาง จึง **ไม่อ้าง strict zero-alpha** ข้อจำกัดและค่ารายภาพอยู่ใน `batch-b.json`; test ใช้ mean alpha < 1/255 และสัดส่วนพิกเซล alpha >= 16 ต่ำกว่า 0.3% ไม่ใช่การรับรองว่าศูนย์ทุกพิกเซล

## การต่อกับระบบเดิม

ตรวจ `index.html`, `student-panels.css`, `student-banners.js`, `student-history.js`, diff จำกัดของ `app.js` และ `student-home.js` / `student-home.css` เทียบ `PRODUCT.md`, `DESIGN.md` และ `reference/document.md` พร้อมภาพ home/shop/ข้อความ 200% แล้ว งานนี้สืบทอด Sarabun, Font Awesome, Bootstrap 5.3.0, โครงหน้ากว้างสูงสุด 480px, เมนูล่าง และรูป/กรอบเดิม ใช้เขียวกับการกระทำ ทองกับเหรียญ และพื้นสว่างเพื่ออ่านข้อมูล ไม่ยกระดับค่าตกแต่งเฉพาะหน้านี้เป็นกฎทั้งโครงการ

จุดเชื่อมใน `app.js` จำกัดที่เรียก render banner หลังอัปเดตข้อมูล/สัตว์เลี้ยง ส่งประวัตินักเรียนเข้าสู่ modal ใหม่ และการแสดงผล/โฟกัสร้านค้า ส่วน `student-home` เพิ่ม reset ประวัติและ banner พร้อมใช้ตัวแปรสีพื้น งานเช็คชื่อ GPS รายงาน และ business rules ยังใช้เส้นทางเดิม

**drift เดิมที่ไม่แก้:** `DESIGN.md` ยังเป็น notes ไม่มี token-bearing YAML frontmatter และหัวข้อไม่ตรง canonical schema ของสกิลปัจจุบัน อีกทั้งยังไม่มี `.impeccable/design.json` นี่คือ context/schema drift ที่พบ ไม่ใช่เหตุให้เปลี่ยน visual world หรือสร้าง sidecar ในงาน extension นี้ คง `PRODUCT.md`, `DESIGN.md` และสถานะ sidecar เดิมไว้ทั้งหมด

## ตรวจซ้ำและเปิด Preview

ผลที่ส่งมอบผ่านชุดทดสอบประวัติ/banner และ regression ที่ระบุชื่อทั้งหมดใน [รายงาน QA](20261030-student-panels-qa.md#automated-results) รวม student-home หลังแก้ความสูง และ panels UI รอบเก็บภาพสุดท้ายครบ 320/360/390/768/1280px พร้อม retry/cancel, no-pet, ชื่อสินค้าจริงตามตัวอักษร, primary/menu clearance และข้อความ 200% รอบเอกสารนี้อ่านโค้ด/หลักฐาน ไม่ได้รัน tests หรือ detector ซ้ำ

คำสั่งหลักจาก project root; ตั้ง dependencies และ environment ตามรายงาน QA ก่อนรัน:

```powershell
node scripts/test-student-history.cjs
node scripts/test-student-banner-assets.cjs
node scripts/test-student-panels-ui.cjs
node scripts/serve.cjs 5173
```

Local preview: **http://127.0.0.1:5173/** ภาพหลักฐานอยู่ใน `tmp/student-panels/` และ `.impeccable/review/`; คำสั่ง panels UI จะเขียนภาพใหม่ จึงควรรักษาชุดที่ reviewer ใช้อ้างอิงไว้เมื่อตรวจรอบถัดไป

ข้อจำกัด: browser เป็น synthetic Edge fixtures ที่บล็อก production ไม่ได้ทดสอบ iPad/iPhone/Android จริง, Safari/WebKit, GPS/การติดตั้ง/Google OAuth จริง หรือการซื้อบน production ดูรายการ named tests และข้อจำกัดฉบับเต็มใน [QA](20261030-student-panels-qa.md) โดยไม่ตีความ scoped `ship` เป็นการรับรองเกินหลักฐาน
