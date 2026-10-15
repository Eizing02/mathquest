# Google Login และการเชื่อมรหัสนักเรียน

## ขอบเขต

ใช้ Supabase Auth ของ MathQuest เดิม นักเรียนเข้า Google แล้วกรอกรหัส 5 หลัก ตรวจชื่อ/ห้องและกดยืนยันเอง ไม่มี OTP หรือครูอนุมัติ ตามรูปแบบ Onlinegame ที่ตรวจ ณ commit `414fa6ac28f026a4fc2bf11414d3438a7d362c15`

Google ยืนยันบัญชี Google เท่านั้น ไม่ได้พิสูจน์ความเป็นเจ้าของรหัสนักเรียน ผู้ที่รู้รหัสซึ่งยังไม่มีคนผูกอาจผูกก่อนเจ้าของจริง UNIQUE ป้องกันการผูกซ้ำ ไม่ได้ป้องกันการสวมรหัส ดังนั้นยังไม่ถือว่าผ่าน security gate สำหรับเผยแพร่คะแนนสอบส่วนบุคคลจาก ScanSob จนกว่าโรงเรียนยอมรับและกำหนดนโยบายนี้ชัดเจน งานนี้ยังไม่เพิ่มคะแนนสอบหรือเปิดการเชื่อม ScanSob

## สิทธิ์ครู

อนุญาต Google ที่ยืนยันอีเมล `piyawatpiwsiri@gmail.com` เท่านั้น การตรวจอยู่ใน SQL ผ่าน `auth.uid()`, Google identity, verified email และ Supabase session ที่ยังมีอยู่ ไม่รับอีเมล/role/auth user ID จาก request body หรือ user_metadata เป็นสิทธิ์ครู

หากทะเบียนมี TEACHER เพียงหนึ่งแถว SQL ใช้บัญชีครูเดิมโดยไม่สร้างบัญชีเพิ่ม หากมีหลายแถวหรือไม่มี ต้องกำหนด `teacher_student_id` ด้วยผู้ดูแลฐานข้อมูลหลังตรวจรหัสจริง:

```sql
-- อ่านเฉพาะข้อมูลที่จำเป็น ไม่อ่าน password
select id, name from public.students where role = 'TEACHER';

-- แทนค่า TEACHER_ID_FROM_QUERY ด้วยรหัสครูที่ตรวจแล้วก่อนรัน
update mathquest_private.google_login_config
set teacher_student_id = (
  select id from public.students
  where id = 'TEACHER_ID_FROM_QUERY' and role = 'TEACHER'
)
where singleton = true;
```

ไม่มีการให้สิทธิ์ครูเพราะชื่อบัญชี Google คล้ายชื่อครู หรือกรอกรหัสครูได้

## ข้อมูลเดิม

- ไม่ลบ/สร้างทะเบียนนักเรียนใหม่ ไม่เปลี่ยน ID ชื่อ ห้อง password รูปโปรไฟล์ คะแนน เหรียญ รายการแลกของ หรือสัตว์เลี้ยงระหว่าง migration
- เพิ่ม mapping ใน private schema จับคู่ `auth.users.id` กับ `students.id` แบบหนึ่งต่อหนึ่ง พร้อม audit/rate limits
- เปลี่ยนรหัสที่เชื่อมภายหลังได้ไม่เกิน 2 ครั้งใน 24 ชั่วโมง ไม่ย้ายประวัติ/คะแนนจากรหัสเดิม และไม่ให้เปลี่ยนขณะมีคาบเปิดสำหรับรหัสเดิมหรือใหม่
- รีเซ็ตเทอมล้าง progress ตามเดิม แต่คง Google mapping/audit ไว้ นักเรียนจึงไม่ต้องกรอกรหัสใหม่ทุกเทอม
- ไม่เอารูปหรือชื่อจาก Google มาทับทะเบียน/รูปโปรไฟล์เดิม
- local password ถูกเก็บไว้เพื่อไม่แก้ข้อมูลเดิม แต่ไม่ใช้ล็อกอิน ไม่เปิดให้อ่านจาก Data API และเลิกใช้หน้า OTP/ตั้ง password ครั้งแรก การกู้บัญชี Google ใช้ระบบ Google

## การจำกัดสิทธิ์ที่จำเป็น

แทน `*_public_all` ของตารางที่หน้าเว็บใช้ด้วย policies สำหรับครู Google และนักเรียนรหัสที่ผูกไว้ ไม่ปิดทุก read/write แบบไม่ย้ายเส้นทาง: อ่านโปรไฟล์/ประวัติใช้ RLS ส่วนการเช็ค PIN ซื้อสินค้าและจัดการสัตว์เลี้ยงย้ายไป RPC ที่ derive student ID จาก JWT และบันทึก transaction เดียว กติกายังคง 5/3/0 คะแนน, เปลี่ยนสัตว์เลี้ยงฟรี 3 ครั้ง แล้ว 25 เหรียญ, rename 3 ครั้ง และ snapshot แต้มพิเศษเดิม

แก้รูปโปรไฟล์ได้เฉพาะ `photo_url` ของตน ไม่แก้ role/รหัสผ่านจาก Browser ครูเพิ่มนักเรียนได้ แต่สร้าง role TEACHER ผ่านหน้าเพิ่มนักเรียนไม่ได้ Storage ยังอ่านภาพสาธารณะตามระบบเดิม แต่การเขียน/ลบจำกัดโฟลเดอร์เจ้าของหรือครู

SQL จะหยุดถ้าพบ custom RLS policy ที่ไม่รู้จัก ต้อง audit ก่อน ไม่ลบ policy อื่นแบบเดา ตรวจ grants/policies จริงและ custom Storage policies ด้วยก่อน cutover ไม่มีการอ้างว่า media ทั้งระบบเป็น private

## ตั้งค่า Google และ Supabase ก่อนเปิดใช้

1. ใน Google Cloud / Google Auth Platform สร้าง OAuth client ชนิด Web application ตั้ง audience ให้ครอบคลุมบัญชีที่โรงเรียนอนุญาต ถ้ายังเป็น Testing ให้เพิ่ม test users ที่ใช้ทดลองก่อน
2. Authorized JavaScript origins: `https://checkrean.vercel.app` เพิ่ม localhost/127.0.0.1 เฉพาะที่ใช้พัฒนา
3. Authorized redirect URI: ใช้ callback ที่แสดงใน Supabase Dashboard → Authentication → Sign In / Providers → Google (`https://<project-ref>.supabase.co/auth/v1/callback`) ไม่ใช่ URL callback ของ Onlinegame
4. เปิด Google Provider ใน Supabase MathQuest ใส่ Client ID และ Client Secret ใน Dashboard เท่านั้น ห้ามใส่ secret ใน JS, Git หรือส่งในแชต
5. Supabase Authentication → URL Configuration: Site URL เป็น `https://checkrean.vercel.app` และ Redirect URLs รวม URL เว็บจริงที่แอปกลับมา รวม local URL ที่ต้องใช้ทดสอบ ห้ามตั้ง wildcard กว้างข้ามโดเมนที่ไม่ควบคุม

เอกสารหลัก: https://supabase.com/docs/guides/auth/social-login/auth-google

## ลำดับ Deploy

1. สำรองฐานข้อมูลและ export รายงานที่ต้องการ ตรวจว่าตาราง/คอลัมน์/นโยบายตรงกับ staging และการตั้งค่า Google เสร็จแล้ว
2. ทดสอบ migration และ OAuth จริงบน staging ก่อน ใช้บัญชีครูที่กำหนด บัญชีนักเรียนอย่างน้อย 2 Google accounts และทะเบียนสังเคราะห์
3. กำหนดช่วง cutover สั้น ๆ ที่ไม่มีคาบ/รายการที่กำลังทำ ปิดคาบค้าง และหยุดการใช้งานหน้าเก่าชั่วคราว เพราะ SQL เปลี่ยนสิทธิ์และเลิก login เดิมทันที
4. รันเฉพาะ `20261015_01_google_login_student_links.sql` เมื่อ migration เดิมของ school/reset/pets/reports ติดตั้งครบแล้ว การรันซ้ำได้และไม่ลบข้อมูล
5. ตรวจ config ครูให้พร้อม แล้ว Deploy โค้ดที่มี `google-auth.js` และ `google-auth.css` พร้อมกัน หน้าเว็บเก่าจะล็อกอินด้วย password ไม่ได้หลัง cutover
6. Ctrl+F5 เข้าด้วย Google ครูที่กำหนด ทดสอบเปิด/ปิดคาบ สถิติ แก้ข้อมูล ร้านค้า ของฟรี รายงาน และการแจ้งเตือน จากนั้นทดลองนักเรียนตรวจชื่อ/ห้อง กดยืนยัน รีเฟรช ออก/เข้าใหม่ อัปโหลดรูป เช็ค PIN แลกของ และสัตว์เลี้ยง
7. ตรวจอีกครั้งว่าบัญชี Google อื่นไม่เข้าหน้าครู นักเรียนอ่านรหัสอื่น/แก้ role/insert คะแนนโดยตรงไม่ได้ และไม่มี secret ใน response/logs

**ห้ามรัน `supabase_complete.sql`, migration เก่าหรือ SQL ติดตั้งเดิมซ้ำหลัง Google cutover** เพราะอาจเปิด public policies หรือคืน RPC ตรวจ password แบบเดิม ไม่ใช้การ rollback ด้วยการเปิด `public_all` ใหม่ ปิดหน้าให้บริการชั่วคราวและแก้ด้วย forward migration หากเกิดเหตุ

## การล้างข้อมูลหลังใช้ Google

ครูยังต้องตรวจจำนวน ติ๊กยืนยัน และพิมพ์ “ลบทั้งหมด” แต่ไม่กรอกรหัสผ่านเก่า เซิร์ฟเวอร์กำหนดว่าต้อง OAuth ใหม่ภายใน 15 นาที หากเกินให้เข้า Google อีกครั้ง แล้วกลับมาตรวจและยืนยันลบเอง ไม่มีการลบอัตโนมัติหลัง callback

## ผูกรหัสผิดหรือถูกผูกก่อน

ครูตรวจหลักฐานกับทะเบียนนอกแอป ไม่บอก Gmail ของผู้ผูกเดิมแก่ผู้ร้อง ให้เจ้าของจริงเข้า Google เพื่อสร้าง Auth user ก่อน ผู้ดูแลฐานข้อมูลย้าย mapping ระหว่าง UUID ที่ตรวจแล้วใน transaction พร้อม audit ห้ามปล่อยรหัสว่างให้แย่งผูกใหม่ ห้ามแก้ `students.id` หรือย้ายประวัติคะแนนเป็นส่วนหนึ่งของการกู้บัญชี และต้องปิดคาบที่เกี่ยวข้องก่อน

ข้อมูล mapping อยู่ `mathquest_private.google_student_links` ดูอีเมลประกอบได้เฉพาะผู้ดูแล SQL ที่มีสิทธิ์ผ่านการ join `auth.users` ไม่มี API สาธารณะค้นหา Gmail การย้าย mapping ทำให้แท็บเก่าถูก RLS จำกัดทันทีและ guard reload ภายใน 30 วินาที/เมื่อกลับมาเปิดแท็บ

## การทดสอบที่ทำในเครื่อง

```powershell
node scripts/test-google-auth.cjs
node scripts/test-school-admin.cjs
node scripts/test-reports.cjs
# ตั้ง NODE_PATH ให้พบ Playwright ใน dependency runtime ก่อนรัน browser tests
node scripts/test-google-auth-ui.cjs
node scripts/test-school-ui.cjs
node scripts/test-reports.cjs --browser
```

SQL ใช้ฐานข้อมูลจำลอง PGlite และบัญชีสังเคราะห์ Browser ใช้ mock Supabase และบล็อก production requests ตรวจ PKCE config/UI/session flow/RLS contract ได้ แต่ **ไม่ใช่การทดสอบ OAuth กับ Google จริง**, Dashboard config, การลงชื่อในมือถือจริง หรือ Production Supabase ต้องทำ staging smoke test ก่อนเปิดจริง
