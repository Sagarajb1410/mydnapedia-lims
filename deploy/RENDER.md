# Going live on Render (Singapore)

Render runs the LIMS for you. It gives it a secure https address, restarts it if it stops, and copies its disk every day. You don't manage a server.

**Data location:** Render has no India region, so client data is stored in **Singapore**. Check with your advisor that this fits your client consent and India's data protection rules (DPDP Act). If data must stay in India, use the AWS Mumbai guide (GO-LIVE.md) instead.

## Cost per month

| Item | Price |
| --- | --- |
| Render workspace, Hobby (one person signs in to Render) | free |
| Web service, Starter (512 MB) | US$7 |
| Disk for the database and files, 5 GB | US$1.25 |
| **Total** | **about US$8.25 (about ₹720)** |

- The free Render plan **cannot** be used. It has no disk, so every restart would wipe all samples.
- If pages feel slow once many people use it, switch to Standard (2 GB) for US$25 a month in Settings. It's one click and keeps your data.
- Hobby includes 5 GB of traffic a month. Each opening of the Report Centre downloads a large file, so heavy use can add a few dollars (US$0.15 per extra GB).
- Optional: the Pro workspace (US$25 a month) is only needed if more than one person must sign in to Render itself. LIMS users don't count towards this.

## 1. Create the Render account (5 minutes)

1. Open **render.com** and choose **Get started**. Sign up with **GitHub**, using the account that owns the LIMS repository.
2. Allow Render to see the **mydnapedia-lims** repository when GitHub asks.
3. Add a payment card under **Billing**.

## 2. Create the LIMS from the blueprint (10 minutes)

1. In Render choose **New**, then **Blueprint**, and pick **mydnapedia-lims**.
2. Render reads `render.yaml`. It creates one web service in Singapore with a 5 GB disk.
3. It asks for two values:
   - **FIRST_ADMIN_EMAIL**: your own email, for example admin@mydnapedia.com
   - **PUBLIC_URL**: the address you'll use, for example https://lims.mydnapedia.com
4. Click **Apply**. The first start takes about 3 minutes.
5. Open the service, then **Logs**. Look for the line *"First run. Sign in as … with the one-time password: …"* and copy the password somewhere safe.

## 3. Your own web address (10 minutes)

1. In the service open **Settings**, then **Custom Domains**, then **Add**. Type `lims.mydnapedia.com`.
2. Render shows one DNS record. At your domain provider (GoDaddy, Hostinger, and so on), add it:

   | Type | Name | Value |
   | --- | --- | --- |
   | CNAME | lims | the address Render shows, like mydnapedia-lims.onrender.com |

3. Click **Verify** back in Render. The https certificate is created automatically, within an hour at most.

Until then, the LIMS also works at the onrender.com address Render shows.

## 4. First sign-in and setup

1. Open the address, sign in with the one-time password, and choose your own password.
2. **Admin, Report Centre:** upload `studio/report-studio.html` from the LIMS zip. It isn't stored in GitHub, so it has to be installed once here. It then stays on the disk.
3. Then follow step 5 of GO-LIVE.md: settings (GSTIN, PAN, bank, GST rate, partner lab names, courier), tests and prices, partners and suppliers with opening credit, and one sign-in per person.

## Backups

- **Render disk snapshot:** every day, kept for 7 days. To restore one, open the service, then **Disks**, then **Snapshots**.
- **LIMS backup:** every day the LIMS also writes a copy of the database and files to `/var/data/backups`, and keeps 14 days. This helps if something is deleted by mistake.
- Both copies are inside Render. For a copy elsewhere, ask for the off-site backup to be added (an S3 bucket or Google Drive).

## Updating to a new version

New versions arrive as merges into **main** on GitHub. Render redeploys on its own within a few minutes, and your data on the disk is kept. The LIMS is offline for about 30 seconds during each update, so update outside working hours.

## If something goes wrong

- **Logs** in the Render service shows the LIMS messages.
- **Manual Deploy, then Restart service** restarts it.
- **Events** shows each deploy and whether it worked.
