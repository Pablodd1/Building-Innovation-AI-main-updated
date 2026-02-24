import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const QUOTE_RECEIVER_EMAIL = process.env.QUOTE_RECEIVER_EMAIL || "comercial.buildinginnovation@gmail.com";

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface QuoteEmailData {
  materialName: string;
  refCode: string;
  quantity: number;
  unitLabel: string;
  width: number;
  height: number;
  estimatedCost: number;
  userEmail: string;
  userName?: string;
}

function createTransport() {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP credentials not configured");
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

export async function sendQuoteEmail(data: QuoteEmailData): Promise<EmailResult> {
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("SMTP credentials not configured");
    return { success: false, error: "Email service not configured. SMTP credentials missing." };
  }

  const transporter = createTransport();

  const subject = `Quote Request - ${data.materialName} (Ref: ${data.refCode})`;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.8; color: #333; background: #f4f4f4; }
    .container { max-width: 600px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: #1a1a2e; color: white; padding: 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 20px; letter-spacing: 2px; }
    .content { padding: 30px; }
    .quote-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .quote-table td { padding: 12px 16px; border-bottom: 1px solid #e5e7eb; }
    .quote-table td:first-child { font-weight: bold; color: #6b7280; width: 40%; }
    .quote-table td:last-child { color: #1f2937; }
    .cost-row td { font-size: 18px; font-weight: bold; border-top: 2px solid #1a1a2e; }
    .cost-row td:last-child { color: #059669; }
    .footer { background: #f9fafb; padding: 16px; text-align: center; color: #9ca3af; font-size: 12px; }
    .user-info { background: #eff6ff; padding: 12px 16px; border-radius: 6px; border-left: 4px solid #3b82f6; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BUILDING INNOVATION</h1>
      <p style="margin: 4px 0 0; opacity: 0.7; font-size: 12px;">QUOTE REQUEST</p>
    </div>
    <div class="content">
      <p>I would like to request a formal quote for the following material:</p>

      <table class="quote-table">
        <tr>
          <td>Material:</td>
          <td>${data.materialName}</td>
        </tr>
        <tr>
          <td>Reference Code:</td>
          <td>${data.refCode}</td>
        </tr>
        <tr>
          <td>Required Quantity:</td>
          <td>${data.quantity} ${data.unitLabel}</td>
        </tr>
        <tr>
          <td>Input Dimensions:</td>
          <td>${data.width}m x ${data.height}m</td>
        </tr>
        <tr class="cost-row">
          <td>Estimated Cost:</td>
          <td>$${Math.round(data.estimatedCost).toLocaleString()}</td>
        </tr>
      </table>

      <div class="user-info">
        <strong>Requested by:</strong> ${data.userName || data.userEmail}<br>
        <strong>Contact Email:</strong> ${data.userEmail}
      </div>
    </div>
    <div class="footer">
      <p>Sent from Building Innovation AI - ${new Date().toLocaleDateString()}</p>
    </div>
  </div>
</body>
</html>
  `;

  const textContent = `I would like to request a formal quote for the following material:

Material: ${data.materialName}
Reference Code: ${data.refCode}
Required Quantity: ${data.quantity} ${data.unitLabel}
Input Dimensions: ${data.width}m x ${data.height}m

Estimated Cost: $${Math.round(data.estimatedCost).toLocaleString()}

Requested by: ${data.userName || data.userEmail}
Contact Email: ${data.userEmail}

Sent from Building Innovation AI - ${new Date().toLocaleDateString()}`;

  try {
    const info = await transporter.sendMail({
      from: `"Building Innovation AI" <${SMTP_USER}>`,
      to: QUOTE_RECEIVER_EMAIL,
      replyTo: data.userEmail,
      subject: subject,
      text: textContent,
      html: htmlContent,
    });

    console.log("Quote email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("Email send error:", error);
    return { success: false, error: error.message };
  }
}
