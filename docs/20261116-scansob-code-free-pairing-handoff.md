# Handoff: เชื่อม ScanSob กับ MathQuest โดยไม่กรอกรหัส

> ขั้นตอนล่าสุดสำหรับโหมดอนุมัติทีละคำขอและการปิดรหัสเก่าอยู่ใน [คู่มือสลับโหมด](20261117-scansob-review-each-request.md) ซึ่งแทนข้อกำหนดลงรายชื่ออีเมลล่วงหน้าเมื่อสลับโหมดแล้ว รูปแบบลายเซ็นและ ACK ในเอกสารนี้ยังใช้ต่อได้

**สถานะ:** ฝั่ง MathQuest พัฒนาใน workspace แล้ว ตาม [แผนระยะ A/B](20261117-scansob-staging-and-pairing-plan.md) ยังไม่ได้ deploy หรือทดสอบแบบสองระบบบน staging ฝั่ง ScanSob ต้องยืนยันสัญญาด้านล่างก่อนนำไปเปิดใช้ เอกสารนี้ไม่ใช่คำสั่งให้แก้ Production หรือรัน SQL โดยอัตโนมัติ

**ไฟล์ติดตั้งใหม่ฝั่ง MathQuest (ทั้งสองไฟล์ต้องมี receiver 03):**

- **ระยะ A:** [20261117_01_scansob_publication_receipts.sql](../20261117_01_scansob_publication_receipts.sql) เพิ่มรายงานยอดจาก ACK ตามรอบเผยแพร่ เมื่อตรวจจากชุดสอบที่เลือก ไม่แก้เส้นทางจับคู่หรือการบันทึกคะแนน
- **ระยะ B:** [20261116_01_scansob_code_free_pairing.sql](../20261116_01_scansob_code_free_pairing.sql) ฉบับแก้ตามแผน ใช้หลังระยะ A ผ่านบน staging ค่าเริ่มต้นของการรับแบบไม่ใช้รหัสเป็นปิด ไม่เปลี่ยน connection หรือ token เก่า ไม่รัน migration เก่าซ้ำ

**เป้าหมาย:** ครูแต่ละคนกดส่งคำขอจากพื้นที่ทำงานของตนใน ScanSob ผู้ดูแล MathQuest เห็นแจ้งเตือนในแดชบอร์ดและตรวจแล้วกดอนุมัติหรือปฏิเสธ ไม่ต้องสร้าง ส่ง หรือพิมพ์รหัสจับคู่

## 1. สิ่งที่มีอยู่แล้วและขอบเขตงาน

- **MathQuest (เช็คชื่อ):** มี Edge Function `pair-scansob-workspace` รับคำขอแบบใช้รหัส 16 อักขระ ใช้ครั้งเดียว อายุ 10 นาที มีคิวรอ 24 ชั่วโมง และมีปุ่มอนุมัติ/ปฏิเสธในตั้งค่า แต่ไม่มีแจ้งเตือนจากหน้าอื่น คำขอและคีย์อยู่ในตาราง private ข้อมูลครูเรียกผ่าน `mq_scansob_admin`
- **ScanSob (สแกนสอบ):** ฟอร์มปัจจุบันส่งรหัสผ่าน `POST /api/integrations/mathquest` เซิร์ฟเวอร์อ่าน Workspace จาก session และฐานข้อมูล; SQL ตรวจว่าเจ้าของ Workspace เป็นผู้ใช้ที่ได้รับอนุมัติแล้ว คำขอรอใช้คำสั่งเช็กสถานะเพื่อรับ token โดยไม่ส่ง token ให้ Browser
- **รักษาของเดิม:** การเชื่อมต่อที่ใช้งานอยู่, ประวัติคะแนน, การเพิกถอนและกู้คืน, ข้อจำกัดหลังปิดเทอม, การเผยแพร่คะแนนแบบ manual/auto ตามที่เคยตั้ง, การนับคะแนนเข้าเรียน, GPS, หน้านักเรียน และการอนุญาตให้นักเรียนดูคะแนน ไม่เปลี่ยนตามการเพิ่มวิธีขอเชื่อม
- ครู ScanSob แต่ละคนส่งได้จาก **Workspace ที่ตนเป็นเจ้าของ** แยกกัน แม้ปลายทางเป็นโรงเรียนเดียวกัน ผู้ดูแล MathQuest ที่มีสิทธิ์เดิมเป็นผู้ตัดสิน ไม่เพิ่มสิทธิ์ครู MathQuest ให้ผู้ส่งคำขอ
- อ้างอิงจากโค้ดในเครื่องทั้งสองฝั่ง ไม่ถือว่าเวอร์ชันใด Deploy แล้วจนกว่าจะตรวจหลักฐานบนระบบนั้น

## 2. Flow ที่ครูจะใช้

| ลำดับ | ScanSob | MathQuest |
| --- | --- | --- |
| 1 | ตั้งค่า → เชื่อมต่อ MathQuest แสดงโรงเรียนปลายทางและ Workspace ของตน ยืนยันขอบเขตการส่งรหัสนักเรียนและคะแนน แล้วกด **ส่งคำขอเชื่อมต่อ** | ผู้ดูแลเปิดรับคำขอแบบไม่ใช้รหัสและเลือกว่าอีเมลครูใดส่งได้ ตั้งครั้งเดียว ไม่ต้องให้รหัสรายครั้ง |
| 2 | แสดง **รอ MathQuest อนุมัติ** พร้อมเวลาที่ส่ง ปุ่ม **ตรวจสถานะ** และ **ยกเลิกคำขอ** | กระดิ่งมีตัวเลขคำขอรอใหม่ แจ้งเตือนสั้น ๆ พร้อม **ดูคำขอ** โดยไม่ขัดจังหวะการเช็คชื่อ |
| 3 | ไม่ต้องแจ้งรหัสหรือเปลี่ยนหน้า เมื่อเปิดหน้ารอ ให้ตรวจสถานะให้อัตโนมัติ | เปิดรายการแล้วเห็นชื่อผู้ส่ง อีเมลที่ยืนยันจาก ScanSob, Workspace, โรงเรียนปลายทาง, วันเวลา และขอบเขตสิทธิ์ ก่อนกด **อนุมัติ** หรือ **ปฏิเสธ** |
| 4 | **เชื่อมต่อแล้ว** ต่อเมื่อได้รับและเก็บ token สำเร็จ ถ้าปฏิเสธหรือหมดอายุให้แสดงสถานะและขั้นตอนปิดคำขอเดิมก่อนเริ่มใหม่ | เมื่อตัดสินใจแล้วจำนวนคำขอค้างลดลง แสดง **อนุมัติแล้ว** และแสดง **รับคะแนนล่าสุด** แยกกัน ไม่อ้างว่า ScanSob รับ token หรือส่งคะแนนสำเร็จจากการกดอนุมัติ |

การปิดแจ้งเตือนไม่ถือว่าอนุมัติหรือปฏิเสธ การเปิดดูไม่ลดตัวเลข ถ้าปิดเว็บจะเห็นคำขอที่ยังค้างตอนกลับเข้าเว็บ ไม่รวม Web Push ขณะปิดเว็บในรอบนี้

## 3. สัญญาร่วมที่ต้องตกลงก่อนเขียนโค้ด

### 3.1 การยืนยันต้นทางและเลือกปลายทาง

- ScanSob Backend ยืนยัน session, ผู้ใช้ที่อนุมัติแล้ว, เจ้าของ Workspace และอีเมลที่ยืนยันจากระบบ Auth ของตนทุกครั้งก่อนลงนาม ห้ามรับ `sender_auth_id`, อีเมล, Workspace หรือ URL ปลายทางจากฟอร์มแล้วเชื่อทันที ถ้ายืนยันอีเมลไม่ได้ ให้หยุดส่งและแสดงข้อความที่แก้ไขได้
- ระยะแรกตั้งปลายทางเป็นโรงเรียนเดียวต่อ environment ผ่าน `MATHQUEST_RECEIVER_ORIGIN` และ `MATHQUEST_DESTINATION_SCHOOL_ID` (เสนอเพิ่ม) ฝั่ง MathQuest เทียบ ID กับโรงเรียนจริงในฐานข้อมูลและขอบเขตของคีย์ ไม่เลือกจากชื่อโรงเรียนหรือชื่อ Workspace อิสระ เมื่อเปิดใช้หลายโรงเรียนในอนาคต ต้องมีทะเบียนปลายทางที่อนุญาตบนเซิร์ฟเวอร์ก่อน
- ฝั่ง MathQuest จัดรายชื่อ **อีเมลครูที่ส่งคำขอได้** แยกตามโรงเรียน เก็บแบบ normalize (trim + lowercase; ไม่ตัดจุดหรือส่วน + ในอีเมล) ตรวจตอนรับและก่อนอนุมัติ จับคู่กับตัวตน/Workspace ที่บันทึกในคำขอ ไม่เอาชื่อที่แก้ได้มาใช้ตัดสินสิทธิ์ การเอาอีเมลออกไม่เพิกถอนการเชื่อมต่อที่อนุมัติไปแล้วโดยอัตโนมัติ
- ใช้คีย์ลงนามคำขอเฉพาะงานนี้ แยก staging/production และแยกจาก `SCANSOB_PAIRING_DELIVERY_KEY`, token รับคะแนน, secret ของ scheduler และ Supabase service key คีย์อยู่ใน server secrets เท่านั้น ไม่ใช้คีย์จากฝั่ง MathQuest เพื่อให้ ScanSob เข้าฐานข้อมูล

### 3.2 Contract สำหรับส่งคำขอ

ใช้ `POST /functions/v1/pair-scansob-workspace` เดิม เพิ่ม **`prepare_signed`** และ **`request_signed`** แบบ opt-in โดยคง `request` แบบใช้รหัสและ `status`/`revoke` เดิม ใช้ JSON UTF-8 ไม่เกิน 8 KiB และ strict schema แยกตาม action

**Prepare:** ส่งเฉพาะ `schema_version: "1.0"`, `action: "prepare_signed"`, `request_id`, `source_workspace_id`, `destination_school_id`, `sender_auth_id`, `sender_verified_email` โดยลงนามเหมือน Submit ผลสำเร็จ HTTP 200 มี **เฉพาะ** ฟิลด์ด้านล่าง ตรวจ ID และปลายทางก่อนเก็บ `pairing_window_id` ไม่มีรายการรอหรือ token เกิดจาก Prepare:

```json
{
  "schema_version": "1.0",
  "action": "prepare_signed",
  "request_id": "54ad814a-cfaa-4452-8c59-b8be7d60353e",
  "destination_school_id": "96b8f90f-f1ab-42fc-995e-e529e16fc8a1",
  "pairing_window_id": "fc39bdb9-edf8-4593-a0a1-c79f193e550e"
}
```

**Submit:** ส่ง body ของ `request_signed` โดยใช้ค่าตัวตนและอ้างอิงเดียวกับ Prepare:

| ฟิลด์ | แหล่ง/ข้อกำหนด |
| --- | --- |
| `schema_version`, `action` | `"1.0"`, `"request_signed"` |
| `request_id`, `source_workspace_id`, `destination_school_id` | UUID ตัวพิมพ์เล็ก; มาจากรายการคำขอและการตั้งค่าฝั่งเซิร์ฟเวอร์ |
| `workspace_label` | ชื่อที่อ่านจากฐานข้อมูล ScanSob สำหรับแสดงผล 1–160 อักขระหลัง trim |
| `sender_auth_id`, `sender_verified_email` | UUID ตัวพิมพ์เล็กและอีเมลที่ Backend ตรวจยืนยันแล้ว; แสดงอีเมลเฉพาะครูผู้ดูแล |
| `sender_display_name` | ระบุได้ถ้ามี อ่านจากโปรไฟล์ ScanSob สำหรับแสดงผลเท่านั้น 1–120 อักขระหลัง trim; หากไม่มีให้แสดงอีเมลในหน้ารายละเอียดแทน ไม่ใช่ใน toast |
| `requested_at` | UTC ISO 8601 ตอนสร้างคำขอ คงเดิมทุกครั้งที่ retry ไม่ใช้เวลานี้ตัดสินว่าคำขออยู่รอบใด |
| `pairing_window_id` | UUID ตัวพิมพ์เล็กที่ MathQuest ออกใน Prepare ต้องตรงรอบที่เปิดรับในตอนบันทึกคำขอใหม่ |
| `request_secret` | สุ่ม 32 ไบต์ รูปแบบ base64url ไม่เติม padding (43 อักขระ) เหมือนเดิม เก็บแบบเข้ารหัสใน ScanSob และเก็บ hash ที่ MathQuest |

- เสนอใช้ HMAC-SHA-256 ตาม [RFC 2104](https://www.rfc-editor.org/info/rfc2104/) บน **ไบต์ JSON ที่ส่งจริง** ไม่แปลง JSON ใหม่เพื่อคำนวณ ใช้ headers `X-ScanSob-Key-Id`, `X-ScanSob-Timestamp` (Unix seconds) และ `X-ScanSob-Signature` (base64url ไม่มี padding) ให้ทั้งสองฝั่งใช้ fixture ชุดเดียวกัน: คำนวณจาก prefix UTF-8 `mq-scansob-pair-v1\nPOST\n/functions/v1/pair-scansob-workspace\n<key-id>\n<timestamp>\n` ต่อด้วย raw body เลือกคีย์จาก key ID ที่ตั้งไว้ใน environment นั้นและตรวจด้วยฟังก์ชันเปรียบเทียบที่ไม่ขึ้นกับจำนวนตัวอักษรที่ตรงกัน
- คีย์ที่ตรวจผ่านต้องได้รับอนุญาตสำหรับปลายทาง ID นั้น ตรวจเวลา header คลาดได้สูงสุด ±5 นาทีเพื่อตรวจความสดของลายเซ็น แต่ป้องกันรอบเก่าด้วย UUID ที่ MathQuest เปลี่ยนเมื่อเปิดรับใหม่ ไม่ใช่เวลาของ ScanSob การปิดรับหรือรีเซ็ตล้างรอบปัจจุบัน คำขอที่บันทึกแล้วกู้ `status`/`revoke` ได้ตามเดิม หากค้างก่อน Reset จะถูกปิดตามกติกา reset เดิม
- ส่งซ้ำเมื่อผลไม่แน่ชัด: ใช้ ID เดิม, secret เดิม และ **body เดิม** ลงนามด้วยเวลา header ใหม่ได้ เก็บ hash ของ body ที่รับครั้งแรกและผูกกับ Workspace/โรงเรียน/วิธีส่งเดิม ID เดิมแต่ข้อมูลเปลี่ยนให้ปฏิเสธอย่างชัดเจนและไม่สร้างแถวใหม่
- คำตอบสำเร็จคงรูปแบบ legacy แบบ strict: `{schema_version, request_id, status}`; `pending_approval`, `rejected`, `expired` ไม่มี `connection` หรือ token; เฉพาะ `active` จึงมี `connection` รูปแบบเดิม การส่ง request ครั้งแรกสำเร็จให้ตอบ HTTP 200 `pending_approval` หลัง commit เท่านั้น `revoke` คง ACK แบบเดิม
- Error ที่ ScanSob ควรแยก: 400 `INVALID_SCHEMA`, 401 ลายเซ็นผิด, 403 `UNAUTHORIZED` (รวมปลายทางผิด), 409 `PAIRING_WINDOW_CHANGED` (รอบเปลี่ยน), `PAIRING_WORKSPACE_BUSY` (ทั้งวิธีใช้รหัสและแบบลงนาม), `PAIRING_REQUEST_CONFLICT` (ID เดิมแต่ body ไม่ตรง), 429 `RATE_LIMITED` พร้อม `Retry-After`, 503 `SIGNED_PAIRING_DISABLED` หรือค่าตั้ง/ระบบยังไม่พร้อม ไม่ใช้ generic 403/404/timeout เป็นหลักฐานว่าคำขอหรือการเชื่อมต่อเดิมไม่เคยมี หากรอบเปลี่ยนให้ปิด attempt เดิมตาม flow แล้วให้ครูเริ่มใหม่ ไม่ยัด window ใหม่เข้า body เดิม

## 4. งานฝั่ง MathQuest (เช็คชื่อ / ฝั่งรับ)

1. **SQL migration ใหม่ต่อจาก receiver 03:** เพิ่มชนิดคำขอแบบใช้รหัสกับแบบเซิร์ฟเวอร์ลงนาม, ข้อมูลผู้ส่งที่จำเป็น, hash ของ payload และการตั้งค่าเปิดรับ/เวลาเปิดรับ/รายชื่อผู้ส่ง ออกแบบข้อจำกัดให้ `code_id` ขาดได้เฉพาะคำขอแบบลงนาม ห้ามสร้างรหัสหลอกเพื่อยัดลงคอลัมน์เดิม และห้ามแก้ข้อมูลคำขอเดิมตอนอัปเกรด
2. **รับคำขอเข้าคิว:** Edge Function ตรวจ schema, ขนาด, ลายเซ็น, เวลา header และปลายทาง ก่อนเรียก service-only RPC ฐานข้อมูลตรวจรายชื่อ window และขีดจำกัดภายใต้ transaction ทั้งสองวิธีใช้ Workspace lock เดียวกันและตรวจว่ามี pending ที่ยังไม่หมดอายุหรือ active อยู่ก่อนเพิ่มคำขอ วิธีเดิมตรวจแล้วค่อยใช้รหัส หากมีคำขอซ้ำที่ค้างมาตั้งแต่ก่อนอัปเดต ให้ผู้ดูแลปฏิเสธคำขอซ้ำก่อนกดอนุมัติ ไม่ลบอัตโนมัติ
3. **ตัดสินและเก็บ audit:** ใช้ JWT ครู Google และ teacher session ตามเดิม ล็อกสถานะและตรวจว่ายังรอ ไม่หมดอายุ ไม่ถูกยกเลิก และผู้ส่งยังได้รับอนุญาต การอนุมัติสร้าง connection ที่ผูก Workspace/โรงเรียนพร้อมสิทธิ์ `score:write` ภายใน transaction เดียว บันทึกผู้ตัดสิน ผล และเวลา ไม่เก็บคีย์หรือ secret ใน audit การปฏิเสธสร้างศูนย์ connection; ถ้าอีกแท็บจัดการไปแล้ว ให้โหลดผลจริงโดยไม่ทำรายการซ้ำ
4. **Inbox และ Badge:** เพิ่มการอ่านเฉพาะคำขอรอผ่าน RPC สำหรับครู ไม่ใช้ `status` เดิมที่ดึงสถิติคะแนนและตัดประวัติไว้ 100 รายการมานับกระดิ่ง ให้ฐานข้อมูลนับเฉพาะ pending ที่ยังไม่หมดอายุ แบ่งหน้ารายการ; แยกจากการดึงค่าฟอร์มตั้งค่าเพื่อไม่ให้ Realtime ทับสิ่งที่ครูกำลังแก้
5. **แจ้งเตือน:** เพิ่ม [Supabase Realtime Broadcast ช่องส่วนตัว](https://supabase.com/docs/guides/realtime/broadcast) ที่จำกัดหัวข้อตามโรงเรียนและผู้มีสิทธิ์ครูด้วย [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) ให้ส่งเพียงสัญญาณ `requests_changed` ไม่ส่งแถวจริงหรืออีเมล ไม่มีสิทธิ์ส่งจาก Browser ดึงรายการใหม่หลังสัญญาณ โหลดเมื่อเปิดหน้า/กลับเข้าแท็บ/เชื่อมใหม่ และ fallback polling 30–60 วินาทีขณะหน้าเปิดและมองเห็น ไม่ให้ความล้มเหลวของแจ้งเตือนทำให้คำขอที่บันทึกถูกตีความว่าล้มเหลว
6. **หน้าเว็บครู:** เพิ่มกระดิ่งและ badge ในส่วนหัวของแดชบอร์ดทุกแท็บ ไม่เพิ่มแท็บหลักอีกหนึ่ง กดแล้วไปยังกล่องคำขอในตั้งค่า แสดงจำนวนค้างและเหตุผลหากเชื่อมต่อไม่ได้ มีสถานะกำลังโหลด/ว่าง/โหลดซ้ำ/หมดอายุ คำขอใหม่เด้งครั้งเดียวต่อคำขอที่แท็บนั้นเห็นใหม่; ไม่เด้งย้อนหลังทีละรายการเมื่อเปิดหน้าแรก
7. **การปิดและกู้คืน:** เพิ่มสวิตช์ปิดรับ **คำขอใหม่แบบไม่ใช้รหัส** แยกจากสวิตช์รับคะแนน ปิดแล้วไม่กระทบ connection เดิมหรือ status/revoke; คำขอที่ค้างยังจัดการได้ตามสิทธิ์และเวลา เมื่อรีเซ็ตเทอมต้องปิดรับรอบใหม่และปิดคำขอเก่าตามกติการีเซ็ตเดิม รักษาการยกเลิกแบบมีหลักฐาน การกันคำขอล่าช้า และคะแนนเก่าที่ถูกซ่อนหลังจับคู่ใหม่

จุดเริ่มแก้: `20261015_02_scansob_receiver.sql`, `20261015_03_scansob_recovery_hardening.sql` เป็น **ไฟล์อ้างอิง ไม่รันซ้ำ**; เพิ่ม SQL ใหม่, ตรวจ `supabase/functions/pair-scansob-workspace/index.ts`, `supabase/functions/_shared/scansob-http.mjs`, `scansob-contract.mjs`, `scansob.js`, `scansob.css`, ส่วนหัวและตั้งค่าใน `index.html` และ lifecycle หลังล็อกอินครู/ออกจากระบบ

## 5. งานฝั่ง ScanSob (สแกนสอบ / ฝั่งส่ง)

1. **ฟอร์ม:** เพิ่มโหมดส่งคำขอโดยไม่กรอกรหัสใน `components/integrations/mathquest-settings.tsx` รักษาการยินยอมส่งคะแนนและสิทธิ์เจ้าของ Workspace แสดงชื่อโรงเรียนปลายทางที่กำหนดไว้โดย Backend และ Workspace ปัจจุบัน ซ่อนช่องรหัสเฉพาะเมื่อยืนยันว่าปลายทางรองรับโหมดใหม่แล้ว ไม่ตกกลับไปใช้รหัสแบบเงียบ ๆ
2. **API และตัวลงนาม:** เพิ่มเส้นทางคำขอแบบใหม่ใน `app/api/integrations/mathquest/route.ts`, `types/integration.ts`, `lib/integrations/mathquest/pairing.ts` และ config ที่เกี่ยวข้อง ตรวจผู้ส่งตามข้อ 3.1 ก่อนส่ง เซิร์ฟเวอร์รับจาก Browser เท่าที่จำเป็น เช่น request ID และ consent ห้ามส่ง signing key, pairing secret หรือ token กลับ UI
3. **Persist ก่อนส่ง:** สร้าง/บันทึก attempt และ secret ที่เข้ารหัสก่อนเรียก HTTP ตาม pattern เดิม ต้องกู้ body เดิมจากข้อมูลที่บันทึกได้แม้ reload หรือชื่อ Workspace เปลี่ยน หากต้องเก็บ payload เต็ม ให้เก็บใน private storage แบบเข้ารหัส ไม่ใส่ใน public overview หรือ log พิจารณา migration ใหม่ฝั่ง ScanSob เฉพาะถ้าต้องเก็บข้อมูล attempt/สัญญารูปแบบใหม่หรือสถานะละเอียดเพิ่ม
4. **ตรวจสถานะหลังส่ง:** reuse `PATCH` คำสั่ง `refresh` (การ GET overview อย่างเดียวไม่ได้ไปรับ token จาก MathQuest) ตรวจเป็นช่วง 10–15 วินาทีขณะหน้าคำขอเปิดและแท็บมองเห็น เคารพ rate limit เดิม, `Retry-After` และ backoff; หยุดเมื่อสิ้นสุดคำขอ, logout, เปลี่ยน Workspace หรือปิดหน้า ตรวจ request ID และ destination ID ที่คาดไว้ก่อนเก็บ token และเปลี่ยนเป็น **เชื่อมต่อแล้ว** ห้ามเปลี่ยนไปใช้โรงเรียนอื่นเอง
5. **สถานะและ retry:** ก่อนทราบผล POST ให้ขึ้น **กำลังส่ง** หรือ **ยังยืนยันผลไม่ได้** ไม่ขึ้น **รออนุมัติ** โดยไม่มีหลักฐาน หากผลส่งไม่แน่ชัด ให้ลองส่ง request เดิมซ้ำก่อนเรียก `status` ตามรอบ เพราะ receiver 03 อาจปิด ID ที่ไม่เคยสร้างเมื่อเรียก `status` ถ้าครูกด **ยกเลิก** ให้ใช้ recovery/revoke เดิม สำหรับคำขอใหม่ที่ได้ `rejected` หรือ `expired` ให้คง challenge ไว้จนได้ revoke ACK ที่ผูกกับ ID เดิมก่อนอนุญาตให้เริ่มใหม่ เพราะ `expired` อาจหมายถึงหมดเวลารับ token ทั้งที่ connection ถูกอนุมัติแล้ว ตรวจและปรับ RPC ฝั่ง ScanSob ให้เก็บ challenge สำหรับ flow นี้ (ของเดิมส่งต่อไปยัง RPC ที่ล้าง challenge เมื่อได้ terminal status) ไม่วนส่งซ้ำเอง และไม่สรุปว่าถอนคะแนนสำเร็จจาก revoke ACK
6. **แยกการเชื่อมจากการส่งคะแนน:** การอนุมัติเพียงทำให้ Workspace มีสิทธิ์ส่ง ไม่สร้างงานเผยแพร่คะแนน ไม่เปิด auto mode ให้เอง ไม่เปลี่ยน outbox, revision, scheduler, เกณฑ์เทียบรหัสนักเรียน หรือการถอนคะแนนเดิม
7. **SQL ฝั่ง ScanSob:** การเก็บ attempt ที่ส่งแล้วแต่ยังไม่ทราบผล และการคง challenge หลัง `expired` ของคำขอแบบใหม่ ต้องแก้ตามรูปแบบฐานข้อมูล ScanSob เอง ให้จัดทำ migration ใหม่ถ้าจำเป็น ไม่รันไฟล์ 010/011/012 ซ้ำ ฟิกซ์เจอร์ฝั่งรับ `scripts/test-scansob-signed-pairing.cjs` มีตัวอย่างลายเซ็นและ ACK ที่ใช้เทียบได้

## 6. การตั้งค่าและลำดับ Deploy

| จุดตั้งค่า | สิ่งที่ต้องเตรียม |
| --- | --- |
| **Supabase ของ MathQuest** | รัน migration ใหม่หลังสำรองและซ้อม ทดสอบ policy/role ของ RPC และช่องแจ้งเตือน ตั้ง signing verifier key และ key ID เป็น Edge Function Secrets โดยคง `SCANSOB_PAIRING_DELIVERY_KEY` เดิม และเปิดสิทธิ์ส่งคำขอเฉพาะครูทดสอบในตั้งค่าของ MathQuest |
| **Netlify ของ ScanSob** | ไปที่ Environment variables ของเว็บ ScanSob ใน environment ที่กำลังทดสอบ ตั้ง origin ของ Supabase MathQuest แบบไม่ต่อ `/functions/v1` และไม่ใช้ URL Vercel กำหนด destination school UUID, signing key/key ID เดียวกับ receiver และ feature flag ใหม่สำหรับโหมดไร้รหัส (เสนอ `MATHQUEST_CODE_FREE_PAIRING_ENABLED`) เป็น server-only ไม่ใช้ `NEXT_PUBLIC_` คงเงื่อนไข `SCORE_INTEGRATION_ENABLED` และ `MATHQUEST_RECEIVER_VERIFIED` เดิม และ Deploy ใหม่ให้ Server ใช้ค่า |
| **เว็บ MathQuest บน Vercel** | Deploy หน้าแจ้งเตือนและรายการคำขอหลัง SQL และ Edge Function พร้อม ไม่ใส่ shared key ในโค้ดหน้าเว็บ |

### ค่าจริงที่โค้ด MathQuest อ่าน

เพิ่มใน **Supabase → Edge Functions → Secrets** ของ MathQuest:

| ชื่อ | รูปแบบ |
| --- | --- |
| `SCANSOB_CODE_FREE_SIGNING_KEY` | 32 ไบต์สุ่ม เข้ารหัส base64url ไม่เติม padding (43 อักขระ) ตั้งค่าเดียวกันใน Secret ฝั่ง ScanSob ของ environment นั้น ห้ามส่งผ่าน Git หรือแชต |
| `SCANSOB_CODE_FREE_SIGNING_KEY_ID` | ชื่อคีย์ 1–64 อักขระ ใช้ A–Z, a–z, 0–9, ขีดกลางหรือขีดล่าง ต้องตรงกับ header จาก ScanSob |
| `SCANSOB_CODE_FREE_DESTINATION_ID` | UUID โรงเรียนของ MathQuest; ScanSob ตั้งค่าตรงกันใน `MATHQUEST_DESTINATION_SCHOOL_ID` |

ดู UUID จาก SQL Editor ของ **Supabase MathQuest** ด้วยคำสั่งอ่านอย่างเดียว:

```sql
select id as destination_school_id
from mathquest_private.scansob_school
where singleton;
```

UUID นี้ไม่ใช่ Supabase project ref หรือ Workspace UUID รักษา `SCANSOB_PAIRING_DELIVERY_KEY` เดิม จากนั้น Deploy เฉพาะ Edge Function ที่เปลี่ยน: `npx supabase functions deploy pair-scansob-workspace` เมื่อ CLI ผูกกับโปรเจกต์ที่ต้องการแล้ว ไม่ต้อง redeploy `ingest-scansob-results` เพื่อเปิดฟีเจอร์นี้

ในการทดสอบบน Supabase ให้ยืนยันว่า Realtime ใช้งานได้และช่องเป็น private; SQL เพิ่ม RLS เฉพาะ topic ของ inbox ไม่ต้องเพิ่มตารางคำขอใน publication และไม่ต้องปรับ policy ของออเดอร์เดิม หาก Realtime ไม่พร้อม หน้าเว็บใช้ polling สำรองประมาณ 35 วินาที

1. ทั้งสองทีมรับรอง wire contract, error mapping และ fixture เดียวกันก่อน merge ระบุคนดูแลคีย์และรายชื่อผู้ส่งที่โรงเรียนอนุญาตส่งคำขอ
2. ที่ staging: Deploy SQL และ Edge Function ฝั่ง MathQuest ก่อน โดยค่าเริ่มต้น **ปิด** คำขอแบบใหม่ จากนั้น Deploy เว็บ MathQuest และ ScanSob (และ SQL ใหม่ของ ScanSob ก่อนเว็บ หากจำเป็น)
3. เปิดโหมดใหม่เฉพาะบัญชีทดสอบบน staging ทดสอบจับคู่ทั้งแบบเดิมและใหม่ ตลอดจนส่ง/ถอนคะแนนสังเคราะห์ ผ่านเกณฑ์ข้อ 7 ก่อนใช้ข้อมูลจริง
4. Production: ทำลำดับเดียวกันด้วยคีย์คนละชุด เปิดทีละกลุ่มและคงทางเดิมไว้จนยืนยันว่าไม่กระทบผู้ใช้เก่าหรือคำขอค้าง ค่อยซ่อนตัวเลือกรหัสเดิมเมื่อครบเงื่อนไข ไม่ลบข้อมูลเก่าเพื่อปิดทางเดิม
5. Rollback: ปิดรับคำขอไร้รหัสที่ MathQuest และปิด flag สำหรับ **เริ่มคำขอใหม่** ที่ ScanSob โดยยังแสดงคำขอลงนามที่ค้าง ให้ตรวจสถานะ/ยกเลิกได้ และรักษาการส่งคะแนนของ connection เดิม ถ้าต้องเพิกถอน connection ให้ใช้ flow เดิมและตรวจผลของการถอนคะแนน ไม่เปิดสิทธิ์สาธารณะ ไม่ drop ตาราง และไม่รัน migration 02/03 ซ้ำ

## 7. เกณฑ์รับงานก่อนเปิดให้ครูจริง

| ทดสอบ | ผลที่ต้องได้ |
| --- | --- |
| ครูสองคน สอง Workspace ส่งมาโรงเรียนเดียว | แต่ละคนไม่กรอกรหัส MathQuest เห็นสองคำขอและแยกคน/Workspace ถูกต้อง |
| คนไม่มีสิทธิ์, เปลี่ยน body, คีย์ผิด environment, ผิดโรงเรียน, ลายเซ็นหมดอายุ | ปฏิเสธก่อนเข้าคิว ไม่มีแจ้งเตือน ไม่มี token และไม่มีข้อมูลผู้มีสิทธิ์หลุดในคำตอบ |
| กดส่งซ้ำ/เครือข่ายขาดหลัง commit/สองแท็บกดพร้อมกัน | คำขอเดียว connection เดียว ไม่มีคำขอซ้ำ และตรวจผลเดิมได้ |
| ยังไม่อนุมัติ / ปฏิเสธ / หมดอายุ / ยกเลิกชนกับอนุมัติ | ไม่เผย token ให้คำขอที่ไม่ผ่าน; หลัง ACK ยกเลิกต้องส่งคะแนนไม่ได้; ID เก่าที่ปิดแล้วไม่ฟื้น |
| เปิดหน้าเช็คชื่อ / ปิดเว็บแล้วกลับมา / Realtime หลุด | ไม่แทรกงานเช็คชื่อ เห็น badge และรายการจริงเมื่อโหลดใหม่ นักเรียนและ Guest อ่าน inbox หรือ subscribe ช่องครูไม่ได้ |
| อนุมัติแล้วตอบกลับช้า / รับ token แล้ว retry / พ้นเวลารับ token | ScanSob ไม่ขึ้นว่าเชื่อมแล้วก่อนบันทึก token; status ที่ยืนยันซ้ำไม่ทำให้ token เปลี่ยน; หากเลยเวลารับ token สามารถปิด connection เดิมด้วย challenge ได้ก่อนขอใหม่ |
| ส่งคะแนนจำลองหลังอนุมัติแล้วถอน | MathQuest ได้ ACK และแสดงคะแนนในรายงานที่ถูกต้อง ส่งซ้ำไม่เพิ่มรายการ ถอนตามกติกาเดิม นักเรียนเห็นตามตัวเลือกเดิมเท่านั้น |
| ผู้ใช้เดิม, ปิดรับคำขอใหม่, จับคู่ใหม่และรีเซ็ตเทอม | Active connections เดิมไม่หลุดเพราะ Deploy หรือปิดรับคำขอใหม่ คะแนนเก่าไม่กลับมาเผยแพร่เอง ไม่ฟื้นคำขอเก่าหลังรีเซ็ต |
| UX และ responsive | ทดสอบ 390px/768px/1280px, อีเมลยาว, คีย์บอร์ด, focus, screen reader และ reduced motion ไม่มีปุ่มล้น; ใช้ Impeccable `shape`, `clarify`, `adapt`, `audit` ในงานพัฒนาจริง |

ส่งผลกลับให้ทั้งสองทีม: commit IDs, รายชื่อ migration ใหม่, เวอร์ชัน Edge Function/เว็บที่ทดสอบ, ผลการจับคู่และส่งคะแนนจำลอง, ปัญหาค้างและวิธีปิดโหมดใหม่ ห้ามแนบ secret, token หรือข้อมูลนักเรียนจริง

ชุดทดสอบฝั่ง MathQuest: `node scripts/test-scansob-signed-pairing.cjs` (HTTP + ฐานข้อมูลจำลอง + สิทธิ์ inbox/Broadcast), `node scripts/test-scansob.cjs`, `node scripts/test-scansob-recovery.cjs` และ `node scripts/test-scansob-ui.cjs` (Playwright กับข้อมูลจำลอง) ให้ตั้ง `SQL_QA_MODULE_ROOT` และ `NODE_PATH` ตาม [Receiver Guide](20261015-scansob-receiver.md) การผ่านในเครื่องยังไม่ยืนยันว่า ScanSob รุ่นที่ Deploy อยู่ส่งคำขอรูปแบบใหม่ได้

## เอกสารประกอบ

- MathQuest: [Receiver Guide](20261015-scansob-receiver.md), [Recovery Handoff](20261015-scansob-recovery-handoff.md)
- ScanSob: `docs/MATHQUEST_RECEIVER_HANDOFF.md`, `docs/MATHQUEST_SCORE_INTEGRATION.md`, `docs/MATHQUEST_CLOSED_TERM_WITHDRAWAL.md`
