#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const BUCKET = "mathquest-storage";
const ROOT_PREFIX = "students";
const LIST_PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 1000;
const DELETE_CONFIRMATION = "DELETE-ALL-STUDENT-PHOTOS";

function printHelp() {
  console.log(`
ล้างรูปโปรไฟล์นักเรียนทั้งหมดจาก Supabase Storage

ค่าเริ่มต้นเป็น Dry Run: แสดงรายการที่จะลบโดยไม่แก้ไขข้อมูล

ตัวแปรแวดล้อมที่ต้องมี:
  SUPABASE_URL               URL ของโปรเจกต์ Supabase
  SUPABASE_SERVICE_ROLE_KEY  Service role key (แนะนำ)
  SUPABASE_ANON_KEY          ใช้แทนได้เมื่อ Storage/RLS policy อนุญาต

ตัวอย่าง PowerShell:
  $env:SUPABASE_URL="https://PROJECT.supabase.co"
  $env:SUPABASE_SERVICE_ROLE_KEY="SERVICE_ROLE_KEY"

  # ตรวจสอบจำนวนไฟล์ก่อน (ไม่ลบ)
  node .\\scripts\\clear-student-profile-photos.mjs

  # ลบจริง
  node .\\scripts\\clear-student-profile-photos.mjs --execute --confirm=${DELETE_CONFIRMATION}

คำเตือน:
  ควรรันตอนที่ไม่มีนักเรียนกำลังเปลี่ยนรูป สคริปต์แตะเฉพาะไฟล์ใต้
  ${BUCKET}/${ROOT_PREFIX}/ และจะล้าง students.photo_url หลังลบไฟล์สำเร็จทั้งหมดเท่านั้น
`.trim());
}

export function parseArgs(argv) {
  const args = new Set(argv);
  const confirmArg = argv.find((arg) => arg.startsWith("--confirm="));

  return {
    execute: args.has("--execute"),
    help: args.has("--help") || args.has("-h"),
    confirmation: confirmArg ? confirmArg.slice("--confirm=".length) : "",
  };
}

function normalizeSupabaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function assertSafeStudentPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  if (
    !normalized.startsWith(`${ROOT_PREFIX}/`) ||
    normalized.includes("/../") ||
    normalized.endsWith("/..") ||
    normalized.includes("/./") ||
    normalized.endsWith("/.")
  ) {
    throw new Error(`ปฏิเสธ Storage path ที่อยู่นอก ${ROOT_PREFIX}/: ${path}`);
  }
  return normalized;
}

function joinStoragePath(parent, child) {
  const safeChild = String(child || "");
  if (
    !safeChild ||
    safeChild === "." ||
    safeChild === ".." ||
    safeChild.includes("/") ||
    safeChild.includes("\\")
  ) {
    throw new Error(`พบชื่อไฟล์หรือโฟลเดอร์ที่ไม่ปลอดภัย: ${safeChild || "(ว่าง)"}`);
  }
  return `${parent}/${safeChild}`;
}

async function readResponse(response, context) {
  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object"
        ? data.message || data.error || JSON.stringify(data)
        : data || `${response.status} ${response.statusText}`;
    throw new Error(`${context}: ${detail}`);
  }

  return data;
}

export function createSupabaseAdminClient({
  supabaseUrl,
  supabaseKey,
  fetchImpl = globalThis.fetch,
}) {
  const baseUrl = normalizeSupabaseUrl(supabaseUrl);
  if (!baseUrl) throw new Error("ไม่พบ SUPABASE_URL");
  if (!supabaseKey) throw new Error("ไม่พบ SUPABASE_SERVICE_ROLE_KEY หรือ SUPABASE_ANON_KEY");
  if (typeof fetchImpl !== "function") throw new Error("Node.js รุ่นนี้ไม่รองรับ fetch");

  const authHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  return {
    async listFolder(prefix, limit = LIST_PAGE_SIZE, offset = 0) {
      const response = await fetchImpl(
        `${baseUrl}/storage/v1/object/list/${encodeURIComponent(BUCKET)}`,
        {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prefix,
            limit,
            offset,
            sortBy: { column: "name", order: "asc" },
          }),
        },
      );
      const data = await readResponse(response, `อ่าน Storage path ${prefix}`);
      if (!Array.isArray(data)) {
        throw new Error(`Storage ส่งข้อมูลผิดรูปแบบที่ ${prefix}`);
      }
      return data;
    },

    async deletePaths(paths) {
      const safePaths = paths.map(assertSafeStudentPath);
      if (!safePaths.length || safePaths.length > DELETE_BATCH_SIZE) {
        throw new Error(`จำนวนไฟล์ต่อชุดต้องอยู่ระหว่าง 1-${DELETE_BATCH_SIZE}`);
      }

      const response = await fetchImpl(
        `${baseUrl}/storage/v1/object/${encodeURIComponent(BUCKET)}`,
        {
          method: "DELETE",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prefixes: safePaths }),
        },
      );
      await readResponse(response, `ลบรูปจำนวน ${safePaths.length} ไฟล์`);
    },

    async countStudentsWithPhotoUrls() {
      let offset = 0;
      let count = 0;

      while (true) {
        const params = new URLSearchParams({
          select: "id,photo_url",
          photo_url: "not.is.null",
          limit: String(LIST_PAGE_SIZE),
          offset: String(offset),
        });
        const response = await fetchImpl(`${baseUrl}/rest/v1/students?${params}`, {
          headers: authHeaders,
        });
        const rows = await readResponse(response, "นับนักเรียนที่มี photo_url");
        if (!Array.isArray(rows)) throw new Error("ตาราง students ส่งข้อมูลผิดรูปแบบ");

        count += rows.filter((row) => String(row?.photo_url || "").trim()).length;
        if (rows.length < LIST_PAGE_SIZE) break;
        offset += rows.length;
      }

      return count;
    },

    async clearStudentPhotoUrls() {
      const response = await fetchImpl(
        `${baseUrl}/rest/v1/students?photo_url=not.is.null`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ photo_url: "" }),
        },
      );
      await readResponse(response, "ล้าง students.photo_url");
    },
  };
}

export async function collectStudentPhotoFiles(client) {
  const files = [];
  const visitedFolders = new Set();

  async function walk(prefix) {
    if (visitedFolders.has(prefix)) return;
    visitedFolders.add(prefix);

    let offset = 0;
    while (true) {
      const entries = await client.listFolder(prefix, LIST_PAGE_SIZE, offset);

      for (const entry of entries) {
        const path = joinStoragePath(prefix, entry?.name);
        const isFolder = entry?.id == null && entry?.metadata == null;

        if (isFolder) {
          await walk(path);
          continue;
        }

        files.push({
          path: assertSafeStudentPath(path),
          bytes: Math.max(0, Number(entry?.metadata?.size) || 0),
        });
      }

      if (entries.length < LIST_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  await walk(ROOT_PREFIX);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function runCleanup({
  client,
  execute = false,
  confirmation = "",
  logger = console,
}) {
  if (execute && confirmation !== DELETE_CONFIRMATION) {
    throw new Error(
      `ต้องยืนยันด้วย --confirm=${DELETE_CONFIRMATION} จึงจะลบข้อมูลจริง`,
    );
  }

  logger.log(`กำลังตรวจ ${BUCKET}/${ROOT_PREFIX}/ ...`);
  const [files, studentCount] = await Promise.all([
    collectStudentPhotoFiles(client),
    client.countStudentsWithPhotoUrls(),
  ]);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  logger.log(`พบไฟล์รูปนักเรียน ${files.length} ไฟล์ (${formatBytes(totalBytes)})`);
  logger.log(`พบนักเรียนที่มี photo_url ${studentCount} คน`);

  const preview = files.slice(0, 20);
  if (preview.length) {
    logger.log("ตัวอย่างไฟล์ที่จะลบ:");
    for (const file of preview) logger.log(`  - ${file.path}`);
    if (files.length > preview.length) {
      logger.log(`  ... และอีก ${files.length - preview.length} ไฟล์`);
    }
  }

  if (!execute) {
    logger.log("");
    logger.log("Dry Run เสร็จแล้ว ยังไม่มีข้อมูลถูกลบ");
    logger.log(
      `เมื่อตรวจรายการแล้วจึงรันพร้อม --execute --confirm=${DELETE_CONFIRMATION}`,
    );
    return { dryRun: true, fileCount: files.length, totalBytes, studentCount };
  }

  logger.warn("เริ่มลบจริง กรุณาอย่าให้นักเรียนเปลี่ยนรูปจนกว่าสคริปต์จะเสร็จ");
  for (let index = 0; index < files.length; index += DELETE_BATCH_SIZE) {
    const batch = files.slice(index, index + DELETE_BATCH_SIZE).map((file) => file.path);
    await client.deletePaths(batch);
    logger.log(`ลบแล้ว ${Math.min(index + batch.length, files.length)}/${files.length} ไฟล์`);
  }

  const remainingFiles = await collectStudentPhotoFiles(client);
  if (remainingFiles.length) {
    throw new Error(
      `ยังพบไฟล์ใน ${ROOT_PREFIX}/ อีก ${remainingFiles.length} ไฟล์ จึงยังไม่ล้าง photo_url`,
    );
  }

  await client.clearStudentPhotoUrls();
  logger.log(`ล้าง photo_url สำเร็จ ${studentCount} คน`);
  logger.log("เสร็จสมบูรณ์ นักเรียนสามารถเพิ่มรูปใหม่ได้");

  return { dryRun: false, fileCount: files.length, totalBytes, studentCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseKey = serviceRoleKey || anonKey;

  if (!supabaseUrl || !supabaseKey) {
    printHelp();
    throw new Error(
      "กรุณาตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY (หรือ SUPABASE_ANON_KEY)",
    );
  }

  if (!serviceRoleKey) {
    console.warn(
      "คำเตือน: กำลังใช้ SUPABASE_ANON_KEY การลบจะสำเร็จเฉพาะเมื่อ Storage/RLS policy อนุญาต",
    );
  }

  const client = createSupabaseAdminClient({ supabaseUrl, supabaseKey });
  await runCleanup({
    client,
    execute: args.execute,
    confirmation: args.confirmation,
  });
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`ล้มเหลว: ${error.message}`);
    process.exitCode = 1;
  });
}
