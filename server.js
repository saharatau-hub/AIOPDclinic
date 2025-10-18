/**
 * Tech Tool OPD Card + Follow-up (Clinic Templates)
 * Node 20+ (รองรับ File/Blob) | Express API + Static UI
 *
 * ENV ตัวอย่าง (.env):
 *   OPENAI_API_KEY=sk-...
 *   OPENAI_MODEL=o1-mini
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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'o1-mini';
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const BASIC_USER = process.env.BASIC_USER || '';
const BASIC_PASS = process.env.BASIC_PASS || '';

const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- Security / Middleware --------
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use(cors());
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// Basic Auth (ยกเว้น healthz และไฟล์สาธารณะ)
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

// Upload (memory)
const upload = multer({ storage: multer.memoryStorage() });

// -------- Clinic Templates (ไม่จำเพาะโรค) --------
const CLINICS = {
  neuromed: {
    name: 'Neurology Medicine',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยาใหม่)', 'FBS/HbA1c (ถ้ามี DM)', 'Lipid profile (ตามจำเป็น)'],
      imaging: ['MRI/CT ตามอาการและข้อบ่งชี้'],
      meds: ['ทบทวน adherence/AE ของยา neuro', 'ปรับยาเฉพาะตามอาการ'],
      counsel: ['สังเกต red flags ทางระบบประสาท', 'ป้องกันหกล้ม', 'นอน/โภชนาการ/ออกกำลังกาย'],
      monitor: ['อาการเด่น, การเดิน, คำพูด'],
      red: ['อ่อนแรง/ชาฉับพลัน', 'พูดลำบาก/ตามัวเฉียบพลัน', 'ชักต่อเนื่อง'],
      team: ['Rehab/PT/OT ตามจำเป็น'],
      tele: true
    },
    promptHint: เน้นสรุปอาการระบบประสาท, ตรวจโฟกัส CN/มอเตอร์/เซนซอรี/การเดิน และแผนติดตามที่จำเป็น
  },
  neurosx: {
    name: 'Neurosurgery',
    followup: {
      default_window_days: 14,
      tests: ['CBC (post-op ถ้าจำเป็น)', 'Electrolytes (ถ้าสงสัย SIADH/DI)'],
      imaging: ['CT/MRI follow-up ตามชนิดผ่าตัด/ภาวะเลือดออก/มวลก้อน'],
      meds: ['Pain control', 'Antibiotics (ตามแผลผ่าตัด)', 'DVT prophylaxis (ตามข้อบ่งชี้)'],
      counsel: ['การดูแลแผลและสังเกตติดเชื้อ', 'ข้อจำกัดกิจกรรม'],
      monitor: ['ไข้/ปวดแผล/แผลบวมแดง', 'Neurologic status baseline'],
      red: ['แผลมีหนอง/บวมแดงมาก', 'ปวดศีรษะรุนแรงผิดปกติ', 'ซึมลง/ชัก'],
      team: ['Neuro ICU/Functional team ตามเคส'],
      tele: false
    },
    promptHint: เพิ่มหัวข้อภาวะหลังผ่าตัด/การดูแลแผล/คำแนะนำก่อนกลับบ้าน และ red flags
  },
  rehab: {
    name: 'Physical Medicine & Rehabilitation',
    followup: {
      default_window_days: 21,
      tests: ['Spasticity assessment scale (ถ้าจำเป็น)'],
      imaging: [],
      meds: ['ปรับ antispastic agents/analgesics ตามเป้าหมายฟื้นฟู'],
      counsel: ['โปรแกรม PT/OT/SLT ที่บ้าน', 'ป้องกันหกล้ม/แผลกดทับ'],
      monitor: ['Goal-attainment diary', 'Pain/fatigue scale'],
      red: ['ปวดมากผิดปกติ', 'เกิดแผลกดทับ', 'ล้มถี่ขึ้น'],
      team: ['PT/OT/SLT/Nutrition'],
      tele: true
    },
    promptHint: เน้นเป้าหมายฟังก์ชัน, โปรแกรม PT/OT/SLT, อุปกรณ์ช่วยเดิน/ADL และตัวชี้วัดความก้าวหน้า
  },
  psych: {
    name: 'Psychiatry',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยาเมตาบอลิก)', 'Lipid/Glucose (ถ้าใช้ SGA)'],
      imaging: [],
      meds: ['ปรับ SSRIs/SNRIs/SGA ตามอาการและผลข้างเคียง', 'ตรวจ drug–interaction'],
      counsel: ['สัญญาณเตือนซึมเศร้ารุนแรง/คิดทำร้ายตนเอง', 'การนอน/การจัดการความเครียด'],
      monitor: ['PHQ-9 / GAD-7 / อื่น ๆ', 'Side-effect checklist'],
      red: ['มีความคิดทำร้ายตนเอง/ผู้อื่น', 'สับสนเฉียบพลัน', 'EPS รุนแรง'],
      team: ['Psychology / Social Work / Family meeting'],
      tele: true
    },
    promptHint: สรุปอารมณ์/ความคิด/พฤติกรรม ประเมินความปลอดภัย และแผนติดตามยาแบบปฏิบัติได้
  },
  oph: {
    name: 'Ophthalmology',
    followup: {
      default_window_days: 14,
      tests: ['Visual acuity', 'Color vision', 'IOP', 'OCT/Visual field (ถ้าจำเป็น)'],
      imaging: [],
      meds: ['ปรับตารางหยอดตา/สเตียรอยด์ตา/ยาลดความดันตา ตามข้อบ่งชี้'],
      counsel: ['เทคนิคหยอดตาที่ถูกต้อง', 'หลีกเลี่ยงการขยี้ตา/สิ่งระคายเคือง'],
      monitor: ['ปวดตา/ตามัว/เห็นแสงแฟลช'],
      red: ['ปวดตารุนแรง', 'สายตาลดลงเฉียบพลัน', 'ตาแดงมาก/ขี้ตาเยอะผิดปกติ'],
      team: ['Neuro-ophthalmology (ถ้าสงสัยเกี่ยวข้องระบบประสาท)'],
      tele: true
    },
    promptHint: ระบุ VA/IOP/สี/field (ถ้ามี) และเน้นคำแนะนำการใช้ยาหยอดตา
  }
};

// -------- Helper Functions --------
function buildThaiPrompt(rawText, clinicKey = 'neuromed') {
  const c = CLINICS[clinicKey] || CLINICS.neuromed;
  return `
คุณเป็นแพทย์ในคลินิก ${c.name}
สรุป "OPD Card ภาษาไทย" จากข้อความต่อไปนี้ เป็นหัวข้อชัดเจน อ่านง่าย กระชับ:
- Chief Complaint
- Present Illness (+ ROS ถ้ามี)
- Past History / Meds / Allergy / Risk (ถ้ามี)
- Physical Examination (โฟกัสตามคลินิก)
- Assessment: Working Dx / DDX / เหตุผลสั้น ๆ
- Plan: Investigation / Treatment (Rx) / Advice & Follow-up

แนวทางเฉพาะคลินิก:
${c.promptHint}

--- ข้อความดิบ ---
${String(rawText || '').trim()}
`.trim();
}

function buildFollowupTemplate(clinicKey = 'neuromed', contextText = '', riskLevel = 'routine') {
  const f = CLINICS[clinicKey]?.followup || CLINICS.neuromed.followup;
  const days = f.default_window_days + (riskLevel === 'high' ? -7 : riskLevel === 'urgent' ? -3 : 0);
  return {
    clinic_key: clinicKey,
    clinic_name: CLINICS[clinicKey]?.name || CLINICS.neuromed.name,
    risk_level: riskLevel,
    follow_up_window_days: Math.max(3, days),
    context_brief: String(contextText || '').trim().slice(0, 600),
    tests_to_order: [...f.tests],
    imaging_or_procedures: [...(f.imaging || [])],
    medication_actions: [...f.meds],
    counseling_points: [...f.counsel],
    monitoring_params: [...f.monitor],
    red_flags_for_early_return: [...f.red],
    referral_or_multidisciplinary: [...f.team],
    telemed_ok: !!f.tele
  };
}

function renderFollowupMarkdown(fp) {
  const A = (x) => (Array.isArray(x) ? x : []).filter(Boolean);
  const out = [];
  out.push(`**แผนติดตาม (${fp.clinic_name})**`);
  out.push(`- ระดับความเสี่ยง: **${fp.risk_level.toUpperCase()}**`);
  out.push(`- นัดติดตามใน: **${fp.follow_up_window_days} วัน**`);
  if (fp.context_brief) out.push(`- บริบท: ${fp.context_brief}`);
  if (A(fp.tests_to_order).length) { out.push(`\n**Tests/Labs:**`); A(fp.tests_to_order).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.imaging_or_procedures).length) { out.push(`\n**Imaging/Procedures:**`); A(fp.imaging_or_procedures).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.medication_actions).length) { out.push(`\n**การจัดการยา:**`); A(fp.medication_actions).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.counseling_points).length) { out.push(`\n**ประเด็นให้คำแนะนำผู้ป่วย:**`); A(fp.counseling_points).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.monitoring_params).length) { out.push(`\n**ตัวแปรที่ต้องติดตาม:**`); A(fp.monitoring_params).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.red_flags_for_early_return).length) { out.push(`\n**Red flags กลับมาพบแพทย์ก่อนนัด:**`); A(fp.red_flags_for_early_return).forEach(v => out.push(`- ${v}`)); }
  if (A(fp.referral_or_multidisciplinary).length) { out.push(`\n**ทีมสหสาขา/ส่งต่อ:**`); A(fp.referral_or_multidisciplinary).forEach(v => out.push(`- ${v}`)); }
  out.push(`\n**Telemedicine:** ${fp.telemed_ok ? 'เหมาะสม (OK)' : 'ไม่เหมาะสม'}`);
  return out.join('\n');
}

// -------- Routes --------
app.get('/api/healthz', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// สรุปจากข้อความ
app.post('/api/opd/from-text', async (req, res) => {
  try {
    const { rawText = '', clinicKey = 'neuromed' } = req.body || {};
    if (!rawText.trim()) return res.status(400).json({ ok: false, error: 'rawText required' });
    const prompt = buildThaiPrompt(rawText, clinicKey);
    const resp = await openai.responses.create({ model: OPENAI_MODEL, input: prompt, temperature: 0.2 });
    const summary = resp.output_text?.trim?.() || resp?.content?.[0]?.text?.trim?.() || '';
    res.json({ ok: true, clinicKey, summary });
  } catch {
    res.status(500).json({ ok: false, error: 'summarization failed' });
  }
});

// อัปโหลดเสียง -> ถอดเสียง -> สรุป
app.post('/api/opd/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    const { clinicKey = 'neuromed' } = req.body || {};
    const file = new File([req.file.buffer], req.file.originalname || 'audio.webm', { type: req.file.mimetype || 'audio/webm' });

    let text = '';
    try {
      const tr = await openai.audio.transcriptions.create({ file, model: TRANSCRIBE_MODEL, language: 'th' });
      text = tr?.text?.trim?.() || '';
    } catch {
      const tr = await openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'th' });
      text = tr?.text?.trim?.() || '';
    }
    if (!text) return res.status(500).json({ ok: false, error: 'transcription empty' });

    const prompt = buildThaiPrompt(text, clinicKey);
    const resp = await o