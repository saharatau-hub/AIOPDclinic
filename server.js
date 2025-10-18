/**
 * Tech Tool OPD Card + Clinic-based Follow-up
 * Clinics: neuromed, neurosx, rehab, psych, oph
 * Node 20+ (มี File/Blob)
 *
 * ENV (.env):
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
import { fileURLToPath } from 'url';
import path from 'path';
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

// ---------- Middleware ----------
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
    res.status(401).send('Invalid credentials.');
  });
}

const upload = multer({ storage: multer.memoryStorage() });

// ---------- Clinic presets ----------
const CLINICS = {
  neuromed: {
    name: 'Neurology Medicine',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยาใหม่)', 'Fasting glucose/HbA1c (ถ้ามี DM ร่วม)', 'Lipid profile (ตามจำเป็น)'],
      imaging: ['MRI/CT ตามอาการและข้อบ่งชี้'],
      meds: ['ทบทวน adherence/AE ของยา neuro-immunology/antiepileptics/anti-parkinsonism ตามบริบท'],
      counsel: ['สังเกต red flags ทางระบบประสาท', 'การป้องกันหกล้ม', 'การนอน/โภชนาการ/การออกกำลังกาย'],
      monitor: ['Neuro exam คร่าว ๆ ที่บ้าน (กำลังกล้ามเนื้อ/การเดิน/การพูด)', 'บันทึกอาการเด่น'],
      red: ['อ่อนแรง/ชาฉับพลัน', 'พูดลำบาก/ตามัวเฉียบพลัน', 'ชักต่อเนื่อง'],
      team: ['Rehab/PT/OT ตามความจำเป็น'],
      tele: true
    },
    promptHint: `เน้นสรุปอาการทางระบบประสาท ตรวจร่างกายโฟกัส CN/มอเตอร์/เซนซอรี/การเดิน และแผนตรวจติดตามที่จำเป็น`
  },
  neurosx: {
    name: 'Neurosurgery',
    followup: {
      default_window_days: 14,
      tests: ['CBC (post-op ถ้าจำเป็น)', 'Electrolytes (ถ้ามี SIADH/DI concern)'],
      imaging: ['CT/MRI follow-up ตามชนิดผ่าตัด/ภาวะเลือดออก/มวลก้อน'],
      meds: ['Pain control/antibiotics ตามแผลผ่าตัด', 'DVT prophylaxis ตามข้อบ่งชี้'],
      counsel: ['การดูแลแผลผ่าตัดและสังเกตการติดเชื้อ', 'ข้อควรระวังการยกของ/กิจกรรม'],
      monitor: ['ไข้/ปวดแผล/แผลบวมแดง', 'Neurologic status baseline เทียบเดิม'],
      red: ['แผลมีหนอง/บวมแดงมาก', 'ปวดศีรษะรุนแรงผิดปกติ', 'ซึมลง/ชัก'],
      team: ['Neuro ICU/Functional team ตามเคส'],
      tele: false
    },
    promptHint: `เพิ่มหัวข้อภาวะหลังผ่าตัด/การดูแลแผล การให้คำแนะนำก่อนกลับบ้าน และ red flags หลังผ่าตัด`
  },
  rehab: {
    name: 'Physical Medicine & Rehabilitation',
    followup: {
      default_window_days: 21,
      tests: ['Bone profile/Vit D (ถ้าจำเป็น)', 'Spasticity assessment scale'],
      imaging: [],
      meds: ['ปรับ antispastic agents/analgesics ตามเป้าหมายฟื้นฟู'],
      counsel: ['โปรแกรมกายภาพ/อาชีวบำบัดที่บ้าน', 'ป้องกันหกล้ม/ภาวะแทรกซ้อนจากการนอนนาน'],
      monitor: ['Goal-attainment diary', 'Pain/fatigue scale'],
      red: ['ปวดมากขึ้นผิดปกติ', 'เกิดแผลกดทับ', 'ล้มถี่ขึ้น'],
      team: ['PT/OT/SLT/Nutrition'],
      tele: true
    },
    promptHint: `เน้นเป้าหมายฟังก์ชัน, โปรแกรม PT/OT/SLT, อุปกรณ์ช่วยเดิน/ADL และตัวชี้วัดความก้าวหน้า`
  },
  psych: {
    name: 'Psychiatry',
    followup: {
      default_window_days: 28,
      tests: ['CBC/CMP (ถ้าปรับยา psychotropic ที่มีผลเมตาบอลิก)', 'Lipids/Glucose (SGA)'],
      imaging: [],
      meds: ['ปรับ SSRIs/SNRIs/SGA ตามอาการและผลข้างเคียง', 'ตรวจสอบเรื่อง drug-interaction'],
      counsel: ['สัญญาณเตือนซึมเศร้ารุนแรง/คิดทำร้ายตนเอง', 'การนอน/การจัดการความเครียด'],
      monitor: ['PHQ-9/GAD-7/อื่น ๆ ตามความเหมาะสม', 'Side-effect checklist'],
      red: ['มีความคิดทำร้ายตนเอง/ผู้อื่น', 'สับสนกะทันหัน', 'EPS รุนแรง'],
      team: ['Psychology/SW/Family meeting'],
      tele: true
    },
    promptHint: `เพิ่มสรุปสภาวะอารมณ์/ความคิด/พฤติกรรม ความปลอดภัย และแผนติดตามยาง่ายต่อการปฏิบัติ`
  },
  oph: {
    name: 'Ophthalmology',
    followup: {
      default_window_days: 14,
      tests: ['Visual acuity', 'Color vision', 'IOP', 'OCT/Visual field ตามจำเป็น'],
      imaging: [],
      meds: ['ปรับตารางหยอดตา/สเตียรอยด์ตา/ยาลดความดันตาตามข้อบ่งชี้'],
      counsel: ['การใช้ยาหยอดตาที่ถูกต้อง', 'หลีกเลี่ยงการขยี้ตา/สิ่งระคายเคือง'],
      monitor: ['อาการปวดตา/ตามัว/เห็นแสงแฟลช'],
      red: ['ปวดตารุนแรง', 'สายตาลดลงเฉียบพลัน', 'ตาแดงมาก/ขี้ตาเยอะผิดปกติ'],
      team: ['Neuro-ophthalmology (ถ้าสงสัยเกี่ยวข้องระบบประสาท)'],
      tele: true
    },
    promptHint: `เพิ่มผลการตรวจตาพื้นฐาน (VA/IOP/สี/field ถ้ามี) และคำแนะนำการใช้ยาหยอดตาอย่างถูกต้อง`
  }
};

// ---------- Helpers ----------
function buildThaiPrompt(rawText, clinicKey = 'neuromed') {
  const clinic = CLINICS[clinicKey] || CLINICS.neuromed;
  return `
คุณเป็นแพทย์เวชปฏิบัติในคลินิก ${clinic.name}
สรุป "OPD Card ภาษาไทย" จากข้อความต่อไปนี้ให้เป็นระเบียบ อ่านง่าย กระชับ เป็นมืออาชีพ
ให้จัดหัวข้อ:
- Chief Complaint
- Present Illness (+ ROS ถ้ามี)
- Past History / Meds / Allergy / Risk (ถ้ามี)
- Physical Examination (โฟกัสตามคลินิก)
- Assessment: Working Dx / DDX / เหตุผลสั้น ๆ
- Plan: Investigation / Treatment (Rx) / Advice & Follow-up

แนวทางเพิ่มเติมเฉพาะคลินิก:
${clinic.promptHint}

--- ข้อความดิบ ---
${String(rawText || '').trim()}
`.trim();
}

function buildFollowupTemplate(clinicKey = 'neuromed', contextText = '', riskLevel = 'routine') {
  const c = CLINICS[clinicKey]?.followup || CLINICS.neuromed.followup;
  const days = c.default_window_days + (riskLevel === 'high' ? -7 : riskLevel === 'urgent' ? -3 : 0);
  return {
    clinic_key: clinicKey,
    clinic_name: CLINICS[clinicKey]?.name || CLINICS.neuromed.name,
    risk_level: riskLevel,
    follow_up_window_days: Math.max(3, days),
    context_brief: String(contextText || '').trim().slice(0, 600),
    tests_to_order: [...c.tests],
    imaging_or_procedures: [...(c.imaging || [])],
    medication_actions: [...c.meds],
    counseling_points: [...c.counsel],
    monitoring_params: [...c.monitor],
    red_flags_for_early_return: [...c.red],
    referral_or_multidisciplinary: [...c.team],
    telemed_ok: !!c.tele
  };
}

function renderFollowupMarkdown(fp) {
  const A = (x) => (Array.isArray(x) ? x : []).filter(Boolean);
  const out = [];
  out.push(`**แผนติดตาม (${fp.clinic_name})**`);
  out.push(`- ระดับความเสี่ยง: **${fp.risk_level.toUpperCase()}**`);
  out.push(`- นัดติดตามใน: **${fp.follow_up_window_days} วัน**`);
  if (fp.context_brief) out.push(`- บริบท: ${fp.context_brief}`);

  if (A(fp.tests_to_order).length) { out.push(`\n**Tests/Labs:**`); A(fp.tests_to_order).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.imaging_or_procedures).length) { out.push(`\n**Imaging/Procedures:**`); A(fp.imaging_or_procedures).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.medication_actions).length) { out.push(`\n**การจัดการยา:**`); A(fp.medication_actions).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.counseling_points).length) { out.push(`\n**ประเด็นให้คำแนะนำผู้ป่วย:**`); A(fp.counseling_points).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.monitoring_params).length) { out.push(`\n**ตัวแปรที่ต้องติดตาม:**`); A(fp.monitoring_params).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.red_flags_for_early_return).length) { out.push(`\n**Red flags กลับมาพบแพทย์ก่อนนัด:**`); A(fp.red_flags_for_early_return).forEach(v=>out.push(`- ${v}`)); }
  if (A(fp.referral_or_multidisciplinary).length) { out.push(`\n**ทีมสหสาขา/ส่งต่อ:**`); A(fp.referral_or_multidisciplinary).forEach(v=>out.push(`- ${v}`)); }
  out.push(`\n**Telemedicine:** ${fp.telemed_ok ? 'เหมาะสม (OK)' : 'ไม่เหมาะสม'}`);
  return out.join('\n');
}

// ---------- Routes ----------
app.get('/api/healthz', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// สรุปจากข้อความ (เลือกคลินิกได้)
app.post('/api/opd/from-text', async (req, res) => {
  try {
    const { rawText = '', clinicKey = 'neuromed' } = req.body || {};
    if (!rawText.trim()) return res.status(400).json({ ok: false, error: 'rawText required' });

    const prompt = buildThaiPrompt(rawText, clinicKey);
    const resp = await openai.responses.create({ model: OPENAI_MODEL, input: prompt, temperature: 0.2 });
    const summary = resp.output_text?.trim?.() || resp?.content?.[0]?.text?.trim?.() || '';
    res.json({ ok: true, clinicKey, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'summarization failed' });
  }
});

// อัปโหลดเสียง -> ถอดเสียง -> สรุป (เลือกคลินิกได้)
app.post('/api/opd/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    const { clinicKey = 'neuromed' } = req.body || {};

    const file = new File([req.file.buffer], req.file.originalname || 'audio.wav', { type: req.file.mimetype || 'audio/wav' });
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
    const resp = await openai.responses.create({ model: OPENAI_MODEL, input: prompt, temperature: 0.2 });
    const summary = resp.output_text?.trim?.() || resp?.content?.[0]?.text?.trim?.() || '';
    res.json({ ok: true, clinicKey, transcript: text, summary });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'upload+transcribe failed' });
  }
});

// Follow-up ตามคลินิก (เทมเพลตก่อน, ไม่จำเพาะโรค)
app.post('/api/followup/from-text', async (req, res) => {
  try {
    const { clinicKey = 'neuromed', riskLevel = 'routine', contextText = '' } = req.body || {};
    const plan = buildFollowupTemplate(clinicKey, contextText, riskLevel);
    const markdown = renderFollowupMarkdown(plan);
    res.json({ ok: true, structured: plan, markdown });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'follow-up generation failed' });
  }
});

// ให้บริการไฟล์สาธารณะ
app.use(express.static(path.join(__dirname, 'public')));

// Fallback -> index.html
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
