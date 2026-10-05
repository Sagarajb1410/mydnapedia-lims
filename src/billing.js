// Billing rules (guideline section 5, with the decisions of 5 Oct 2026):
// - B2B partners (franchises included) pay in advance. Each registration deducts
//   their price from the credit ledger. Registration is never blocked; while the
//   balance is low the partner and admin get one reminder a day.
// - B2B suppliers bill patients under their own name and GSTIN. MyDNAPedia charges
//   them the fixed transfer price, whatever their own price or discount.
// - Direct registrations by our lab staff use the standard price list.
const { nowIso, istDate, audit, nextCounter, rupees, UserError, getSetting } = require('./util');
const notify = require('./notify');

const PRICE_LIST_FOR = { main: 'direct', partner: 'partner', supplier: 'supplier' };
const PRICE_LIST_LABEL = { direct: 'Standard price', partner: 'B2B partner price', supplier: 'Supplier transfer price' };

function priceFor(db, account, testId, day = istDate()) {
  const override = db.get(
    `SELECT price_paise FROM price_overrides WHERE account_id = ? AND test_id = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    account.id, testId, day,
  );
  const priceList = PRICE_LIST_FOR[account.type];
  if (override) return { pricePaise: override.price_paise, priceList, overridden: true };
  const row = db.get(
    `SELECT price_paise FROM prices WHERE test_id = ? AND price_list = ? AND effective_from <= ?
     ORDER BY effective_from DESC, id DESC LIMIT 1`,
    testId, priceList, day,
  );
  if (!row) throw new UserError(`No ${PRICE_LIST_LABEL[priceList].toLowerCase()} is set for this test. Ask the admin to add one.`);
  return { pricePaise: row.price_paise, priceList, overridden: false };
}

function balance(db, accountId) {
  return db.get('SELECT COALESCE(SUM(amount_paise), 0) AS b FROM ledger_entries WHERE account_id = ?', accountId).b;
}

function addLedger(db, e) {
  const r = db.run(
    `INSERT INTO ledger_entries (account_id, entry_type, amount_paise, sample_pk, recharge_id, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    e.accountId, e.type, e.amountPaise, e.samplePk || null, e.rechargeId || null, e.reason || null, e.userId || null, nowIso(),
  );
  return Number(r.lastInsertRowid);
}

function newBillNo(db) {
  const yy = istDate().slice(2, 4);
  return `B${yy}-${String(nextCounter(db, 'bill-' + yy)).padStart(6, '0')}`;
}

// Called inside the registration transaction. Returns the bill id.
// opts.supplier = { patientPricePaise, discountPaise, gstRateBp } for supplier accounts.
// opts.direct = { discountPaise, paymentMode, paymentRef } for our own registrations.
function chargeRegistration(db, { sample, account, test, user, supplier, direct }) {
  const { pricePaise, priceList } = priceFor(db, account, test.id);
  const billNo = newBillNo(db);
  let discount = 0;
  let payer;
  let status;
  let paymentMode = null;
  let paymentRef = null;

  if (account.type === 'partner') {
    payer = 'credit';
    status = 'paid';
  } else if (account.type === 'supplier') {
    payer = 'supplier';
    status = 'open'; // settled through the supplier's monthly statement
  } else {
    payer = 'patient';
    discount = (direct && direct.discountPaise) || 0;
    if (discount < 0 || discount > pricePaise) throw new UserError('The discount must be between zero and the test price.');
    if (discount > 0 && user.role !== 'admin') throw new UserError('Only an admin can give a discount.');
    paymentMode = direct && direct.paymentMode;
    paymentRef = (direct && direct.paymentRef) || null;
    if (!paymentMode) throw new UserError('Choose how the patient paid.');
    status = paymentMode === 'pending' ? 'open' : 'paid';
  }

  const net = pricePaise - discount;
  const billId = Number(db.run(
    `INSERT INTO bills (bill_no, sample_pk, account_id, price_list, list_price_paise, discount_paise, net_paise, payer, payment_mode, payment_ref, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    billNo, sample.id, account.id, priceList, pricePaise, discount, net, payer, paymentMode === 'pending' ? null : paymentMode, paymentRef, status, nowIso(),
  ).lastInsertRowid);

  if (account.type === 'partner') {
    addLedger(db, { accountId: account.id, type: 'deduction', amountPaise: -net, samplePk: sample.id, reason: `${test.name} for ${sample.sample_id}`, userId: user.id });
    const bal = balance(db, account.id);
    notify.toAccount(db, account, {
      code: 'N2',
      subject: `Credit used for sample ${sample.sample_id}`,
      body: `${getSetting(db, 'labName')}: ${rupees(net)} has been deducted from your credit for ${test.name} (sample ${sample.sample_id}). Your balance is now ${rupees(bal)}.`,
      samplePk: sample.id,
    });
  }

  if (account.type === 'supplier') {
    const s = supplier || {};
    const patientPrice = s.patientPricePaise;
    const sDiscount = s.discountPaise || 0;
    if (patientPrice == null || patientPrice <= 0) throw new UserError("Enter your price to the patient.");
    if (sDiscount < 0 || sDiscount > patientPrice) throw new UserError('Your discount must be between zero and your price to the patient.');
    const gstRateBp = s.gstRateBp || 0;
    const sNet = patientPrice - sDiscount;
    const gst = Math.round((sNet * gstRateBp) / 10000);
    const supBillNo = `${account.code}-${String(nextCounter(db, 'supplier-bill-' + account.id)).padStart(5, '0')}`;
    db.run(
      `INSERT INTO supplier_bills (sample_pk, account_id, bill_no, patient_price_paise, discount_paise, net_paise, gst_rate_bp, gst_paise, total_paise, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sample.id, account.id, supBillNo, patientPrice, sDiscount, sNet, gstRateBp, gst, sNet + gst, nowIso(),
    );
  }

  audit(db, user.id, 'bill_created', 'bill', billId, { billNo, sample: sample.sample_id, priceList, net });
  return billId;
}

// Cancelling a sample. Before the central lab receives it the credit goes back in
// full; after that the admin chooses the amount (zero is allowed).
function reverseForCancellation(db, { sample, user, amountPaise, reason }) {
  const bill = db.get('SELECT * FROM bills WHERE sample_pk = ?', sample.id);
  if (!bill || bill.status === 'reversed' || bill.status === 'refunded') return null;
  const amount = amountPaise == null ? bill.net_paise : amountPaise;
  if (amount < 0 || amount > bill.net_paise) throw new UserError('The amount to give back must be between zero and the amount billed.');
  const account = db.get('SELECT * FROM accounts WHERE id = ?', bill.account_id);
  if (bill.payer === 'credit' && amount > 0) {
    addLedger(db, { accountId: account.id, type: 'reversal', amountPaise: amount, samplePk: sample.id, reason: `Cancelled ${sample.sample_id}: ${reason}`, userId: user.id });
  }
  const newStatus = bill.payer === 'patient' && amount > 0 ? 'refunded' : 'reversed';
  db.run('UPDATE bills SET status = ? WHERE id = ?', newStatus, bill.id);
  if (account.type !== 'main') {
    notify.toAccount(db, account, {
      code: 'N16',
      subject: `Sample ${sample.sample_id} cancelled`,
      body: `${getSetting(db, 'labName')}: sample ${sample.sample_id} has been cancelled (${reason}).` +
        (bill.payer === 'credit' ? ` ${rupees(amount)} has been added back to your credit. Balance: ${rupees(balance(db, account.id))}.` : ''),
      samplePk: sample.id,
    });
  }
  audit(db, user.id, 'bill_reversed', 'bill', bill.id, { amount, reason });
  return amount;
}

function submitRecharge(db, user, { amountPaise, mode, reference, paymentDate, proofFile }) {
  if (user.role !== 'partner' || user.account_type !== 'partner') throw new UserError('Only B2B partners can request a recharge.');
  if (!(amountPaise > 0)) throw new UserError('Enter the amount you paid.');
  if (!mode) throw new UserError('Choose how you paid.');
  if (!reference || !String(reference).trim()) throw new UserError('Enter the UTR or payment reference number.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate || '') || paymentDate > istDate()) throw new UserError('Enter the payment date (not in the future).');
  const dup = db.get("SELECT id FROM recharge_requests WHERE account_id = ? AND reference = ? AND status != 'rejected'", user.account_id, reference.trim());
  if (dup) throw new UserError('A recharge with this payment reference has already been submitted.');
  return db.tx(() => {
    const id = Number(db.run(
      `INSERT INTO recharge_requests (account_id, amount_paise, mode, reference, payment_date, proof_file, status, submitted_by, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?, ?)`,
      user.account_id, amountPaise, mode, reference.trim(), paymentDate, proofFile || null, user.id, nowIso(),
    ).lastInsertRowid);
    const account = db.get('SELECT * FROM accounts WHERE id = ?', user.account_id);
    notify.toAdmin(db, {
      code: 'N4', accountId: account.id,
      subject: `Recharge request from ${account.name}`,
      body: `${account.name} has submitted a recharge of ${rupees(amountPaise)} (${mode}, reference ${reference.trim()}, paid on ${paymentDate}). Please check the bank statement and approve it in the LIMS.`,
    });
    audit(db, user.id, 'recharge_submitted', 'recharge', id, { amountPaise, reference });
    return id;
  });
}

function reviewRecharge(db, admin, id, approve, note) {
  if (admin.role !== 'admin') throw new UserError('Only an admin can approve recharges.');
  return db.tx(() => {
    const r = db.get('SELECT * FROM recharge_requests WHERE id = ?', id);
    if (!r) throw new UserError('Recharge request not found.');
    if (r.status !== 'submitted') throw new UserError('This request has already been reviewed.');
    if (!approve && !(note && note.trim())) throw new UserError('Give a reason for rejecting the request.');
    db.run('UPDATE recharge_requests SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?',
      approve ? 'approved' : 'rejected', admin.id, nowIso(), note || null, id);
    const account = db.get('SELECT * FROM accounts WHERE id = ?', r.account_id);
    if (approve) {
      addLedger(db, { accountId: r.account_id, type: 'recharge', amountPaise: r.amount_paise, rechargeId: id, reason: `Recharge ${r.mode} ${r.reference}`, userId: admin.id });
      notify.toAccount(db, account, {
        code: 'N5',
        subject: 'Recharge approved',
        body: `${getSetting(db, 'labName')}: your recharge of ${rupees(r.amount_paise)} (reference ${r.reference}) has been approved. Your balance is now ${rupees(balance(db, account.id))}.`,
      });
    } else {
      notify.toAccount(db, account, {
        code: 'N5',
        subject: 'Recharge not approved',
        body: `${getSetting(db, 'labName')}: your recharge request of ${rupees(r.amount_paise)} (reference ${r.reference}) was not approved: ${note}. Please contact us.`,
      });
    }
    audit(db, admin.id, approve ? 'recharge_approved' : 'recharge_rejected', 'recharge', id, { note });
  });
}

// Admin-only correction or a recharge added without a request. Signed amount.
function adjust(db, admin, accountId, amountPaise, reason, asRecharge) {
  if (admin.role !== 'admin') throw new UserError('Only an admin can change credit.');
  if (!amountPaise) throw new UserError('Enter an amount.');
  if (!reason || !reason.trim()) throw new UserError('Give a reason.');
  const account = db.get("SELECT * FROM accounts WHERE id = ? AND type = 'partner'", accountId);
  if (!account) throw new UserError('Credit can only be changed for B2B partner accounts.');
  if (asRecharge && amountPaise < 0) throw new UserError('A recharge must be a positive amount.');
  return db.tx(() => {
    const id = addLedger(db, { accountId, type: asRecharge ? 'recharge' : 'adjustment', amountPaise, reason: reason.trim(), userId: admin.id });
    audit(db, admin.id, asRecharge ? 'recharge_added' : 'credit_adjusted', 'account', accountId, { amountPaise, reason });
    if (asRecharge) {
      notify.toAccount(db, account, {
        code: 'N5', subject: 'Credit added',
        body: `${getSetting(db, 'labName')}: ${rupees(amountPaise)} has been added to your credit. Your balance is now ${rupees(balance(db, accountId))}.`,
      });
    }
    return id;
  });
}

// One reminder per partner per day while the balance is below its threshold.
// Registration itself is never blocked.
function lowBalanceReminders(db, day = istDate()) {
  const accounts = db.all("SELECT * FROM accounts WHERE type = 'partner' AND active = 1");
  let sent = 0;
  for (const a of accounts) {
    const bal = balance(db, a.id);
    if (bal >= a.low_balance_paise) continue;
    const already = db.get("SELECT id FROM notifications WHERE code = 'N3' AND account_id = ? AND day = ?", a.id, day);
    if (already) continue;
    db.tx(() => {
      const text = bal < 0
        ? `${getSetting(db, 'labName')}: your credit balance is ${rupees(bal)} (below zero). Please recharge today so your account stays in good standing.`
        : `${getSetting(db, 'labName')}: your credit balance is ${rupees(bal)}, below your alert level of ${rupees(a.low_balance_paise)}. Please recharge soon.`;
      notify.toAccount(db, a, { code: 'N3', subject: 'Low credit balance', body: text, day });
      notify.toAdmin(db, { code: 'N3', day, accountId: a.id, subject: `Low balance: ${a.name}`, body: `${a.name} has a credit balance of ${rupees(bal)} (alert level ${rupees(a.low_balance_paise)}).` });
    });
    sent++;
  }
  return sent;
}

module.exports = {
  PRICE_LIST_FOR, PRICE_LIST_LABEL, priceFor, balance, chargeRegistration, reverseForCancellation,
  submitRecharge, reviewRecharge, adjust, lowBalanceReminders,
};
