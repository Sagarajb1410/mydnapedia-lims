// The sample journey in six parts, used by the dashboard, the sample list and
// the progress bar on the sample page.
const PHASES = [
  { key: 'registered', label: 'Registered', color: '#8a96a0', statuses: ['REGISTERED', 'COLLECTED'] },
  { key: 'moving', label: 'On the way', color: 'var(--blue)', statuses: ['PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB'] },
  { key: 'lab', label: 'In the lab', color: 'var(--teal)', statuses: ['RECEIVED_AT_LAB', 'IN_HOUSE_PROCESSING', 'RESULT_READY', 'DISPATCH_TO_PARTNER_SCHEDULED', 'IN_TRANSIT_TO_PARTNER', 'RECEIVED_AT_PARTNER', 'PARTNER_REPORT_RECEIVED'] },
  { key: 'report', label: 'Report', color: 'var(--honey)', statuses: ['REPORT_WHITE_LABELLED', 'REPORT_APPROVED', 'REPORT_RELEASED'] },
  { key: 'counselling', label: 'Counselling', color: 'var(--violet)', statuses: ['COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED'] },
  { key: 'done', label: 'Delivered', color: 'var(--good)', statuses: ['DELIVERED', 'CLOSED'] },
];
// Short names for the dashboard's narrow columns.
const SHORT = {
  DISPATCH_TO_PARTNER_SCHEDULED: 'Partner dispatch booked', IN_TRANSIT_TO_PARTNER: 'To partner lab', RECEIVED_AT_PARTNER: 'At partner lab',
  PARTNER_REPORT_RECEIVED: 'Partner report in', IN_HOUSE_PROCESSING: 'In-house testing', REPORT_WHITE_LABELLED: 'White-labelled',
  COUNSELLING_SCHEDULED: 'Session booked', COUNSELLING_DONE: 'Session held', ACTION_PLAN_DRAFTED: 'Plan drafted', ACTION_PLAN_APPROVED: 'Plan approved',
};
const EXCEPTIONS = ['ON_HOLD', 'RECOLLECTION_REQUESTED', 'REJECTED', 'CANCELLED'];

function phaseOf(status) {
  return PHASES.find((p) => p.statuses.includes(status)) || null;
}

// Progress steps for one sample. Partner-lab tests show the partner lab as a step.
function steps(s, route) {
  const list = [
    ['Registered', ['REGISTERED']],
    ['Collected', ['COLLECTED', 'PICKUP_SCHEDULED', 'IN_TRANSIT_TO_LAB']],
    ['At the lab', ['RECEIVED_AT_LAB', 'IN_HOUSE_PROCESSING', 'RESULT_READY', 'DISPATCH_TO_PARTNER_SCHEDULED']],
  ];
  if (route === 'partner_lab') list.push(['Partner lab', ['IN_TRANSIT_TO_PARTNER', 'RECEIVED_AT_PARTNER', 'PARTNER_REPORT_RECEIVED']]);
  list.push(['Report', ['REPORT_WHITE_LABELLED', 'REPORT_APPROVED']], ['Released', ['REPORT_RELEASED']],
    ['Counselling', ['COUNSELLING_SCHEDULED', 'COUNSELLING_DONE', 'ACTION_PLAN_DRAFTED', 'ACTION_PLAN_APPROVED']], ['Delivered', ['DELIVERED', 'CLOSED']]);
  // A sample on hold sits where it was put on hold; a rejected sample stopped at the lab.
  const status = s.status === 'ON_HOLD' ? s.hold_from_status : ['REJECTED', 'RECOLLECTION_REQUESTED'].includes(s.status) ? 'RECEIVED_AT_LAB' : s.status;
  let at = list.findIndex(([, st]) => st.includes(status));
  if (s.status === 'CANCELLED') at = -1;
  const stop = ['REJECTED', 'RECOLLECTION_REQUESTED', 'ON_HOLD'].includes(s.status);
  const done = s.status === 'CLOSED' || s.status === 'DELIVERED';
  return list.map(([label], i) => ({
    label,
    state: at < 0 ? 'todo' : i < at || (done && i === at) ? 'past' : i === at ? (stop ? 'stop' : 'now') : 'todo',
  }));
}

module.exports = { PHASES, EXCEPTIONS, SHORT, phaseOf, steps };
