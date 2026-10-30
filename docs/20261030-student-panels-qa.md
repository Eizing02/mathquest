# Student Panels QA - 30 October 2026

> **Superseded เฉพาะแบนเนอร์:** ใช้ [Student Banner Refinement](20261030-student-banner-refinement.md) เป็นข้อมูลล่าสุด ผลพื้น identity ทึบ/ภาพจำกัด 180px, contrast 6.31:1 และ verdict 3 fixes ด้านล่างเป็น snapshot รุ่นก่อน รุ่นโปร่งใสบนภาพได้ `ship` เฉพาะ 2 fixes ที่ `Resolved` แล้ว ไม่ใช่ whole-surface/WCAG certification; เอกสารใหม่แยกผล QA หลัง CSS fix, rendered sampling และรอบ fatal-assertion ซึ่งยืนยันผ่านแล้วไว้ชัดเจน

## Scope

ตรวจหน้าหลักนักเรียน ร้านค้า ประวัติเข้าเรียน และภาพธีมใหม่ด้วยข้อมูลจำลอง ไม่มีการอ่านหรือเขียนฐานข้อมูลจริง ไม่มี migration ใหม่ และยังไม่ได้ commit/push งานรอบนี้

## Automated Results

ผ่าน JavaScript syntax: `app.js`, `student-history.js`, `student-banners.js`

ผ่าน Node suites:

- `scripts/test-student-history.cjs`: 5 วันที่ต่างกันตาม Asia/Bangkok, หลายรายการในวันเดียว, bounded reads, timestamp microseconds, snapshot, retry ไม่หาย/ไม่ซ้ำ และ cancellation
- `scripts/test-student-banner-assets.cjs`: 21 ธีม + 4 rank, 1280x512, แต่ละภาพต่ำกว่า 250 KiB, ภาพไม่ซ้ำ/ไม่ว่าง, prompt provenance, alpha และ contrast
- `scripts/test-google-auth.cjs`
- `scripts/test-school-admin.cjs`
- `scripts/test-reports.cjs`
- `scripts/test-scansob.cjs`
- `scripts/test-attendance-location.cjs`
- `scripts/test-profile-frames.cjs`
- `scripts/test-profile-frame-assets.cjs`
- `scripts/test-student-install-assets.cjs`

ผ่าน browser suites โดยใช้ Edge headless และ fixture ที่บล็อก production Supabase:

- `scripts/test-student-panels-ui.cjs`: จอกว้าง 320/360/390/768/1280px, ร้านค้ากลางจอ/เลื่อนเฉพาะ body, ปุ่มเหรียญไม่พอ, ชื่อสินค้าที่มีอักขระพิเศษ, Escape ปิดเฉพาะ popup บนสุด, ประวัติ 5 วัน/เลื่อนเพิ่ม/ลองใหม่/ปิดระหว่างโหลด, pet/rank/background, no-pet, 200% text และ reduced motion
- `scripts/test-student-home-ui.cjs --no-capture`: PIN, server feedback, install guide, backdrop/draft guard, 320-1280px, ปุ่มเช็คชื่อและปุ่มติดตั้งไม่ทับกัน, 200% text
- `scripts/test-google-auth-ui.cjs --no-capture`: รวม actual Supabase SDK กับ OAuth callback จำลอง
- `scripts/test-school-ui.cjs --no-capture`
- `scripts/test-profile-frames-ui.cjs --no-capture`
- `scripts/test-attendance-location-ui.cjs --no-capture`

ตั้ง `NODE_PATH` ให้ชี้ dependencies ที่มี Playwright/Sharp และ `SQL_QA_MODULE_ROOT` ให้ชี้ dependencies ที่มี PGlite/PostGIS ก่อนรันชุดที่เกี่ยวข้อง

## Impeccable Evidence

- ใช้ Impeccable 4.7.0 ตาม context ที่โหลดใน session และแนวทาง craft floor, typeset, adapt, harden, animate และ polish สำหรับการปรับเฉพาะหน้าที่มีอยู่
- `detect student-panels.css student-history.js student-banners.js --json` รันหนึ่งครั้ง ผล `[]` เป็น static scan เฉพาะไฟล์ใหม่ ไม่ใช่การรับรอง accessibility ทั้งระบบ
- `embed-prompt --scan assets/student-banners`: 50 rasters, 0 missing
- ภาพ runtime ทั้ง 25 ภาพมี master และ sidecar ระบุ prompt/ต้นทาง ไม่มีการโหลด masters ในหน้าเว็บ
- ข้อความบนพื้น identity สี `#f6faf8` มี contrast ต่ำสุด 6.31:1 สำหรับสีชื่อ ห้อง/เทอม เหรียญ และ accent ทั้ง 21 ธีม
- Rank overlays มี alpha จริง แต่มี alpha residue เล็กน้อย จึงไม่อ้างว่าบริเวณกลางโปร่งใสเป็นศูนย์ทุกพิกเซล เกณฑ์ทดสอบกลางภาพ: mean alpha < 1/255 และสัดส่วน alpha >= 16 ต่ำกว่า 0.3%

หลักฐานภาพในเครื่อง: `tmp/student-panels/` และ canonical copies ใน `.impeccable/review/` ทั้งสองตำแหน่งถูก ignore เพื่อไม่รวมภาพ fixture ในการ commit

## Review

ผู้ตรวจทานอิสระรอบแรกให้ `fix` 3 ประเด็น: ปุ่มเช็คชื่อถูก navigation บังที่ 360x740, ภาพหลังข้อมูลอ่านยาก และเมนูทับชื่อยาว

แก้ด้วย spacing สำหรับจอเตี้ย, พื้น identity ทึบ/ภาพจำกัดความสูง 180px และย้ายเมนูไปแถวสัตว์เลี้ยง เก็บภาพใหม่ชุดเดิมพร้อม 360x740 แล้วส่งกลับไปตรวจเฉพาะรายการแก้ไข

ผล verdict pass: ผู้ตรวจทานให้ `ship` และให้ทั้ง 3 รายการเป็น `resolved` ขอบเขตคำตัดสินนี้เฉพาะรายการแก้ไขดังกล่าวจากภาพและผลทดสอบ Edge จำลอง ไม่ใช่การรับรองระบบจริงทั้งระบบ

## Limits

ยังไม่ได้ทดสอบเครื่อง iPad/iPhone/Android จริง, GPS จริง, การติดตั้งจริง, Google OAuth จริง หรือซื้อสินค้าบน production ผล browser ไม่ใช่ผล Safari/WebKit และไม่ได้รับรอง WCAG ทั้งระบบ

คงงาน skill update และไฟล์แก้ student ID ที่มีอยู่ก่อนเริ่มรอบนี้ไว้ ไม่ได้รวมเข้ากับการเปลี่ยน UI โดยอัตโนมัติ
