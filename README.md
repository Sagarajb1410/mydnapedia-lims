# MyDNAPedia LIMS: Stage 1 test version

This is the working test version of the LIMS described in the MyDNAPedia LIMS Guideline. It runs on one computer, uses dummy data only, and sends nothing to patients or partners.

Built so far, in the guideline's priority order:

1. **Sample registration:** patient details, consent, sample ID and Code 128 barcode, 50 x 25 mm labels, collection as a separate step, duplicate check, editing rules, cancellation.
2. **Billing:** B2B partner credit ledger (deducted at registration, never blocked, one low-balance reminder a day), recharge requests with payment proof and admin approval, B2B supplier patient bills under their own name and GSTIN at a fixed transfer price, direct bills at the standard price, monthly supplier statement, CSV export.
3. **Sample tracking:** admin books courier pickups from partner and supplier locations (the courier gets a WhatsApp with no patient or test names), lab receipt by barcode scan with a condition check, the TAT clock from lab receipt, rejection with a free linked recollection, onward dispatch to the partner lab, in-house processing start, hold and release (the hold pauses the TAT clock), and a TAT board with internal alerts at 75% and when overdue.
4. **Reports:** the partner lab's report (or the in-house result) is stored with the sample. The white-labelled report made in Report Studio is uploaded and checked automatically: any partner lab name, the partner's own sample reference, a missing sample ID, partner names in the file properties or an unreadable file blocks it. The admin approves it after looking at every page, and releasing it checks the file again, stops the TAT clock and puts the client's email (with the report to attach) and WhatsApp in the outbox. Before first use, the admin enters the partner lab's names under Admin, Settings.

Also included: sign-in with roles (admin, lab staff, B2B partner, B2B supplier, counsellor), each partner seeing only their own samples and ledger, an audit trail that cannot be edited, test catalogue and price lists, accounts and people management, and an outbox for WhatsApp and email messages.

Still to build: counselling and the actionable report. Converting partner reports inside the LIMS (instead of in Report Studio) can come later.

## How to run it

1. Install **Node.js LTS** (version 22.13 or newer) from https://nodejs.org. Use the default options.
2. Unzip this folder anywhere, for example on the Desktop.
3. Start it:
   - **Windows:** double-click `START-LIMS-WINDOWS.bat`.
   - **Mac:** right-click `start-lims-mac.command`, choose Open, then Open again.
4. The LIMS opens in your browser at http://127.0.0.1:3000. Keep the black window open while you use it; close it to stop.

The first start fills the LIMS with dummy accounts, tests and samples. Every demo sign-in uses the password `test1234`:

| Email | Role |
| --- | --- |
| admin@mydnapedia.example | Admin |
| lab@demo.example | Lab staff |
| sunrise@demo.example | B2B partner (franchise) |
| carewell@demo.example | B2B partner (clinic) |
| healthplus@demo.example | B2B supplier |
| counsellor@demo.example | Counsellor |

To start again from fresh dummy data, stop the LIMS and delete the `data` folder.

## Messages

There is no WhatsApp API account, so nothing is sent automatically. Every message goes to the **Outbox**. "Open WhatsApp" opens WhatsApp Web with the message filled in; you press Send and then "Mark sent". With dummy data, only send to your own test numbers.

## Moving to Stage 2 later

Nothing in the code needs rebuilding. Settings come from environment variables (`src/config.js`): `DATA_DIR`, `PORT`, `HOST`, and `STORAGE` (`local` now, `s3` with `S3_BUCKET` once the AWS bucket exists). The database tables use plain SQL so they can move to PostgreSQL.

## For developers

- Node.js only, no packages to install. `npm test` runs the checks; `npm start` starts without dummy data (the first admin's one-time password is printed and saved in `data/FIRST-SIGN-IN.txt`).
- Code: `src/samples.js` (registration and statuses), `src/billing.js` (pricing, ledger, reminders), `src/tracking.js` (pickups, receipt, dispatch, TAT), `src/reports.js` and `src/pdftext.js` (report upload, leak check, approval, release), `src/admin.js` (master data), `src/web/` (pages), `src/db.js` (schema and migrations).
- The partner lab is never named anywhere in the code, screens or messages.
