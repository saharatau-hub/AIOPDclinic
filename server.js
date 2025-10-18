// server.js — Clinic Web (Express + Basic Auth + Summarize)
// Node 20+, type: module

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Middlewares ----------
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// กัน brute-force เบื้องต้น (รวมหน้าเว็บและ API)
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

// ---------- Basic Auth (ล็อกทั้งเว็บ/ไฟล์ static + API) ----------
const BASIC_USER = process.env.BASIC_USER || '';
const BASIC_PASS = process.env.BASIC_PASS || '';
function requireBasicAuth(req, res, next) {
  // allow health check ไม่ต้องล็อกอิน
  if (req.path === '/healthz') return res.status(200).send('ok');

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) {
    res.set('WWW-Authenticate', 'Basic realm="Clinic Web"');
    return res.status(401).send('Authentication required.');
  }
  const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
  if (user === BASIC_USER && pass === BASIC_PASS) return next();

  res.set('WWW-Authenticate', 'Basic realm="Clinic Web"');
  return res.status(401).send('Invalid credentials.');
}
app.use(requireBasicAuth);

// ปุ่ม logout (บังคับให้เบราว์เซอร์ถามรหัสใหม่)
app.get('/logout', (req, res) => {
  res.set('WWW-Authenticate', 'Basic realm="Clinic Web"');
  return res.status(401).send('Logged out.');
});

// ---------- Static (หน้าเว็บ) ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// ---------- OpenAI ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// แผน/Template ภาษาไทย (เลือกใน UI)
const TEMPLATES = {
  general: 'ทั่วไป',
  neurology: 'ประสาทวิทยา',
  internal: 'อายุรแพทย์',
  soap: 'SOAP',
  physio: 'กายภาพบำบัด',
  neurosx: 'ศัลยกรรมประสาท',
  oph: 'จักษุวิทยา',
};

function buildThaiPrompt(templateKey, rawText) {
  const plan = templateKey || 'general';
  const base = (s) => s.trim();

  // โครงสรุปละเอียด (เวอร์ชัน 4.1-style prompt)
  const header =
    คุณเป็นแพทย์เวชปฏิบัติที่สรุป "OPD Card ภาษาไทย" อย่างละเอียดและอ่านง่าย  +
    ให้สรุปจากบทสนทนาหรือบันทึกแพทย์ด้านล่าง โดยจัดรูปแบบตาม "แผนที่เลือก"  +
    พร้อม Assessment/Plan ที่ชัดเจน และให้คำแนะนำทั้งผู้ป่วยและแพทย์ผู้ดูแล\n\n +
    หลักการสรุป:\n +
    • คัดสาระสำคัญอย่างย่อหน้า อ่านง่าย และมีหัวข้อย่อย\n +
    • แปลงภาษาให้สุภาพ ชัดเจน ลดคำซ้ำซ้อน/ภาษาพูด\n +
    • ใส่ข้อมูลเชิงคลินิกที่สังเกตได้ (ถ้ามี): ระดับความรุนแรง/ปัจจัยเสี่ยง/red flags\n +
    • แยก “Working Dx / DDX / Reasoning สั้นๆ”\n +
    • แผนการรักษา (Investigation/Medication/Advice & Follow-up) ให้เป็นข้อๆ\n +
    • เพิ่ม “คำแนะนำผู้ป่วย (Patient Advice)” และ “คำแนะนำแพทย์ (Doctor Notes)” สั้นกระชับ\n\n +
    แผนที่เลือก: ${TEMPLATES[plan] || 'ทั่วไป'}\n +
    --- ข้อความดิบ ---\n${base(rawText)}\n +
    --- จัดรูปแบบผลลัพธ์เป็น Markdown ภาษาไทย ---\n +
    ให้ใช้โครงตามแผนที่เลือก เช่น อายุรแพทย์/ประสาทวิทยา/กายภาพบำบัด/ศัลยกรรมประสาท/จักษุ/SOAP (เลือกให้เหมาะ)\n +
    `โดยยึดหัวข้อหลัก: Chief Complaint, Present Illness, ROS, PE (ถ้ามี), Assessment (Dx/DDX/เหตุผล), Plan (Investigation/Treatment/Advice-Follow-up), Patient Advice, Doctor Notes\n`;

  return header;
}

// ---------- Summarize (จากข้อความ) ----------
app.post('/summarize-from-text', async (req, res) => {
  try {
    const { text = '', template = 'general', model } = req.body || {};
    if (!text.trim()) return res.status(400).json({ ok: false, error: 'no text' });

    const prompt = buildThaiPrompt(template, text);

    const response = await openai.responses.create({
      model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: prompt,
    });

    // responses.create -> unified output
    const summary =
      response.output_text?.trim?.() ||
      response?.content?.[0]?.text?.trim?.() ||
      '';

    return res.json({ ok: true, summary });
  } catch (err) {
    console.error('[summarize] error', err);
    return res.status(500).json({ ok: false, error: 'summarize failed' });
  }
});

// ---------- Upload audio (รับไฟล์เสียง) ----------
// เก็บไว้ในหน่วยความจำ (ไม่เขียนดิสก์) และยอมรับ audio/* ส่วนใหญ่
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    // บางครั้งเบราว์เซอร์/ไคลเอนต์ส่งเป็น octet-stream -> ให้ผ่าน แล้วค่อยตรวจนามสกุลเอง
    if (
      file.mimetype.startsWith('audio/') ||
      file.mimetype === 'application/octet-stream'
    ) {
      return cb(null, true);
    }
    cb(new Error('UNSUPPORTED_MIME'));
  },
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB
});

app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });

    // ตรวจนามสกุลอย่างหยาบๆ เผื่อ mimetype ไม่ตรง
    const okNames = ['.wav', '.mp3', '.m4a', '.mp4', '.webm', '.ogg', '.oga', '.flac', '.mpeg', '.mpga'];
    const ext = (req.file.originalname || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
    if (!okNames.includes(ext)) {
      // รับได้ แต่แจ้งเตือน (เพื่อแก้ปัญหา "ไฟล์ .bin")
      console.warn('[upload-audio] unusual ext:', ext);
    }

    // ตอนนี้ยังไม่ได้ถอดเสียงที่ฝั่งเซิร์ฟเวอร์ (ขึ้นกับแพ็กเกจ OpenAI ที่คุณจะใช้)
    // ส่งกลับแค่สถานะและขนาด เพื่อให้ปุ่ม "ส่งไฟล์ขึ้นเซิร์ฟเวอร์" ทำงานไม่ error
    return res.json({
      ok: true,
      info: `รับไฟล์ ${req.file.originalname || '(no-name)'} ขนาด ${req.file.size} bytes`,
    });
  } catch (err) {
    console.error('[upload-audio] error', err);
    const code = String(err?.message || '');
    if (code.includes('UNSUPPORTED_MIME'))
      return res.status(400).json({ ok: false, error: '400 Unsupported file format' });
    return res.status(500).json({ ok: false, error: 'upload failed' });
  }
});

// (ตัวเลือก) อัปโหลดแล้วสรุปรวม: /upload-audio-and-summarize
// หมายเหตุ: ถ้าจะถอดเสียงจริง ให้ต่อ OpenAI transcription (เช่น whisper-1 / gpt-4o-mini-transcribe)
// ด้านล่างนี้เป็นโครงที่ส่งกลับเฉพาะผลทดสอบ
app.post('/upload-audio-and-summarize', upload.single('audio'), async (req, res) => {
  try {
    const { template = 'general' } = req.query || {};
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });

    // TODO: ถอดเสียงจริง -> ได้ textTranscript แล้วเรียก summarize-from-text
    const fakeTranscript = `**ไฟล์เสียง:** ${req.file.originalname || '(no-name)'} ขนาด ${req.file.size} bytes\n(เดโม: ยังไม่ได้ถอดเสียงจริง)`;

    const prompt = buildThaiPrompt(String(template), fakeTranscript);
    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      input: prompt,
    });
    const summary =
      response.output_text?.trim?.() ||
      response?.content?.[0]?.text?.trim?.() ||
      '';

    return res.json({ ok: true, transcript: fakeTranscript, summary });
  } catch (err) {
    console.error('[upload-audio-and-summarize] error', err);
    return res.status(500).json({ ok: false, error: 'upload+summarize failed' });
  }
});

// ---------- Health check ----------
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});