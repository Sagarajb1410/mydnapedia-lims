# MyDNAPedia LIMS: Stage 1 test version

This is the working test version of the LIMS described in the MyDNAPedia LIMS Guideline. It runs on one computer, uses dummy data only, and sends nothing to patients or partners.

Built so far, in the guideline's priority order:

**Old samples:** staff can enter a sample processed before it was in the LIMS. Open "Old sample?" on the registration form (or fill the two old-sample columns in the Excel upload) and give the registered, collected and received dates. It is entered with those dates and no messages go out.

**One page for the daily steps:** the Samples list has a Next step button on each row (Collected, Message courier, Reached lab, then the receipt Acknowledgement), and tick boxes to do a step for many samples at once. The full Tracking screens are still there for pickups, rejections and dispatch.

1. **Sample registration:** patient details (only name, gender and age are compulsory; a date of birth, if entered, fills in the age; a patient without a mobile gets no WhatsApp messages and cannot use self-tracking), consent, sample ID and Code 128 barcode, 50 x 25 mm labels, collection as a separate step, duplicate check, editing rules, cancellation.
2. **Billing:** B2B partner credit ledger (deducted at registration, never blocked, one low-balance reminder a day), recharge requests with payment proof and admin approval, B2B supplier patient bills under their own name and GSTIN at a fixed transfer price, direct bills at the standard price, every bill printed as a Tally-style tax invoice (SAC, CGST + SGST or IGST, amount in words), monthly supplier statement, CSV export.
3. **Sample tracking:** admin books courier pickups from partner and supplier locations (the courier gets a WhatsApp with no patient or test names), lab receipt by barcode scan with a condition check, the TAT clock from lab receipt, rejection with a free linked recollection, onward dispatch to the partner lab, in-house processing start, hold and release (the hold pauses the TAT clock), and a TAT board with internal alerts at 75% and when overdue. Each day the lab receives a partner's samples, the partner gets a printable **sample receipt acknowledgement** (Lab receipts in their menu, a button on the sample page and a link in the receipt email) listing every sample, its condition, the expected report date and who received it.
4. **Reports:** the partner lab's report (or the in-house result) is stored with the sample. The white-labelled report made in Report Studio is uploaded and checked automatically: any partner lab name, the partner's own sample reference, a missing sample ID, partner names in the file properties or an unreadable file blocks it. The admin approves it after looking at every page, and releasing it checks the file again, stops the TAT clock and puts the client's email (with the report to attach) and WhatsApp in the outbox. Before first use, the admin enters the partner lab's names under Admin, Settings.
**Report Centre** groups steps 4 and 5: Reports, Counselling and Action plans, plus the Report Centre tool (the Report Studio file, served by the LIMS and linked to it). "Convert in Report Centre" on a sample opens the tool with the partner's PDF and the client's details already loaded; its LIMS tab sends the converted report, counselling form, case file and action plan straight back onto the sample, through the same checks. The tool runs in the browser, so client data stays inside our system. Put the Report Studio file in `studio/report-studio.html` and the Skin Health Studio file in `studio/skin-health-studio.html`, or install them under Admin, Report Centre. A Skin Health sample opens Skin Health Studio for converting, the counselling form and the action plan, so skin reports and plans carry the Skin Health name and wording. Fitness and Cardiac Health samples open Report Studio, which then names the report after the sample's test (MDP FITNESS, MDP CARDIAC HEALTH) in the header and foreword. The action plan is scoped to the test too: a Skin Health plan covers nutrition, prevention and skin care (no fitness, mental wellbeing or medicines sections); a Fitness plan has no medicines note; Cardiac Health and 360 Premium plans keep every section.

5. **Counselling and the action plan:** each counsellor adds the times they are free under My availability (days of the week, from and to, session length, video, phone or in person); the admin can do it for any counsellor. When a report is released, the client's message carries their tracking link, where they pick one of those times; they can change it until 12 hours before. Staff can also book an open slot, or any other time, from the sample's page. The client's WhatsApp and email invite go to the outbox and the counsellor gets an email. Counsellors fill in the counselling form on screen (the same fields as the Report Studio worksheet, with BMI worked out) and download a case file that opens in Report Studio. The action plan window (Report Centre, Action plans, "Action plan window", or "Open action plan" on a sample) is one screen with three steps: add the white-labelled report, add the counsellor's filled form, pick the test, then "Create action plan". The results are read from the white-labelled report, so nothing is converted again. Opened on a sample, both are filled in from the LIMS when it has them. The filled form can be loaded there as Word (.docx) or as a PDF saved from Word; a scanned or photographed form has no readable text, so its answers are typed in on the form tab. Converting and the counselling form itself stay in the full Report Centre. The plan (Word or PDF) is uploaded back and checked like reports, the admin approves it, the counsellor sends it to the client and the admin closes the case.

Patients can **track their sample** at `/track` with no sign-in: they enter the sample ID and the last 4 digits of their mobile and see the stage in plain words, the steps with dates and the expected report date (from the TAT once the lab has the sample, an estimate before that). The link is in the registration message and on the sample page. It never shows the partner lab, references or other personal details, and wrong guesses are limited to 10 per 15 minutes. In the demo, try sample MDP00020260007 with 9611.

**Registering many samples at once:** Samples, Upload from Excel (also linked from the registration form). Download the template, fill one row per sample, upload it, and every row is checked before anything is registered. Rows with problems are listed with the reason; the ready rows register in one go, are billed exactly as on the form, and their labels print together.

Also included: a **monthly report** (Business, Monthly report) showing how many samples the lab processed in a month and how many came from each franchise, partner and supplier, with an Excel download; sign-in with roles (admin, lab staff, B2B partner, B2B supplier, counsellor), each partner seeing only their own samples and ledger, an audit trail that cannot be edited, test catalogue and price lists, accounts and people management, and an outbox for WhatsApp and email messages.

All five modules of the guideline are in. Converting partner reports and drafting action plans inside the LIMS (instead of in Report Studio) can come later.

## How to run it

1. Install **Node.js LTS** (version 22.13 or newer) from https://nodejs.org. Use the default options.
2. Unzip this folder anywhere, for example on the Desktop.
3. Start it:
   - **Windows:** double-click `START-LIMS-WINDOWS.bat`.
   - **Mac:** right-click `start-lims-mac.command`, choose Open, then Open again.
4. The LIMS opens in your browser at http://127.0.0.1:3000. Keep the black window open while you use it; close it to stop.

**Trying it with your own data:** use `START-LIMS-OWN-DATA-WINDOWS.bat` (Mac: `start-lims-own-data-mac.command`) instead. It starts an empty LIMS kept in a separate `data-own` folder, so the dummy data and your data never mix. The first start shows the admin email and a one-time password (also saved in `data-own/FIRST-SIGN-IN.txt`). Then, as admin, add your settings, tests and prices, franchises and their credit, and a sign-in for each person, before registering samples. Run one LIMS at a time.

The demo start file fills the LIMS with dummy accounts, tests and samples. Every demo sign-in uses the password `test1234`:

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

## Going live

See `deploy/GO-LIVE.md`: an AWS Lightsail server in Mumbai with https, automatic restarts and nightly backups to S3, set up by `deploy/setup-server.sh`. With `LIMS_STAGE=live` the test banners go away, sign-in cookies are https-only and dummy data cannot be added. `npm run backup` makes a backup by hand.

## Moving to Stage 2 later

Nothing in the code needs rebuilding. Settings come from environment variables (`src/config.js`): `DATA_DIR`, `PORT`, `HOST`, and `STORAGE` (`local` now, `s3` with `S3_BUCKET` once the AWS bucket exists). The database tables use plain SQL so they can move to PostgreSQL.

## For developers

- Node.js only, no packages to install. `npm test` runs the checks; `npm start` starts without dummy data (the first admin's one-time password is printed and saved in `data/FIRST-SIGN-IN.txt`).
- Code: `src/samples.js` (registration and statuses), `src/billing.js` (pricing, ledger, reminders), `src/tracking.js` (pickups, receipt, dispatch, TAT), `src/receipts.js` (receipt acknowledgements), `src/reports.js` and `src/pdftext.js` (report upload, leak check, approval, release), `src/studio.js` (Report Centre link), `src/counselling.js`, `src/counselling-form.js` and `src/doctext.js` (sessions, form, case file, action plan), `src/track.js` (patient tracking), `src/bulk.js` (Excel upload), `src/admin.js` (master data), `src/monthly.js` and `src/xlsx.js` (monthly report and Excel writer), `src/web/` (pages), `src/db.js` (schema and migrations).
- The partner lab is never named anywhere in the code, screens or messages.
- Look and feel: `src/web/views.js` holds the colours, type and app shell; `src/web/journey.js` groups the statuses into the six parts of the sample journey. The Montserrat typeface in `src/web/static/` is © The Montserrat Project Authors, used under the SIL Open Font License 1.1, and is served from the app itself so it works offline.
