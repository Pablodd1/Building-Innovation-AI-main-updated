// Email Service for Purchase Notifications
// Uses Resend API (https://resend.com) - 3,000 free emails/month

interface PurchaseRequest {
  id: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  cart_items: Array<{
    materialId: string;
    materialName: string;
    quantity: number;
    unitCost: number;
  }>;
  total_estimate: number;
  currency: string;
  project_notes?: string;
  created_at: string;
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Get API key from environment variable
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@constructviz.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@constructviz.com';

/**
 * Send confirmation email to customer
 */
export async function sendCustomerConfirmation(
  request: PurchaseRequest
): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const itemsList = request.cart_items
    .map(
      (item) =>
        `<li><strong>${item.materialName}</strong> - Qty: ${item.quantity} - $${item.unitCost.toFixed(2)} each</li>`
    )
    .join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
    .total { font-size: 24px; color: #667eea; font-weight: bold; }
    ul { padding-left: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Quote Request Received!</h1>
    </div>
    <div class="content">
      <p>Hi <strong>${request.customer_name}</strong>,</p>
      
      <p>Thank you for your interest in our materials! We've received your quote request and one of our specialists will contact you shortly.</p>
      
      <div class="summary">
        <h3>Your Request Summary</h3>
        <ul>
          ${itemsList}
        </ul>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 15px 0;">
        <p class="total">Estimated Total: $${request.total_estimate.toFixed(2)} ${request.currency}</p>
        ${request.project_notes ? `<p><strong>Project Notes:</strong> ${request.project_notes}</p>` : ''}
      </div>
      
      <h3>What happens next?</h3>
      <ol>
        <li>📞 <strong>We'll call you</strong> at <strong>${request.customer_phone}</strong> within 24 hours</li>
        <li>📋 Our specialist will review your project requirements</li>
        <li>✉️ You'll receive a detailed quote via email</li>
        <li>🚀 Once approved, we'll schedule your installation</li>
      </ol>
      
      <p>If you have any immediate questions, please reply to this email or call us at <strong>+1 (555) 123-4567</strong>.</p>
      
      <p>Best regards,<br>
      <strong>ConstructViz Team</strong></p>
    </div>
    <div class="footer">
      <p>Request ID: #${request.id} | Submitted: ${new Date(request.created_at).toLocaleString()}</p>
      <p>© ${new Date().getFullYear()} ConstructViz AI. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `ConstructViz <${FROM_EMAIL}>`,
        to: [request.customer_email],
        subject: `Quote Request Received - Request #${request.id}`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return { success: false, error: errorData.message || 'Email send failed' };
    }

    const data = await response.json();
    console.log('Customer confirmation sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error: any) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send alert to admin about new purchase request
 */
export async function sendAdminAlert(
  request: PurchaseRequest
): Promise<EmailResult> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return { success: false, error: 'Email service not configured' };
  }

  const itemsList = request.cart_items
    .map(
      (item) =>
        `<li><strong>${item.materialName}</strong> - Qty: ${item.quantity} @ $${item.unitCost.toFixed(2)}</li>`
    )
    .join('');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: monospace; line-height: 1.6; color: #1f2937; background: #f3f4f6; }
    .container { max-width: 700px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .header { background: #dc2626; color: white; padding: 20px; }
    .alert-badge { display: inline-block; background: #fca5a5; color: #7f1d1d; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .content { padding: 30px; }
    .info-grid { display: grid; grid-template-columns: 150px 1fr; gap: 10px; background: #f9fafb; padding: 15px; border-radius: 6px; margin: 15px 0; }
    .label { font-weight: bold; color: #6b7280; }
    .action-btn { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 20px; font-weight: bold; }
    .footer { background: #f9fafb; padding: 15px; text-align: center; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="alert-badge">🔔 NEW REQUEST</span>
      <h2 style="margin: 10px 0 5px 0;">Purchase Request #${request.id}</h2>
      <p style="margin: 0; opacity: 0.9;">${new Date(request.created_at).toLocaleString()}</p>
    </div>
    
    <div class="content">
      <h3>Customer Information</h3>
      <div class="info-grid">
        <span class="label">Name:</span>
        <span>${request.customer_name}</span>
        
        <span class="label">Email:</span>
        <span><a href="mailto:${request.customer_email}">${request.customer_email}</a></span>
        
        <span class="label">Phone:</span>
        <span><a href="tel:${request.customer_phone}"><strong>${request.customer_phone}</strong></a></span>

        <span class="label">Address:</span>
        <span>${request.customer_address}</span>
      </div>
      
      <h3>Requested Materials</h3>
      <ul style="background: #fef3c7; padding: 20px; border-radius: 6px;">
        ${itemsList}
      </ul>
      
      <div style="background: #ecfdf5; padding: 15px; border-radius: 6px; border-left: 4px solid #10b981; margin: 20px 0;">
        <p style="margin: 0;"><strong style="font-size: 18px;">💰 Estimated Total: $${request.total_estimate.toFixed(2)} ${request.currency}</strong></p>
      </div>
      
      ${request.project_notes ? `
      <h3>Project Notes</h3>
      <div style="background: #eff6ff; padding: 15px; border-radius: 6px; border-left: 4px solid #3b82f6;">
        <p style="margin: 0;">${request.project_notes}</p>
      </div>
      ` : ''}
      
      <div style="background: #fef2f2; padding: 15px; border-radius: 6px; margin-top: 20px; border-left: 4px solid #ef4444;">
        <p style="margin: 0;"><strong>⚡ Action Required:</strong> Call customer at <strong>${request.customer_phone}</strong> to discuss project details and provide final quote.</p>
      </div>
      
      <a href="http://localhost:5173/admin?view=purchases&id=${request.id}" class="action-btn">
        📋 View in Admin Dashboard
      </a>
    </div>
    
    <div class="footer">
      <p>Request ID: #${request.id} | ConstructViz AI Purchase Management System</p>
    </div>
  </div>
</body>
</html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `ConstructViz Alerts <${FROM_EMAIL}>`,
        to: [ADMIN_EMAIL],
        subject: `🔔 New Purchase Request #${request.id} - ${request.customer_name}`,
        html: htmlContent,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Resend API error:', errorData);
      return { success: false, error: errorData.message || 'Email send failed' };
    }

    const data = await response.json();
    console.log('Admin alert sent:', data.id);
    return { success: true, messageId: data.id };
  } catch (error: any) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send both customer confirmation and admin alert
 */
export async function sendPurchaseNotifications(
  request: PurchaseRequest
): Promise<{ customer: EmailResult; admin: EmailResult }> {
  const [customerResult, adminResult] = await Promise.all([
    sendCustomerConfirmation(request),
    sendAdminAlert(request),
  ]);

  return {
    customer: customerResult,
    admin: adminResult,
  };
}
