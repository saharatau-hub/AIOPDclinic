/**
 * Tech Tool OPD Card + Follow-up (Clinic Templates)
 * Node 20+
 *
 * ENV ตัวอย่าง (.env)
 *   OPENAI_API_KEY=sk-...
 *   OPENAI_MODEL=gpt-4o-mini
 *   TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
 *   BASIC_USER=admin
 *   BASIC_PASS=1234
 *   PORT=3001
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const BASIC_USER = process.env.BASIC_USER || '';
const BASIC_PASS = process.env.BASIC_PASS || '';

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- Middleware ----------
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(cors());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// ---------- Basic Auth ----------
if (BASIC_USER && BASIC_PASS) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/healthz') || req.path.startsWith('/public')) return next();
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="OPD"');
      return res.status(401).send('Authentication required.');
    }
    const [u, p] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (u === BASIC_USER && p === BASIC_PASS) return next();
    res.set('WWW-Authenticate', 'Basic realm="OPD"');
    return res.status(401).send('Invalid credentials.');
  });
}

const upload = multer({ storage: multer.memoryStorage() });

// ---------- Clinic Templates ----------
const CLINICS = {
  neuromed: {
    name: 'Neurology Medicine',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยาใหม่)', 'FBS/HbA1c (ถ้ามี DM)', 'Lipid profile (ตามจำเป็น)'],
      imaging: ['MRI/CT ตามอาการและข้อบ่งชี้'],
      meds: ['ทบทวน adherence/AE ของยา neuro', 'ปรับยาเฉพาะตามอาการ'],
      counsel: ['สังเกต red flags ทางระบบประสาท', 'ป้องกันหกล้ม', 'นอน โภชนาการ ออกกำลังกาย'],
      monitor: ['อาการเด่น การเดิน คำพูด'],
      red: ['อ่อนแรง ชาฉับพลัน', 'พูดลำบาก ตามัวเฉียบพลัน', 'ชักต่อเนื่อง'],
      team: ['Rehab PT OT ตามจำเป็น'],
      tele: true
    },
    promptHint: `เน้นสรุปอาการระบบประสาท ตรวจโฟกัส CN มอเตอร์ เซนซอรี การเดิน และแผนติดตามที่จำเป็น`
  },
  neurosx: {
    name: 'Neurosurgery',
    followup: {
      default_window_days: 14,
      tests: ['CBC (post-op ถ้าจำเป็น)', 'Electrolytes (ถ้าสงสัย SIADH/DI)'],
      imaging: ['CT/MRI follow-up ตามชนิดผ่าตัด'],
      meds: ['Pain control', 'Antibiotics', 'DVT prophylaxis'],
      counsel: ['การดูแลแผลและสังเกตติดเชื้อ', 'ข้อจำกัดกิจกรรม'],
      monitor: ['ไข้ ปวดแผล แผลบวมแดง', 'Neurologic status baseline'],
      red: ['แผลมีหนอง', 'ปวดศีรษะรุนแรง', 'ซึมลง ชัก'],
      team: ['Neuro ICU Functional team'],
      tele: false
    },
    promptHint: `เพิ่มหัวข้อภาวะหลังผ่าตัด การดูแลแผล คำแนะนำกลับบ้าน และ red flags`
  },
  rehab: {
    name: 'Rehabilitation',
    followup: {
      default_window_days: 21,
      tests: ['Spasticity assessment (ถ้าจำเป็น)'],
      meds: ['ปรับ antispastic agents analgesics'],
      counsel: ['โปรแกรม PT OT SLT ที่บ้าน', 'ป้องกันหกล้ม แผลกดทับ'],
      monitor: ['Goal attainment Pain scale'],
      red: ['ปวดมากผิดปกติ', 'แผลกดทับ', 'ล้มถี่ขึ้น'],
      team: ['PT OT SLT Nutrition'],
      tele: true
    },
    promptHint: `เน้นเป้าหมายฟังก์ชัน โปรแกรม PT OT SLT อุปกรณ์ช่วยเดิน ADL`
  },
  psych: {
    name: 'Psychiatry',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยาเมตาบอลิก)', 'Lipid/Glucose (ถ้าใช้ SGA)'],
      meds: ['ปรับ SSRIs/SNRIs/SGA', 'ตรวจ drug interaction'],
      counsel: ['สัญญาณเตือนซึมเศร้ารุนแรง', 'การนอน การจัดการความเครียด'],
      monitor: ['PHQ-9 GAD-7', 'Side-effect checklist'],
      red: ['คิดทำร้ายตนเอง/ผู้อื่น', 'สับสนเฉียบพลัน', 'EPS รุนแรง'],
      team: ['Psychology Social Work Family'],
      tele: true
    },
    promptHint: `สรุปอารมณ์ ความคิด พฤติกรรม ประเมินความปลอดภัย และแผนติดตามยา`
  },
  oph: {
    name: 'Ophthalmology',
    followup: {
      default_window_days: 14,
      tests: ['Visual acuity', 'IOP', 'OCT/Visual field'],
      meds: ['ปรับตารางหยอดตา ยาลดความดันตา'],
      counsel: ['เทคนิคหยอดตา', 'หลีกเลี่ยงขยี้ตา'],
      monitor: ['ปวดตา ตามัว แสงแฟลช'],
      red: ['ปวดตารุนแรง', 'สายตาลดเฉียบพลัน', 'ตาแดงมาก'],
      team: ['Neuro-ophthalmology'],
      tele: true
    },
    promptHint: `ระบุ VA IOP สี field และเน้นคำแนะนำการใช้ยาหยอดตา`
  }
};

// ---------- Helper ----------
function buildThaiPrompt(text, clinicKey = 'neuromed') {
  const c = CLINICS[clinicKey] || CLINICS.neuromed;
  return `
คุณเป็นแพทย์ในคลินิก ${c.name}
สรุป "OPD Card ภาษาไทย" จากข้อความต่อไปนี้ ให้สั้น ครบ เข้าใจง่าย:
- Chief Complaint
- Present Illness
- Past History / Meds / Allergy
- Physical Exam (เฉพาะจุดสำคัญ)
- Assessment + Plan
แนวทางเฉพาะคลินิก: ${c.promptHint}

--- ข้อความดิบ ---
${text.trim()}
`.trim();
}

function buildFollowupTemplate(clinicKey, ctx = '', risk = 'routine') {
  const f = CLINICS[clinicKey]?.followup || CLINICS.neuromed.followup;
  const days = f.default_window_days + (risk === 'high' ? -7 : risk === 'urgent' ? -3 : 0);
  return {
    clinic: CLINICS[clinicKey]?.name || 'Neurology',
    risk,
    days,
    context: ctx,
    tests: f.tests,
    imaging: f.imaging || [],
    meds: f.meds,
    counsel: f.counsel,
    monitor: f.monitor,
    red: f.red,
    team: f.team,
    tele: f.tele
  };
}

// ---------- Routes ----------
app.get('/api/healthz', (_, r) => r.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/debug/env', (_, r) => r.json({
  ok: true,
  node: process.version,
  model: OPENAI_MODEL,
  has_api_key: !!process.env.OPENAI_API_KEY
}));

// summarize from text with fallback
app.post('/api/opd/from-text', async (req, res) => {
  const { rawText = '', clinicKey = 'neuromed' } = req.body || {};
  if (!rawText.trim()) return res.status(400).json({ ok: false, error: 'no text' });
  const prompt = buildThaiPrompt(rawText, clinicKey);
  const models = [OPENAI_MODEL, 'gpt-4o-mini', 'gpt-4o'];

  let lastErr;
  for (const m of models) {
    try {
      const r = await openai.responses.create({ model: m, input: prompt, temperature: 0.2 });
      const out = r.output_text?.trim?.() || r?.content?.[0]?.text?.trim?.() || '';
      if (out) return res.json({ ok: true, clinicKey, model_used: m, summary: out });
    } catch (e) {
      lastErr = e;
      console.error('[from-text]', m, e?.status, e?.message);
      if (e?.status === 401) break;
    }
  }
  res.status(500).json({ ok: false, error: 'summarization failed', message: lastErr?.message });
});

// upload audio
app.post('/api/opd/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    const { clinicKey = 'neuromed' } = req.body;
    const f = new File([req.file.buffer], req.file.originalname || 'audio.webm', { type: req.file.mimetype || 'audio/webm' });

    let text = '';
    try {
      const tr = await openai.audio.transcriptions.create({ file: f, model: TRANSCRIBE_MODEL, language: 'th' });
      text = tr?.text?.trim?.() || '';
    } catch {
      const tr = await openai.audio.transcriptions.create({ file: f, model: 'whisper-1', language: 'th' });
      text = tr?.text?.trim?.() || '';
    }

    const prompt = buildThaiPrompt(text, clinicKey);
    const r = await openai.responses.create({ model: OPENAI_MODEL, input: prompt, temperature: 0.2 });
    const summary = r.output_text?.trim?.() || r?.content?.[0]?.text?.trim?.() || '';
    res.json({ ok: true, transcript: text, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'upload failed', message: e.message });
  }
});

// follow-up
app.post('/api/followup/from-text', (req, res) => {
  const { clinicKey = 'neuromed', contextText = '', riskLevel = 'routine' } = req.body;
  const plan = buildFollowupTemplate(clinicKey, contextText, riskLevel);
  res.json({ ok: true, structured: plan });
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
