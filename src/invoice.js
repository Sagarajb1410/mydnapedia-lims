// Tax invoices laid out like the ones Tally prints: seller and buyer boxes,
// invoice details grid, item table with SAC, CGST + SGST (same state) or
// IGST (other state), amount in words and the SAC-wise tax summary.
const { getSetting, fmtDate } = require('./util');

// GST state codes, used for "State Name : X, Code : NN".
const STATE_CODES = {
  'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', Punjab: '03', Chandigarh: '04', Uttarakhand: '05', Haryana: '06', Delhi: '07',
  Rajasthan: '08', 'Uttar Pradesh': '09', Bihar: '10', Sikkim: '11', 'Arunachal Pradesh': '12', Nagaland: '13', Manipur: '14',
  Mizoram: '15', Tripura: '16', Meghalaya: '17', Assam: '18', 'West Bengal': '19', Jharkhand: '20', Odisha: '21', Chhattisgarh: '22',
  'Madhya Pradesh': '23', Gujarat: '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', Maharashtra: '27', Karnataka: '29', Goa: '30',
  Lakshadweep: '31', Kerala: '32', 'Tamil Nadu': '33', Puducherry: '34', 'Andaman and Nicobar Islands': '35', Telangana: '36',
  'Andhra Pradesh': '37', Ladakh: '38',
};
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
function stateCode(name) {
  const k = Object.keys(STATE_CODES).find((x) => norm(x) === norm(name));
  return k ? STATE_CODES[k] : '';
}

// Indian number words: 1,23,45,678 is "One Crore Twenty Three Lakh ...".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function upTo99(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`; }
function upTo999(n) { return [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', upTo99(n % 100)].filter(Boolean).join(' '); }
function numberWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${numberWords(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (n) parts.push(upTo999(n));
  return parts.join(' ');
}
function amountInWords(paise) {
  const r = Math.floor(paise / 100), p = paise % 100;
  return `INR ${numberWords(r)}${p ? ` and ${upTo99(p)} paise` : ''} Only`;
}

// 1774.5 rupees as "1,774.50" (Indian grouping, always two decimals).
function amt(paise) {
  const neg = paise < 0, a = Math.abs(paise);
  return (neg ? '-' : '') + Math.floor(a / 100).toLocaleString('en-IN') + '.' + String(a % 100).padStart(2, '0');
}

// Splits a tax-inclusive amount into taxable value and tax.
function splitInclusive(grossPaise, ratePct) {
  const taxable = Math.round((grossPaise * 100) / (100 + ratePct));
  return { taxable, tax: grossPaise - taxable };
}

// Builds the invoice for one sample's bill. Supplier bills are issued by the
// supplier to the patient; partner bills by us to the partner; direct bills
// by us to the patient.
function build(db, { s, p, t, a, bill, sbill }) {
  const set = (k) => getSetting(db, k);
  const ourSeller = {
    name: set('companyLegalName') || set('labName'), sub: `${set('labName')}${set('unitLine') ? ` (${set('unitLine')})` : ''}`,
    address: set('companyAddress'), gstin: set('companyGstin'), state: set('companyState'), email: set('supportEmail'), pan: set('companyPan'),
    bank: set('bankName') || set('bankAccount') ? { name: set('bankName'), account: set('bankAccount'), ifsc: set('bankIfsc') } : null,
  };
  const patientBuyer = { name: p.full_name, address: [p.address, `${p.city} ${p.pincode}`].filter(Boolean).join(', '), state: p.state, phone: p.mobile };
  const sac = set('invoiceSac');
  let seller, buyer, rate, taxable, tax, listExcl, discPct, invoiceNo, payment;
  if (sbill) {
    seller = { name: a.legal_name || a.name, address: [a.address, a.city].filter(Boolean).join(', '), gstin: a.gstin, state: a.state, email: a.email };
    buyer = patientBuyer;
    rate = sbill.gst_rate_bp / 100;
    taxable = sbill.net_paise; tax = sbill.gst_paise; listExcl = sbill.patient_price_paise;
    discPct = sbill.discount_paise ? (sbill.discount_paise * 100) / sbill.patient_price_paise : 0;
    invoiceNo = sbill.bill_no; payment = '';
  } else {
    seller = ourSeller;
    buyer = bill.payer === 'credit'
      ? { name: a.legal_name || a.name, address: [a.address, a.city].filter(Boolean).join(', '), gstin: a.gstin, state: a.state, phone: a.phone }
      : patientBuyer;
    rate = Number(set('invoiceGstRate')) || 0;
    ({ taxable, tax } = splitInclusive(bill.net_paise, rate));
    listExcl = splitInclusive(bill.list_price_paise, rate).taxable;
    discPct = bill.discount_paise ? (bill.discount_paise * 100) / bill.list_price_paise : 0;
    invoiceNo = bill.bill_no;
    payment = bill.payer === 'credit' ? 'Prepaid credit' : [bill.payment_mode, bill.payment_ref].filter(Boolean).join(' / ');
  }
  // Same state, or no state known for the buyer: CGST + SGST. Otherwise IGST.
  const inter = Boolean(buyer.state && seller.state && norm(buyer.state) !== norm(seller.state));
  const taxes = rate === 0 ? [] : inter
    ? [{ name: 'IGST', rate, amount: tax }]
    : [{ name: 'CGST', rate: rate / 2, amount: Math.floor(tax / 2) }, { name: 'SGST', rate: rate / 2, amount: tax - Math.floor(tax / 2) }];
  const total = taxable + tax;
  return {
    title: rate === 0 ? 'Bill of Supply' : 'Tax Invoice', inter,
    seller: { ...seller, stateCode: stateCode(seller.state) }, buyer: { ...buyer, stateCode: stateCode(buyer.state) },
    invoiceNo, date: fmtDate(sbill ? sbill.created_at : bill.created_at), payment, sampleId: s.sample_id, patient: p.full_name,
    item: { description: t.name, sac, qty: 1, rate: listExcl, discPct, amount: taxable },
    taxes, taxable, tax, total, rate,
    words: amountInWords(total), taxWords: amountInWords(tax),
    cancelled: bill.status === 'reversed' || bill.status === 'refunded' ? (bill.status === 'refunded' ? 'Cancelled and refunded' : 'Cancelled and reversed') : '',
    jurisdiction: sbill ? (a.city || '') : set('jurisdiction'),
  };
}

module.exports = { build, amountInWords, numberWords, splitInclusive, stateCode, amt };
