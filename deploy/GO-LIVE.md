# Going live on AWS (Mumbai)

The live LIMS runs on one small AWS Lightsail server in Mumbai, so client data stays in India. It has its own https address, restarts by itself, and backs up every night. Expect about US$12 a month (₹1,000) for the server, plus a few rupees for backup storage.

You need:
- an AWS account (aws.amazon.com, sign up with a company card)
- your domain (for example mydnapedia.com), with access to its DNS settings
- this LIMS zip

## 1. Create the server (10 minutes)

1. Open **lightsail.aws.amazon.com** and click **Create instance**.
2. Region: **Mumbai (ap-south-1)**.
3. Platform **Linux/Unix**, blueprint **OS Only**, then **Ubuntu 24.04 LTS**.
4. Plan: **2 GB RAM** (US$12 a month).
5. Name it `mydnapedia-lims`, then click **Create instance**.
6. Open the instance, go to **Networking**:
   - click **Attach static IP** and create one. Note the address, for example 13.200.10.20.
   - under **IPv4 Firewall**, click **Add rule** and choose **HTTPS**. HTTP and SSH are there already.
7. Under **Snapshots**, turn on **Automatic snapshots**. This is a daily copy of the whole server.

## 2. Point your web address at it (5 minutes)

At your domain provider (GoDaddy, Hostinger, and so on), add one DNS record:

| Type | Name | Value |
| --- | --- | --- |
| A | lims | your static IP |

The LIMS will then be at **https://lims.yourdomain.com**. The change can take up to an hour to work.

## 3. Backups to S3 (optional, recommended, 10 minutes)

1. Open **S3**, click **Create bucket**, and name it `mydnapedia-lims-backups` with region **Mumbai**. Leave "Block all public access" on. Turn **Bucket Versioning** on.
2. Open **IAM**, then **Users**, then **Create user**, and name it `lims-backup`. Attach a policy that allows only this bucket: choose **Create inline policy**, then **JSON**, and paste:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::mydnapedia-lims-backups" },
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::mydnapedia-lims-backups/*" }
     ]
   }
   ```
3. Open the user, choose **Security credentials**, then **Create access key**, then **Command Line Interface**. Keep the two values for step 4. Never share them in chat or email.

## 4. Install the LIMS (15 minutes)

1. In Lightsail, open the instance and click **Connect using SSH**. A black window opens in your browser.
2. In that window, open the menu (top right) and choose **Upload file**. Pick the LIMS zip.
3. Type these lines, using your own address and email:

   ```
   sudo apt-get install -y unzip
   unzip MyDNAPedia-LIMS-*.zip
   cd MyDNAPedia-LIMS
   sudo bash deploy/setup-server.sh lims.yourdomain.com you@yourdomain.com mydnapedia-lims-backups
   ```
   Leave out the bucket name if you skipped step 3.
4. At the end the window shows the **first admin email and one-time password**. Copy them somewhere safe.
5. If you made the backup bucket, type `sudo aws configure` and paste the two key values. For the region type `ap-south-1`, and press Enter for the last question.

## 5. First sign-in and setup

1. Open https://lims.yourdomain.com and sign in with the one-time password. Choose your own password.
2. **Admin, Settings:**
   - company GSTIN, PAN, address and bank details
   - the GST rate and SAC code your accountant confirms
   - partner lab names (these are blocked in reports)
   - courier details
3. **Admin, Tests and prices:** your real tests and prices.
4. **Admin, B2B partners and suppliers:** each franchise and supplier, then their opening credit under Billing.
5. **Admin, People:** a sign-in for each staff member, counsellor and franchise. Each person gets a one-time password.
6. **Admin, Report Centre:** already installed from the zip. Check that it says "Installed and linked".

## 6. Pilot

Run real samples in the LIMS alongside your current sheet for two weeks, then switch over fully.

## Updating to a new version

Upload the new zip the same way, unzip it, go into the folder and run `sudo bash deploy/update.sh`. It takes a backup first, then restarts the LIMS. Data is kept.

## If something goes wrong

- `sudo systemctl status mydnapedia-lims` shows whether the LIMS is running.
- `sudo journalctl -u mydnapedia-lims -n 50` shows its recent messages.
- `sudo systemctl restart mydnapedia-lims` restarts it.
- Backups are in `/var/lib/mydnapedia-lims/backups` (the last 14 days) and in the S3 bucket.
