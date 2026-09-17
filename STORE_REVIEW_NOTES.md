# App Store & Google Play Compliance Package

This document contains all the necessary legal texts, review notes, and data safety configurations you need to copy and paste into Google Play Console and Apple App Store Connect to ensure your app is approved without rejections.

## 1. Privacy Policy (Mandatory for both stores)
*You must host this text on a public webpage (e.g., your website) and paste the URL in both stores.*

**Privacy Policy for Building Innovation AI**
**Last Updated: September 2026**

**1. Introduction**
Building Innovation AI ("we", "our", or "us") respects your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use our mobile application.

**2. Data Collection and Usage**
- **Photos and Camera:** Our app requires access to your device's camera and photo gallery to function. Images you upload are sent to our secure servers to be processed by our Artificial Intelligence (AI) algorithms to generate architectural and interior design visualizations. 
- **AI Processing:** The images you provide are strictly used for generating the requested room visualizations. We do not use your personal images to train our AI models without explicit consent.
- **Analytics and Crash Data:** We collect anonymous usage data and crash reports to improve app performance.

**3. Data Sharing and Security**
We do not sell, rent, or share your personal data or uploaded images with third parties for advertising or marketing purposes. All data transmission is secured using industry-standard encryption (HTTPS).

**4. Data Retention and Deletion**
Images processed by our AI are stored temporarily to deliver the result to your device and are then deleted from our active processing servers. If you create an account, you have the right to request the deletion of your account and all associated data at any time through the app's settings or by contacting our support team.

**5. Contact Us**
If you have questions about this Privacy Policy, please contact us at: support@buildinginnovation.us

---

## 2. Review Notes / Instrucciones de Prueba (Mandatory)
*Paste this into the "App Review Information" (Apple) and "App Access / Test Instructions" (Google).*

**Demo Account / Acceso de Prueba:**
- **User:** `(Provide a test email here if login is required, e.g., reviewer@buildinginnovation.us)`
- **Password:** `(Provide a test password here)`
*(Note: If the app can be fully tested using the "Skip for now (Demo)" button, explicitly state: "Reviewers can test the core AI visualization features without an account by tapping the 'Skip for now (Demo)' button on the launch screen.")*

**Feature Explanation (AI & Photos):**
"This app is an AI-powered interior design and architectural visualizer. It requires camera and photo library access so users can upload photos of their own physical rooms. The images are processed by our backend AI to show how different construction materials (floors, walls) would look in their real space. We do not use this permission for any other purpose."

---

## 3. Data Safety Form (Google) / App Privacy Labels (Apple)
When filling out the privacy questionnaires on the store consoles, you must declare the following:

**Data Types Collected:**
- **Photos/Media:** Yes. (Purpose: App Functionality).
- **Crash Logs / Diagnostics:** Yes. (Purpose: Analytics).
- **Personal Info (Email/Name):** Yes, *if* the user creates an account. (Purpose: App Functionality/Account Management).

**Key Questions you must answer YES to:**
- *Is data encrypted in transit?* **Yes**
- *Do you provide a way for users to request data deletion?* **Yes**
- *Is this app a "News" app?* **No**
- *Is this app directed at children (COPPA)?* **No** (Set target age to 13+ or 18+).

---

## 4. Required Code Permissions (iOS)
*(Already handled in your code, but keep this for reference if Apple asks)*
Ensure your `Info.plist` (iOS) contains these exact justification strings for the reviewers:
- `NSCameraUsageDescription`: "We need camera access so you can take photos of your room to visualize new architectural materials with our AI."
- `NSPhotoLibraryUsageDescription`: "We need access to your photo library so you can select room photos to apply AI-generated architectural materials."
