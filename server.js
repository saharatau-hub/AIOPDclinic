/**
 * Tech Tool OPD Card + Follow-up + Coaching (Patient/Clinician/Deep Plan)
 * Node 20+
 *
 * ENV ตัวอย่าง (.env):
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
      imaging: ['CT/MRI follow-up ตามชนิดผ่าตัด/ภาวะเลือดออก/มวลก้อน'],
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

// ---------- Helper: safe LLM call ----------
async function callLLM(model, input) {
  const payload = { model, input };
  // reasoning models (o1/o3) ไม่รองรับ temperature
  if (!/^o\d/i.test(model)) {
    payload.temperature = 0.2;
  }
  return openai.responses.create(payload);
}

// ---------- Prompt builders ----------
function buildThaiPrompt(text, clinicKey = 'neuromed') {
  const c = CLINICS[clinicKey] || CLINICS.neuromed;
  return `
คุณเป็นแพทย์ในคลินิก ${c.name}
สรุป "OPD Card ภาษาไทย" จากข้อความต่อไปนี้ ให้สั้น ครบ เข้าใจง่าย:
- Chief Complaint
- Present Illness (+ ROS ถ้ามี)
- Past History / Meds / Allergy / Risk
- Physical Exam (เฉพาะจุดสำคัญ)
- Assessment + Plan
แนวทางเฉพาะคลินิก: ${c.promptHint}

--- ข้อความดิบ ---
${String(text || '').trim()}
`.trim();
}

function buildFollowupTemplate(clinicKey, ctx = '', risk = 'routine') {
  const f = CLINICS[clinicKey]?.followup || CLINICS.neuromed.followup;
  const days = f.default_window_days + (risk === 'high' ? -7 : risk === 'urgent' ? -3 : 0);
  return {
    clinic: CLINICS[clinicKey]?.name || 'Neurology',
    risk,
    days: Math.max(3, days),
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

function renderFollowupMarkdown(fp) {
  const A = (x)=>Array.isArray(x)?x:[];
  const out=[];
  out.push(`**แผนติดตาม (${fp.clinic})**`);
  out.push(`- ระดับความเสี่ยง: **${fp.risk.toUpperCase()}**`);
  out.push(`- นัดติดตามใน: **${fp.days} วัน**`);
  if (fp.context) out.push(`- บริบท: ${fp.context}`);
  if (A(fp.tests).length){ out.push(`\n**Tests/Labs:**`); A(fp.tests).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.imaging).length){ out.push(`\n**Imaging/Procedures:**`); A(fp.imaging).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.meds).length){ out.push(`\n**การจัดการยา:**`); A(fp.meds).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.counsel).length){ out.push(`\n**คำแนะนำผู้ป่วย:**`); A(fp.counsel).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.monitor).length){ out.push(`\n**ตัวแปรติดตาม:**`); A(fp.monitor).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.red).length){ out.push(`\n**Red flags กลับก่อนนัด:**`); A(fp.red).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.team).length){ out.push(`\n**ทีมสหสาขา/ส่งต่อ:**`); A(fp.team).forEach(v=>out.push(`- ${v}`)); }
  out.push(`\n**Telemedicine:** ${fp.tele ? 'เหมาะสม (OK)' : 'ไม่เหมาะสม'}`);
  return out.join('\n');
}

function buildCoachPrompt(rawText, clinicKey='neuromed'){
  const clinic = CLINICS[clinicKey]?.name || 'Neurology';
  const hint   = CLINICS[clinicKey]?.promptHint || '';
  return `
คุณเป็นแพทย์คลินิก ${clinic}.
จากข้อมูลผู้ป่วยต่อไปนี้ จงสร้างผลลัพธ์ 3 ส่วนเป็นภาษาไทยดังนี้:
[1] คำแนะนำผู้ป่วย (ง่าย เข้าใจเร็ว 8–12 ข้อ)
[2] คำแนะนำแพทย์ (เช็กลิสต์ 10–15 ข้อ)
[3] แผนเชิงลึก (Today / 1 สัปดาห์ / 1 เดือน)
ตอบเป็น JSON ตามคีย์ด้านล่างเท่านั้น:
{
 "patient_advice_md": "...",
 "clinician_brief_md": "...",
 "deep_plan_md": "...",
 "structured": { "patient_tasks_daily":[], "patient_red_flags":[], "clinician_checklist":[], "timeline":{ "today":[],"week_1":[],"month_1":[] } }
}
บริบทผู้ป่วย:
${rawText}
ข้อเน้นเฉพาะคลินิก:
${hint}
`.trim();
}

// ---------- Routes ----------
app.get('/api/healthz', (_, r) => r.json({ ok: true, time: new Date().toISOString() }));

// Summarize text → OPD
app.post('/api/opd/from-text', async (req, res) => {
  const { rawText = '', clinicKey = 'neuromed', forceModel } = req.body || {};
  if (!rawText.trim()) return res.status(400).json({ ok:false, error:'no text' });

  const prompt = buildThaiPrompt(rawText, clinicKey);
  const models = forceModel === 'o3'
    ? ['o3', 'gpt-4.1', 'gpt-4o-mini']
    : [OPENAI_MODEL, 'gpt-4.1', 'gpt-4o-mini'];

  let lastErr;
  for (const m of models) {
    try {
      const r = await callLLM(m, prompt);
      const out = r.output_text?.trim?.() || r?.content?.[0]?.text?.trim?.() || '';
      if (out) return res.json({ ok:true, model_used:m, clinicKey, summary:out });
    } catch (e) {
      lastErr = e;
      console.error('[from-text]', m, e?.status, e?.message);
    }
  }
  res.status(500).json({ ok:false, error:'summarization failed', message:lastErr?.message });
});

// Upload audio → transcribe → summarize
app.post('/api/opd/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok:false, error:'no file' });
    const { clinicKey='neuromed' } = req.body || {};
    const file = new File([req.file.buffer], req.file.originalname || 'audio.webm', { type: req.file.mimetype || 'audio/webm' });

    let text = '';
    try {
      const tr = await openai.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, language:'th' });
      text = tr?.text?.trim?.() || '';
    } catch {
      const tr = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language:'th' });
      text = tr?.text?.trim?.() || '';
    }
    if (!text) return res.status(500).json({ ok:false, error:'transcription empty' });

    const prompt = buildThaiPrompt(text, clinicKey);
    const r = await callLLM(OPENAI_MODEL, prompt);
    const summary = r.output_text?.trim?.() || r?.content?.[0]?.text?.trim?.() || '';
    res.json({ ok:true, clinicKey, transcript:text, summary });
  } catch (e) {
    console.error('[upload-audio]', e?.status, e?.message);
    res.status(500).json({ ok:false, error:'upload failed', message:e?.message });
  }
});

// Follow-up template
app.post('/api/followup/from-text', (req, res) => {
  const { clinicKey='neuromed', contextText='', riskLevel='routine' } = req.body || {};
  const plan = buildFollowupTemplate(clinicKey, contextText, riskLevel);
  const markdown = renderFollowupMarkdown(plan);
  res.json({ ok:true, structured:plan, markdown });
});

// Coaching (Patient advice + Clinician brief + Deep plan)
app.post('/api/coach', async (req, res) => {
  const { rawText='', clinicKey='neuromed', forceModel } = req.body || {};
  if (!rawText.trim()) return res.status(400).json({ ok:false, error:'no text' });

  const prompt = buildCoachPrompt(rawText, clinicKey);
  const models = forceModel === 'o3'
    ? ['o3', 'gpt-4.1', 'gpt-4o-mini']
    : [OPENAI_MODEL, 'gpt-4.1', 'gpt-4o-mini'];

  let lastErr;
  for (const m of models) {
    try {
      const r = await callLLM(m, prompt);
      const txt = r.output_text?.trim?.() || r?.content?.[0]?.text?.trim?.() || '';
      const clean = txt.replace(/```json|```/g,'').trim();
      const json = JSON.parse(clean);
      return res.json({ ok:true, model_used:m, ...json });
    } catch (e) {
      lastErr = e;
      console.error('[coach]', m, e?.status, e?.message);
    }
  }
  res.status(500).json({ ok:false, error:'coach failed', message:lastErr?.message });
});

// ---------- Static ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, r) => r.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
