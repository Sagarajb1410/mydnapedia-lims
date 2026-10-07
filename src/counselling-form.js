// The counselling form: the same fields, options and keys as the counsellor
// worksheet in Report Studio, so the case file opens there unchanged.
const { UserError } = require('./util');

// Lifestyle selects are optional except the five the action plan leans on most.
const L = (key, group, label, options, extra = {}) => ({ sec: 'A2', key: `life.${key}`, group, label, type: 'select', options, opt: true, ...extra });

const FIELDS = [
  { sec: 'A1', key: 'heightCm', label: 'Height (cm)', type: 'number', min: 50, max: 250 },
  { sec: 'A1', key: 'weightKg', label: 'Weight (kg)', type: 'number', min: 10, max: 300 },
  { sec: 'A1', key: 'waist', label: 'Waist (cm)', type: 'number', min: 30, max: 250, opt: true },
  { sec: 'A1', key: 'bp', label: 'Blood pressure (mmHg)', type: 'text', placeholder: '120/80', pattern: /^\d{2,3}\s*\/\s*\d{2,3}$/ },
  { sec: 'A1', key: 'hr', label: 'Resting heart rate (bpm)', type: 'number', min: 20, max: 250, opt: true },
  L('diet', 'Diet pattern', 'Diet pattern', ['Vegetarian', 'Non-veg', 'Eggetarian', 'Vegan'], { opt: false }),
  { sec: 'A2', key: 'life.dietNotes', group: 'Diet pattern', label: 'Diet notes', type: 'text', opt: true },
  L('dairy', 'Dairy / milk intake', 'Dairy / milk intake', ['Daily', 'Occasional', 'Avoids']),
  L('dairyBloat', 'Dairy / milk intake', 'Bloating / gas after dairy', ['Yes', 'No', 'Not sure']),
  L('fat', 'Fat / fried / processed food', 'Fat / fried / processed food', ['Low', 'Moderate', 'High']),
  L('actType', 'Physical activity', 'Activity type', ['None / sedentary', 'Walking', 'Gym / strength', 'Running / cardio', 'Yoga / pilates', 'Sports', 'Mixed'], { opt: false }),
  L('actFreq', 'Physical activity', 'Times per week', ['0', '1-2', '3-4', '5-6', 'Daily']),
  L('actIntensity', 'Physical activity', 'Intensity', ['Low', 'Moderate', 'High']),
  L('sleepHours', 'Sleep', 'Hours per night', ['Less than 5', '5-6', '6-7', '7-8', 'More than 8'], { opt: false }),
  L('sleepQuality', 'Sleep', 'Sleep quality', ['Good', 'Fair', 'Poor']),
  L('chronotype', 'Sleep', 'Morning or evening person', ['Morning person', 'Evening person', 'Neither']),
  L('sun', 'Sun exposure', 'Sun exposure', ['Minimal', 'Moderate', 'High']),
  L('sunscreen', 'Sun exposure', 'Sunscreen use', ['Yes', 'No']),
  L('tobacco', 'Tobacco / smoking / nicotine', 'Tobacco / smoking / nicotine', ['Never', 'Ex-user', 'Current'], { opt: false }),
  L('tobaccoAmount', 'Tobacco / smoking / nicotine', 'Amount', ['Not applicable', 'Less than 5/day', '5-10/day', '10-20/day', 'More than 20/day']),
  L('alcohol', 'Alcohol', 'Alcohol', ['Never', 'Occasional', 'Regular'], { opt: false }),
  L('alcoholUnits', 'Alcohol', 'Units per week', ['0', '1-3', '4-7', '8-14', 'More than 14']),
  L('binge', 'Alcohol', 'Binge pattern', ['No', 'Occasionally', 'Frequently']),
  L('caffeine', 'Caffeine', 'Cups per day (tea / coffee / energy)', ['0', '1-2', '3-4', '5 or more']),
  L('caffeineSymptoms', 'Caffeine', 'Symptoms', ['None', 'Jitteriness', 'Acid reflux', 'Palpitations', 'Sleep disturbance', 'Multiple']),
  L('stress', 'Stress', 'Stress level (self-rated)', ['Low', 'Moderate', 'High']),
  L('coping', 'Stress', 'Coping', ['Exercise', 'Meditation / mindfulness', 'Hobbies', 'Social support', 'Professional help', 'None']),
  { sec: 'A3', key: 'conditions', label: 'Current or past conditions', type: 'checks', opt: true, options: [['hypertension', 'Hypertension / high BP'], ['cholesterol', 'High cholesterol / lipids'], ['diabetes', 'Diabetes / pre-diabetes'], ['thyroid', 'Thyroid disorder'], ['liver', 'Fatty liver / liver disease'], ['gallstones', 'Gallstones / gallbladder issue'], ['gastric', 'Gastritis / acid reflux / ulcer'], ['migraine', 'Migraine / recurrent headache'], ['mood', 'Anxiety / depression / mood'], ['asthma', 'Asthma / respiratory'], ['skin', 'Skin condition (acne / psoriasis)'], ['joint', 'Joint / autoimmune complaint']] },
  { sec: 'A3', key: 'conditionsNote', label: 'Any other conditions or details', type: 'textarea', opt: true },
  { sec: 'A3', key: 'medications', label: 'Current medicines', type: 'textarea', opt: true },
  { sec: 'A4', key: 'investigations', label: 'Recent investigations (tests and values)', type: 'textarea', opt: true },
  { sec: 'B', key: 'family', label: 'Family history', type: 'checks', opt: true, options: [['heart', 'Heart disease / early heart attack'], ['diabetes', 'Diabetes'], ['hypertension', 'High blood pressure'], ['colorectal', 'Colorectal / bowel cancer'], ['cancer', 'Other cancers'], ['thyroid', 'Thyroid disease'], ['autoimmune', 'Autoimmune disease'], ['neuro', "Dementia / Parkinson's"]] },
  { sec: 'B', key: 'familyNote', label: 'Parents, siblings, close relatives: details', type: 'textarea', opt: true },
  { sec: 'C', key: 'reconciliation', label: 'Counsellor working notes (genetics vs history)', type: 'textarea', opt: true },
  { sec: 'E1', key: 'priorities', label: 'Top priorities agreed with the client (one per line)', type: 'textarea' },
  { sec: 'E2', key: 'healthChecks', label: 'Preventive health checks advised (one per line)', type: 'textarea', opt: true },
  { sec: 'E4', key: 'consults', label: 'Referrals', type: 'checks', opt: true, options: [['physician', 'Physician (Internal Medicine)'], ['dietitian', 'Clinical dietitian / nutritionist'], ['cardiologist', 'Cardiologist'], ['dermatologist', 'Dermatologist'], ['gastro', 'Hepatologist / gastroenterologist'], ['others', 'Others']] },
  { sec: 'E4', key: 'consultOther', label: 'Other referral', type: 'text', opt: true },
];

const SECTIONS = {
  A1: 'A1. Body measurements and vitals', A2: 'A2. Lifestyle', A3: 'A3. Medical history and medicines', A4: 'A4. Recent investigations',
  B: 'B. Family history', C: 'C. Reconciliation', E1: 'E1. Priorities', E2: 'E2. Health checks', E4: 'E4. Referrals',
};

const get = (data, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);

// Form posts use "life.diet" style names and "conditions[]" for ticks.
function fromBody(body) {
  const data = { life: {} };
  for (const f of FIELDS) {
    const raw = body[f.key];
    let v;
    if (f.type === 'checks') {
      const allowed = new Set(f.options.map(([k]) => k));
      v = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((x) => allowed.has(x));
    } else {
      v = String(raw ?? '').trim().slice(0, 4000);
      if (f.type === 'select' && v && !f.options.includes(v)) throw new UserError(`Choose a listed option for "${f.label}".`);
      if (f.type === 'number' && v) {
        const n = Number(v.replace(',', '.'));
        if (!Number.isFinite(n) || n < f.min || n > f.max) throw new UserError(`"${f.label}" should be between ${f.min} and ${f.max}.`);
        v = String(n);
      }
      if (f.pattern && v && !f.pattern.test(v)) throw new UserError(`Write "${f.label}" like ${f.placeholder}.`);
      if (f.key === 'bp' && v) v = v.replace(/\s+/g, '');
    }
    if (f.key.startsWith('life.')) data.life[f.key.slice(5)] = v;
    else data[f.key] = v;
  }
  return data;
}

// The posted values as typed, for showing the form again after an error.
function rawFromBody(body) {
  const data = { life: {} };
  for (const f of FIELDS) {
    const r = body[f.key];
    const v = f.type === 'checks' ? (Array.isArray(r) ? r : r ? [r] : []) : String(r ?? '');
    if (f.key.startsWith('life.')) data.life[f.key.slice(5)] = v;
    else data[f.key] = v;
  }
  return data;
}

function missing(data) {
  return FIELDS.filter((f) => !f.opt && !get(data, f.key)).map((f) => f.label);
}

function bmi(data) {
  const h = parseFloat(data.heightCm);
  const w = parseFloat(data.weightKg);
  return h > 50 && w > 10 ? Math.round((w / ((h / 100) ** 2)) * 10) / 10 : null;
}

// Asian cut-offs, as in the action plan.
function bmiLabel(v) {
  if (v == null) return '';
  return v < 18.5 ? 'below the healthy range' : v < 23 ? 'healthy' : v < 25 ? 'overweight' : 'obesity range';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function istParts(iso) {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hh: p(d.getUTCHours()), mm: p(d.getUTCMinutes()), p };
}

function ageOn(dob, iso) {
  const [y, m, d] = dob.split('-').map(Number);
  const t = istParts(iso);
  return t.y - y - ((t.m + 1 < m || (t.m + 1 === m && t.d < d)) ? 1 : 0);
}

const TIERS = { MDP360P: '360 Premium', MDPSKIN: 'Skin Health', MDPFIT: 'Fitness', MDPCARD: 'Cardiac Health' };

// Report Studio "mdp-report-studio-case" v1. clinical stays null: the
// counsellor loads the partner's original PDF in Report Studio afterwards,
// which keeps this form when the client name matches the PDF.
function toCaseFile({ sample, patient, test, form, reportDate, session, counsellorName, now = new Date().toISOString() }) {
  const r = istParts(reportDate || now);
  const [dy, dm, dd] = patient.dob.split('-');
  const data = { life: {}, ...form };
  const sessionWhen = session ? istParts(session.scheduled_at) : null;
  return {
    app: 'mdp-report-studio-case',
    version: 1,
    savedAt: now,
    patient: {
      name: patient.full_name,
      gender: patient.gender,
      age: String(ageOn(patient.dob, now)),
      sampleId: sample.sample_id,
      reportDate: `${r.p(r.d)}-${MONTHS[r.m]}-${r.y} ${r.hh}:${r.mm}`,
      contact: patient.mobile,
      email: patient.email || '',
      address: [patient.address, patient.city, patient.state, patient.pincode].filter(Boolean).join(', '),
      dob: `${dd}/${dm}/${dy}`,
      kitId: '',
    },
    clinical: null,
    form: {
      ...data,
      life: { ...data.life },
      counsellor: counsellorName || '',
      sessionDate: sessionWhen ? `${sessionWhen.y}-${sessionWhen.p(sessionWhen.m + 1)}-${sessionWhen.p(sessionWhen.d)}` : '',
    },
    mail: {
      meetLink: (session && session.meeting_link) || '',
      when: sessionWhen ? `${sessionWhen.y}-${sessionWhen.p(sessionWhen.m + 1)}-${sessionWhen.p(sessionWhen.d)}T${sessionWhen.hh}:${sessionWhen.mm}` : '',
      subject: '',
      attach: true,
    },
    plan: { planDate: (() => { const t = istParts(now); return `${t.y}-${t.p(t.m + 1)}-${t.p(t.d)}`; })(), preparedBy: 'Team MYDNAPEDIA', tier: TIERS[test.code] || test.name.replace(/^MDP\s+/, '') },
  };
}

module.exports = { FIELDS, SECTIONS, fromBody, rawFromBody, missing, bmi, bmiLabel, toCaseFile, get };
