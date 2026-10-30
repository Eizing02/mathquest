# ส่งมอบ Student Banner Refinement - 30 ตุลาคม 2569

**ผลรีวิวล่าสุด: `disposition: ship` เฉพาะ 2 material fixes ซึ่งเป็น `Resolved` ทั้งคู่** ผู้ตรวจรับรอง recaptures ที่กำหนดครบ 13 ภาพ ไม่พบ material regression ภายในขอบเขตแก้ไขนี้ ไม่ใช่ whole-surface approval หรือ WCAG certification ผลนี้แทน verdict รุ่นพื้น identity ทึบใน [handoff เดิม](20261030-student-panels.md) และ [QA เดิม](20261030-student-panels-qa.md); รายละเอียดร้านค้า/ประวัติที่ไม่เปลี่ยนยังใช้อ้างอิงได้

## ขอบเขตและความต่อเนื่อง

ผู้ใช้อนุมัติ structural refinement หลังปฏิเสธ white block เป็น code-led extension ของหน้าที่มีอยู่ในโหมด Operate ไม่ใช่ visual world ใหม่ สืบทอด Sarabun, Font Awesome, Bootstrap, student shell สูงสุด 480px, เมนูล่าง และระบบรูป/กรอบเดิมตาม PRODUCT/DESIGN คงเขียวสำหรับการกระทำ ทองสำหรับเหรียญ และสีพื้นตาม pet/rank ไม่ยกระดับองค์ประกอบเฉพาะแบนเนอร์เป็นกฎทั้งระบบ

ไม่มี asset ใหม่: คง raster pet banners 21 ภาพ + rank overlays 4 ภาพเดิม ไม่มีการเปลี่ยน SQL/migration, schema, XP, เหรียญ, การเช็คชื่อ, GPS, สิทธิ์หรือกติกาสัตว์เลี้ยง/ร้านค้า และไม่มี Git commit/push รอบ documenter นี้อ่านหลักฐานอย่างเดียว ไม่รัน detector/tests และเขียนเฉพาะเอกสาร 3 ไฟล์ท้ายรายงาน

## โครงสร้างที่ยืนยันจากโค้ด

- **บนภาพในขนาดปกติ:** มีเฉพาะ avatar ชื่อ เลเวล และเหรียญ; identity เป็น HTML บนพื้นโปร่งใส ไม่มี opaque plane หรือ blank cover ทับงานภาพ ข้อมูลส่วนบุคคลไม่ได้ฝังใน raster
- **ด้านล่างภาพ:** ชั้น/ห้อง ภาคเรียน และรหัสนักเรียนอยู่นอก header; ลำดับ DOM และภาพตรงกันเป็นข้อมูลห้อง/เทอม/รหัส ตามด้วย XP แล้วจึงสัตว์เลี้ยง เมนูเพิ่มเติมอยู่นอกภาพในแถวท้ายใกล้ปุ่มรายละเอียด ไม่ทับชื่อ
- **ขนาด:** avatar 84px และชื่อ 20px (`1.25rem`, weight 800, line-height 1.5); ที่ viewport ไม่เกิน 360px ใช้ avatar 76px และชื่อ 18px (`1.125rem`) ชื่อยาวตัดบรรทัดได้ ไม่ตัดชื่อทิ้ง
- **ภาพต่อเนื่อง:** header ปกติสูงอย่างน้อย 156px; art ใช้ `height:100%`, `object-fit:cover`, `object-position:left center` จึงเต็มความสูงเมื่อชื่อยาว ไม่คงเพดาน 180px รุ่นก่อนหรือปล่อยแถบพื้นเปล่าใต้ข้อความ
- **ข้อยกเว้นข้อความขยาย:** `@container student-profile (max-width:16rem)` เปลี่ยนเป็น avatar/art ด้านบนและ identity แถวถัดไป กำหนด art/rank สูง 144px ชัดเจน รองรับ text 200% โดยไม่ยืดภาพตามข้อความ ไม่ใช่การนำ white block กลับมาทับภาพ ต้องเลื่อนหน้าได้ ไม่บังคับทุกอย่างอยู่ viewport เดียว
- **หลบลายภาพตามธีม:** thorn/volt/aqua/sunny/rocky ขยาย image span ด้วย `--student-art-overflow:72px`; thorn/volt/rocky วางเลเวลกับเหรียญแนวตั้ง (`gap:4px`) เพื่อให้ข้อความพ้นลวดลาย แก้ด้วย layout ไม่ใช่ทาสีปิดภาพ
- **กรอบ rank:** ใช้ raster จริงเดิมเป็น border-image แบบ 9-slice (`slice:70 150 50`, border widths `14px 30px 10px`, repeat stretch, ไม่ใช้ fill) ไม่สร้างกรอบ/asset ใหม่ ระดับตกแต่ง 0/10/20/30/40 ยังแยกจากวิวัฒนาการเดิม 0/16/31 และกติกาธุรกิจ
- **ภาพโหลดพลาด:** handler ของ asset ปัจจุบันซ่อนภาพ ล้าง `src`, ล้างตัวแปรภาพกรอบเมื่อเป็น rank และล้าง `studentBannerKey`; identity ยังอ่านได้ การเรียก refresh/render อย่างชัดเจนครั้งถัดไปจึงลองโหลดใหม่ได้ ไม่อ้างว่ามี automatic retry loop โหลดเฉพาะ pet/rank ปัจจุบัน ไม่ preload ทั้งชุดหรือ masters; no-pet ใช้ fallback เดิม และรองรับ reduced motion

## คุณภาพและผลรีวิว

fresh finish review รอบแรกให้ `fix` 2 material issues หลังเปลี่ยนเป็น identity โปร่งใส แก้ CSS แล้วส่งหลักฐานเส้นทางเดิมให้ reviewer ตัดสินอีกครั้ง:

| Material Fix | Verdict ล่าสุด |
| --- | --- |
| ภาพต้องต่อเนื่องเต็ม header หลังชื่อยาวและ metrics ไม่มี plain strip | `Resolved` |
| ข้อความบนภาพต้องหลบลายจริง โดยเฉพาะ thorn/volt/aqua/sunny/rocky | `Resolved` |

ผู้ตรวจให้ `ship` หลังยืนยัน required recaptures ทั้ง 13 ภาพว่า valid และไม่มีรายการค้างใน scoped fixes นี้ ไม่ขยายเป็นคำรับรองทั้งหน้า ทั้งระบบ หรือ accessibility ทั้งหมด

## QA และขอบเขตการกล่าวอ้าง

สถานะจาก parent/handoff และหลักฐานที่อ่าน ไม่ใช่ผลรันใหม่โดย documenter:

| ชุดตรวจ | สถานะ |
| --- | --- |
| Pure history, banner assets, install assets | PASS หลัง edits ตาม parent |
| Google, school, reports, ScanSob, GPS และ profile regressions | PASS หลัง edits ตาม parent; ชื่อชุดคือ `test-google-auth.cjs`, `test-school-admin.cjs`, `test-reports.cjs`, `test-scansob.cjs`, `test-attendance-location.cjs`, `test-profile-frames.cjs` (Node/SQL ตามแต่ละ suite) |
| Panels + render matrix, home, profile-frame และ GPS browser | PASS ก่อน CSS fix สุดท้าย; ไม่ยกผลเก่าเป็นผลรันใหม่ของทุก suite |
| Panels `--banner-audit` หลัง CSS fix สุดท้าย | PASS ครบ 21 pet x 5 rank = 105 renders พร้อม shop/history checks ตาม parent |
| Home `--no-capture` หลัง CSS fix สุดท้าย | PASS: PIN/install/backdrop/drafts/200% text/responsive ตาม parent |
| Panels `--banner-audit --no-capture` รอบยืนยัน fatal candidate assertion | PASS ยืนยันโดย parent หลัง documenter ส่งมอบ: candidates `[]`, ครบ 105 กรณี รวม regression ร้านค้า/ประวัติ; ไม่เปลี่ยน capture files |

### Rendered Contrast ไม่ใช่ WCAG Certification

`scripts/student-banner-qa.cjs` เทียบ screenshot ที่มี/ซ่อน identity แล้วสุ่ม core glyph pixels ของชื่อ เลเวล ยอดเหรียญและหน่วยกับพื้นภาพจริง ใช้เกณฑ์ candidate เมื่อสัดส่วนตัวอย่างที่ต่ำกว่า 4.5:1 **มากกว่า 1%** ต่อกรณี ไม่ใช่ตรวจทุกพิกเซลหรือทุกข้อความ/สถานะ/viewport; helper มี fatal `assert.deepEqual(issues,[])` และ parent ยืนยันรอบทดสอบ guard ว่าผ่านแล้ว

snapshot ที่อ่านจาก `tmp/student-panels/banner-render-contrast.json` มี 105 แถว, 21 pet, 5 rank และ candidates `[]` หลัง layout fix (รายงานเวลา `2026-10-30 03:22:35 UTC`; matrix 4 ภาพเวลา `03:22:35-36 UTC` ตรวจ metadata ซ้ำแล้วคงเดิม):

- minimum sampled contrast ประมาณ **1.071728:1** ใน ember หลาย rank เช่น Lv.40 มี 8/1,972 samples ต่ำกว่า 4.5:1
- worst failing fraction คือ **0.009375 = 0.9375%** ใน clover Lv.10 (18/1,920 samples) จึงไม่เข้าเกณฑ์ candidate ที่ >1% แต่ไม่ได้แปลว่าทุกพิกเซลผ่าน 4.5:1

candidate รุ่นก่อนต้องแก้ layout; candidates ว่างรุ่นปัจจุบันเป็นหลักฐานเฉพาะ sampling นี้ ไม่ลบข้อจำกัดดังกล่าว Pure asset test คำนวณ contrast บน fallback `#f6faf8` เท่านั้น ค่า 6.31:1 รุ่นพื้นทึบในเอกสารเก่า **ไม่พิสูจน์ contrast ของ artwork** ห้ามอ้างว่าทุกภาพผ่าน 4.5:1 จากค่านั้นหรือจาก candidates ว่าง

## Preview และหลักฐาน

Local preview ที่ parent เปิดไว้: [http://127.0.0.1:5173/](http://127.0.0.1:5173/) (hidden Node PID 7212 ตาม handoff; รอบนี้ไม่เปิด/รีสตาร์ต server)

คำสั่งตรวจสำหรับผู้รับช่วง ไม่ได้รันโดย documenter; dependencies/`NODE_PATH` และ `SQL_QA_MODULE_ROOT` ตาม [QA เดิม](20261030-student-panels-qa.md):

```powershell
node scripts/test-student-panels-ui.cjs --banner-audit
node scripts/test-student-home-ui.cjs --no-capture
```

Gallery ที่เปิดตรวจจริง: [leafy Lv.0](../tmp/student-panels/prototype-leafy-0.png), [rocky Lv.40](../tmp/student-panels/prototype-rocky-40.png), [ชื่อยาว 320px](../tmp/student-panels/prototype-long-320.png), [ข้อความ 200%](../tmp/student-panels/prototype-text-zoom.png) พร้อม `tmp/student-panels/banner-matrix-1.png` ถึง `banner-matrix-4.png` ทั้ง 4 ภาพ ภาพและ JSON อยู่ใน tmp และอาจถูก QA รอบถัดไปเขียนทับ; รอบยืนยัน `--no-capture` ไม่เปลี่ยน capture files

**หลักฐานที่ documenter ตรวจ:** shipped `.agents/skills/impeccable/agents/impeccable_documenter.toml`, `reference/document.md` ฉบับเต็มและ finishing flow ใน `reference/new-work.md`; PRODUCT/DESIGN และเอกสารเดิมทั้งสอง; DOM/imports ใน `index.html`, `student-panels.css`, `student-banners.js`, inherited styles ใน `student-home.css`/`profile-frames.css`; `scripts/student-banner-qa.cjs`, `scripts/test-student-panels-ui.cjs`, pure banner test และจุดระบุ regression suites; banner manifest, `banner-assets.json`, rendered contrast JSON/metadata, gallery 4 ภาพและ matrix 4 ภาพ ผลรีวิวและผล test ที่ parent แจ้งระบุแหล่งไว้ข้างต้น ไม่อ้างว่า documenter รันหรือทำ independent reviewer verdict เอง

ทั้งหมดเป็น synthetic Edge fixtures ที่บล็อก production ไม่ใช่ผลจาก iPad/iPhone/Android จริง, Safari/WebKit, Google OAuth จริง, GPS จริง หรือการติดตั้ง/ซื้อสินค้าจริงบน production

**Drift เดิมที่ไม่แก้หรือ canonize:** DESIGN.md ยังเป็น notes ไม่มี token-bearing YAML frontmatter/ลำดับ canonical headings และยังไม่มี `.impeccable/design.json` งานนี้เป็น extension ไม่ได้รับอนุญาตให้ซ่อม schema หรือสร้าง sidecar; คง PRODUCT/DESIGN/สถานะ sidecar เดิม ไม่เปลี่ยน defect หรือข้อจำกัด contrast เป็นกฎออกแบบ

**ไฟล์ที่เปลี่ยนในรอบ documenter:** `docs/20261030-student-banner-refinement.md` (ฉบับนี้), `docs/20261030-student-panels.md` และ `docs/20261030-student-panels-qa.md` (เพิ่มเฉพาะ superseded notice ใกล้ต้นไฟล์) ไม่แก้ source/assets/SQL/tests หรือ Git
