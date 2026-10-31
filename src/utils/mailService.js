import nodemailer from 'nodemailer';
import { escapeHtml } from './escapeHtml.js';

let transporterPromise = null;

const getTransporter = async () => {
    if (transporterPromise) return transporterPromise;

    transporterPromise = (async () => {
        // 1. Check custom SMTP configurations
        if (process.env.SMTP_HOST && process.env.SMTP_USER) {
            return nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
        }

        // 2. Check Gmail configuration
        if (process.env.GMAIL_USER && (process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD)) {
            return nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.GMAIL_USER,
                    pass: process.env.GMAIL_PASS || process.env.GMAIL_APP_PASSWORD
                }
            });
        }

        // 3. Fallback: Ethereal test account or console logger
        try {
            const testAccount = await nodemailer.createTestAccount();
            console.log('📬 [MailService] Created ethereal test email account:', testAccount.user);
            return nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                }
            });
        } catch (err) {
            console.warn('⚠️ [MailService] Could not initialize ethereal transport, falling back to simulated mailer:', err.message);
            return {
                sendMail: async (options) => {
                    console.log('\n================== [SIMULATED EMAIL DISPATCH] ==================');
                    console.log(`To:      ${options.to}`);
                    console.log(`Subject: ${options.subject}`);
                    console.log('----------------------------------------------------------------');
                    return { messageId: 'simulated-' + Date.now() };
                }
            };
        }
    })();

    return transporterPromise;
};

/**
 * Dispatch Review Approval Request Email to Admin and/or Seller
 */
export const sendReviewApprovalEmail = async ({
    review,
    product,
    sellerEmail = null,
    adminEmail = null
}) => {
    try {
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
        const adminUrl = process.env.ADMIN_URL || 'http://localhost:5174';
        const storeAdminEmail = adminEmail || process.env.ADMIN_EMAIL || 'admin@forever.com';

        // Collect recipient emails (Admin + Seller without duplicates)
        const recipientsSet = new Set([storeAdminEmail]);
        if (sellerEmail) {
            recipientsSet.add(sellerEmail);
        }
        const recipients = Array.from(recipientsSet);

        const approveUrl = `${backendUrl}/api/v1/review/mail-action?token=${review.approvalToken}&action=approve`;
        const rejectUrl = `${backendUrl}/api/v1/review/mail-action?token=${review.approvalToken}&action=reject`;
        const adminPanelUrl = `${adminUrl}/reviews`;

        const starsText = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
        const productThumbnail = Array.isArray(product.image) && product.image.length > 0 ? product.image[0] : '';

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Review Approval Request</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f7f9; margin: 0; padding: 24px; color: #1e293b; }
            .container { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
            .header { background: #0f172a; padding: 28px; text-align: center; color: #ffffff; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 2px; }
            .header p { margin: 6px 0 0; font-size: 13px; color: #94a3b8; }
            .badge-pending { display: inline-block; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 12px; }
            .content { padding: 32px 28px; }
            .product-box { display: flex; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 24px; gap: 16px; }
            .product-img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; }
            .product-info h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #0f172a; }
            .product-info p { margin: 0; font-size: 12px; color: #64748b; }
            .review-card { background: #ffffff; border: 1px solid #e2e8f0; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 28px; }
            .reviewer-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
            .reviewer-name { font-weight: 600; font-size: 14px; color: #0f172a; }
            .verified-tag { background: #ecfdf5; color: #047857; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; border: 1px solid #a7f3d0; }
            .stars { color: #f59e0b; font-size: 18px; letter-spacing: 2px; margin-bottom: 8px; }
            .review-title { font-weight: 600; font-size: 14px; color: #1e293b; margin: 0 0 6px; }
            .review-body { font-size: 13px; line-height: 1.6; color: #475569; margin: 0; }
            .action-buttons { display: flex; gap: 14px; margin-bottom: 24px; }
            .btn { flex: 1; text-align: center; padding: 14px 20px; font-size: 14px; font-weight: 700; border-radius: 10px; text-decoration: none; display: inline-block; transition: opacity 0.2s; }
            .btn-approve { background: #10b981; color: #ffffff !important; }
            .btn-reject { background: #ef4444; color: #ffffff !important; }
            .admin-link { display: block; text-align: center; font-size: 12px; color: #64748b; text-decoration: underline; margin-top: 16px; }
            .footer { background: #f8fafc; padding: 20px 28px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>FOREVER.</h1>
              <p>Product Review Moderation Notification</p>
              <div class="badge-pending">Action Required: Pending Approval</div>
            </div>
            
            <div class="content">
              <p style="font-size: 14px; margin-top: 0; color: #334155;">
                Hello Store Admin / Seller,<br><br>
                A customer has submitted a new review for <strong>"${escapeHtml(product.name)}"</strong>. Customer reviews require your approval before becoming visible on the store front.
              </p>

              <div class="product-box">
                ${productThumbnail ? `<img src="${productThumbnail}" alt="${escapeHtml(product.name)}" class="product-img" />` : ''}
                <div class="product-info">
                  <h3>${escapeHtml(product.name)}</h3>
                  <p>Category: ${escapeHtml(product.category)} / ${escapeHtml(product.subCategory || 'General')} &bull; Seller: ${escapeHtml(product.storeName || 'Forever Head Office')}</p>
                </div>
              </div>

              <div class="review-card">
                <div class="reviewer-row">
                  <span class="reviewer-name">${escapeHtml(review.userName)}</span>
                  ${review.verifiedPurchase ? '<span class="verified-tag">✓ Verified Buyer</span>' : ''}
                </div>
                <div class="stars">${starsText} (${review.rating} / 5)</div>
                ${review.title ? `<p class="review-title">"${escapeHtml(review.title)}"</p>` : ''}
                <p class="review-body">${escapeHtml(review.comment)}</p>
                <p style="font-size: 11px; color: #94a3b8; margin: 12px 0 0;">Submitted on: ${new Date(review.createdAt || Date.now()).toLocaleString()}</p>
              </div>

              <p style="font-size: 13px; font-weight: 600; text-align: center; margin-bottom: 14px; color: #0f172a;">
                Approve or reject this review directly from this email:
              </p>

              <div style="text-align: center; margin: 20px 0;">
                <a href="${approveUrl}" style="background-color: #10b981; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 12px; display: inline-block;">
                  ✓ Approve Review
                </a>
                <a href="${rejectUrl}" style="background-color: #ef4444; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                  ✕ Reject Review
                </a>
              </div>

              <a href="${adminPanelUrl}" class="admin-link">
                Or manage all reviews inside the Admin Panel
              </a>
            </div>

            <div class="footer">
              This is an automated notification from Forever E-Commerce Platform.<br>
              One-click tokens are securely signed and intended for store administrators and verified sellers.
            </div>
          </div>
        </body>
        </html>
        `;

        const transporter = await getTransporter();
        const mailOptions = {
            from: `"Forever Store Moderation" <${storeAdminEmail}>`,
            to: recipients.join(', '),
            subject: `[Review Approval Required] New ${review.rating}★ Review for ${product.name}`,
            html,
            text: `A new ${review.rating}-star review for "${product.name}" was submitted by ${review.userName}.\n\nReview: ${review.comment}\n\nApprove: ${approveUrl}\nReject: ${rejectUrl}\nAdmin Panel: ${adminPanelUrl}`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('\n================================================================');
        console.log('📧 [Review Approval Email Dispatched]');
        console.log(`Product:     ${product.name}`);
        console.log(`Reviewer:    ${review.userName} (${review.rating}★)`);
        console.log(`Recipients:  ${recipients.join(', ')}`);
        console.log(`👉 APPROVE:  ${approveUrl}`);
        console.log(`👉 REJECT:   ${rejectUrl}`);
        if (nodemailer.getTestMessageUrl && info && nodemailer.getTestMessageUrl(info)) {
            console.log(`🌐 Preview:  ${nodemailer.getTestMessageUrl(info)}`);
        }
        console.log('================================================================\n');

        return { success: true, approveUrl, rejectUrl };
    } catch (error) {
        console.error('❌ Error sending review approval email:', error.message);
        return { success: false, error: error.message };
    }
};
