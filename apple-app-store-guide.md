# 🍏 Zero-Mac Apple App Store Deployment Guide

This guide enables you to build, sign, test on TestFlight, and publish **Building Innovation AI** to the **Apple App Store** 100% from your Windows computer using automated **GitHub Actions** macOS cloud runners.

---

## 📋 Prerequisites (Done in your Web Browser)

1. An **Apple Developer Program** account at [developer.apple.com](https://developer.apple.com) ($99 USD / year).
2. Your repository pushed to GitHub.

---

## 🚀 Step-by-Step Setup

### Step 1: Generate your Certificate Signing Request (CSR)
We have already created a helper script that uses Windows Git OpenSSL to generate this in 1 second:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\generate-apple-credentials.ps1 -Action GenerateCSR
```
* This generated `apple-credentials/apple_distribution.csr` on your computer.

---

### Step 2: Create Apple Distribution Certificate (Web Browser)
1. Open [https://developer.apple.com/account/resources/certificates/add](https://developer.apple.com/account/resources/certificates/add).
2. Select **Apple Distribution** (or *iOS Distribution*) and click **Continue**.
3. Upload the `apple-credentials/apple_distribution.csr` file created in Step 1.
4. Click **Download** to save `distribution.cer`.
5. Move the downloaded `distribution.cer` into the `apple-credentials\` folder in this project.

---

### Step 3: Convert Certificate to .p12 & Base64
Run this command in PowerShell:
```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\generate-apple-credentials.ps1 -Action ConvertCerToP12
```
* This will create `apple-credentials/BUILD_CERTIFICATE_BASE64.txt`.
* The password is `BuildingInnovation2026!`.

---

### Step 4: Register App ID & Provisioning Profile (Web Browser)
1. **Create App ID:**
   - Go to [https://developer.apple.com/account/resources/identifiers/add/bundleId](https://developer.apple.com/account/resources/identifiers/add/bundleId).
   - Select **App IDs** -> **App**.
   - **Description:** `Building Innovation AI`
   - **Bundle ID (Explicit):** `com.buildinginnovation.app`
   - Click **Continue** -> **Register**.

2. **Create App Store Provisioning Profile:**
   - Go to [https://developer.apple.com/account/resources/profiles/add](https://developer.apple.com/account/resources/profiles/add).
   - Select **App Store** (under *Distribution*) -> Click **Continue**.
   - Select App ID: `com.buildinginnovation.app`.
   - Select the **Apple Distribution Certificate** you created in Step 2.
   - Profile Name: `Building Innovation AppStore`.
   - Click **Generate** and **Download** (you will get `Building_Innovation_AppStore.mobileprovision`).

3. **Encode Provisioning Profile:**
   Run in PowerShell (replace with your downloaded path):
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\scripts\generate-apple-credentials.ps1 -Action EncodeProfile -ProfileFile "C:\path\to\Building_Innovation_AppStore.mobileprovision"
   ```
   * This creates `apple-credentials/BUILD_PROVISION_PROFILE_BASE64.txt`.

---

### Step 5: (Optional for auto-upload) Generate App Store Connect API Key
If you want GitHub Actions to automatically upload the build to TestFlight / App Store:
1. Go to [https://appstoreconnect.apple.com/access/integrations/api](https://appstoreconnect.apple.com/access/integrations/api).
2. Click **Generate API Key** (or **+**).
   - **Name:** `GitHub Actions Deploy`
   - **Access:** `App Manager` or `Admin`.
3. Download the `.p8` file (e.g. `AuthKey_ABCD1234EF.p8`). Note the **Key ID** and **Issuer ID**.
4. Encode the `.p8` file in PowerShell:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File .\scripts\generate-apple-credentials.ps1 -Action EncodeP8Key -P8File "C:\path\to\AuthKey_ABCD1234EF.p8"
   ```

---

### Step 6: Add GitHub Secrets
In your GitHub repository, navigate to:
**Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret Name | Value |
| :--- | :--- |
| `BUILD_CERTIFICATE_BASE64` | Paste full text from `apple-credentials/BUILD_CERTIFICATE_BASE64.txt` |
| `P12_PASSWORD` | `BuildingInnovation2026!` (or custom password you chose) |
| `BUILD_PROVISION_PROFILE_BASE64` | Paste full text from `apple-credentials/BUILD_PROVISION_PROFILE_BASE64.txt` |
| `APPLE_TEAM_ID` | Your 10-character Apple Team ID (shown top-right of developer.apple.com) |
| `APPLE_PROFILE_NAME` | `Building Innovation AppStore` |
| `APP_STORE_CONNECT_API_KEY_BASE64` | Paste full text from `apple-credentials/APP_STORE_CONNECT_API_KEY_BASE64.txt` |
| `APP_STORE_CONNECT_KEY_ID` | Key ID (e.g., `ABCD1234EF`) |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID UUID from App Store Connect |

---

### Step 7: Trigger the Build!
1. Go to your GitHub repository in your web browser.
2. Click the **Actions** tab.
3. In the left sidebar, click **"Build & Deploy iOS App to Apple App Store"**.
4. Click **Run workflow** -> Select `main` -> Click **Run workflow**.

GitHub's cloud Mac runner will automatically:
1. Build the web code and sync Capacitor iOS.
2. Sign the build with your certificate.
3. Export `BuildingInnovation.ipa`.
4. Upload directly to **TestFlight** and **App Store Connect**!
5. Also make the `.ipa` available for direct download on GitHub under the workflow's **Artifacts** tab.
