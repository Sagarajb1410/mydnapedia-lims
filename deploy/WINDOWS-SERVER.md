# Going live on your own Windows Server

The LIMS runs on your Windows remote server. Partners, staff and counsellors open it in their browser at a secure address such as **https://lims.mydnapedia.org**, from anywhere. Client data stays on your server.

The setup takes about 20 minutes. You do it once, over Remote Desktop.

## What you need

- A Windows Server (2016, 2019, 2022 or 2025) that stays switched on, with internet access. 2 GB of memory or more.
- A **public IP address** for the server. Your server provider shows it.
- A **web address** for the LIMS, such as `lims.mydnapedia.org`. You need access to the domain's DNS settings (GoDaddy, Hostinger, and so on).
- Remote Desktop access to the server with an **administrator** account.

## 1. Point the web address at the server (5 minutes)

At your domain provider, add one DNS record:

| Type | Name | Value |
| --- | --- | --- |
| A | lims | the server's public IP address |
| A | demo | the same IP address (only if you want the demo copy) |

It usually works within 10 minutes. It can take up to an hour.

## 2. Open ports 80 and 443 at the provider (5 minutes)

The setup opens them in Windows Firewall itself. Many providers have a second firewall in their own control panel (Azure "Network security group", AWS "Security group", and so on). If yours does, allow **TCP 80** and **TCP 443** from anywhere there.

Don't open port 3000, 8080 or Remote Desktop to everyone. Only 80 and 443 are needed.

If IIS (the Windows web server) is installed and using ports 80 and 443, stop it first: open Services, find "World Wide Web Publishing Service", and set it to Disabled.

## 3. Run the setup (10 minutes)

1. Connect to the server with Remote Desktop.
2. Copy the LIMS zip (for example `MyDNAPedia-LIMS-v1.35.zip`) onto the server, right-click it and choose **Extract All**.
3. Open the extracted folder, then `deploy`, then `windows`.
4. Right-click **SETUP-WINDOWS-SERVER.bat** and choose **Run as administrator**.
5. It asks three questions:
   - **Web address:** `lims.mydnapedia.org`
   - **Your email:** this becomes the first admin sign-in.
   - **Demo address:** `demo.mydnapedia.org`, or press Enter for no demo.
6. It installs Node.js and Caddy (Caddy handles the https certificate), copies the LIMS to `C:\MyDNAPedia`, and starts it.
7. At the end it shows the **first admin email and one-time password** in yellow. Copy them somewhere safe. They are also saved in `C:\MyDNAPedia\data\FIRST-SIGN-IN.txt`. Delete that file after you sign in.

The LIMS and Caddy now start on their own whenever the server restarts, including after Windows Updates. Nobody needs to be signed in to the server.

## 4. First sign-in and setup

1. Open **https://lims.mydnapedia.org** and sign in with the one-time password. Choose your own password.
2. **Admin, Settings:** company GSTIN, PAN, address and bank details, the GST rate, partner lab names (these are blocked in reports) and courier details.
3. **Admin, Tests and prices:** your real tests and prices.
4. **Admin, Report Centre:** check that it says "Installed and linked". The Report Studio file comes in the zip.

## The demo copy

If you gave a demo address, a second, completely separate LIMS runs there with dummy data. Use it for training and for showing new partners how it works. Every demo account uses the password **test1234** (admin@mydnapedia.example, sunrise@demo.example for a franchise, counsellor@demo.example, and so on). Nothing done there touches the real data, and it is not backed up.

## 5. Give partners access

1. **Admin, B2B partners and suppliers:** add each franchise, clinic or supplier, then their opening credit under Billing.
2. **Admin, People:** create a sign-in for each person and link it to their partner. Each person gets a one-time password.
3. Send each person their group's sign-in link (they are also listed under **Admin, Sign-in links**), their email and their one-time password:
   - Franchises, clinics and suppliers: **https://lims.mydnapedia.org/franchise**
   - Counsellors: **https://lims.mydnapedia.org/counsellor**
   - Lab staff and admins: **https://lims.mydnapedia.org/staff**

   They choose their own password at first sign-in. Partners see only Registration, Billing and Lab receipts.

## Past samples

To bring in samples the lab processed before the LIMS: **Samples, Past samples** (or **Upload from Excel**). Download the template and fill one row per sample with the three "Old sample" dates: registered on, received at lab on, and completed (report given) on. Samples with a completed date come in closed. Nothing is sent to patients or partners. Up to 2000 rows per file, and you can do this any time.

## Backups

- Every day the LIMS writes a copy of the database and files to `C:\MyDNAPedia\data\backups` and keeps 14 days.
- These stay on the same server, so also download one each week with **Admin, Download backup**, and keep it on another computer or in cloud storage.
- If your provider offers server snapshots or backups, switch them on as well.

## Updating to a new version

1. Copy the new zip to the server and extract it.
2. Run its `deploy\windows\SETUP-WINDOWS-SERVER.bat` as administrator, the same way as before.

It remembers your answers, takes a backup first, then replaces the program. Your data is kept. The LIMS is offline for about a minute, so update outside working hours.

## If something goes wrong

- **The LIMS messages:** `C:\MyDNAPedia\data\lims.log`
- **The https messages:** `C:\MyDNAPedia\caddy\caddy.log`. "challenge failed" here means the DNS record or ports 80 and 443 aren't reachable from the internet yet.
- **Restart:** open Task Scheduler, find "MyDNAPedia LIMS" and "MyDNAPedia Caddy", right-click each and choose End, then Run. You can also restart the server.
- Send a photo of the window or log to Claude.

## Where things are

| What | Where |
| --- | --- |
| The program | `C:\MyDNAPedia\app` |
| Database, documents, backups, log | `C:\MyDNAPedia\data` (only administrators can open it) |
| Caddy and the https certificate | `C:\MyDNAPedia\caddy` |
| Your answers to the setup | `C:\MyDNAPedia\settings.txt` |
