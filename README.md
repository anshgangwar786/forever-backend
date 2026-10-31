# 🛍️ Forever — Backend API

REST API for **Forever**, a multi-vendor e-commerce platform. Built with **Express 5 + MongoDB**, it powers the Forever storefront and the Forever admin panel. It handles authentication with optional 2FA, role-based access control, Cloudinary media uploads, product reviews, coupons, and payments through Razorpay, Stripe and Cash on Delivery.

![Node.js](https://img.shields.io/badge/Node.js_20+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express_5-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![Razorpay](https://img.shields.io/badge/Razorpay-0C2451?style=for-the-badge&logo=razorpay&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white)

> Part of the Forever platform: **forever-backend** (this repo) · **forever-frontend** (storefront) · **forever-admin** (admin & seller panel)

---

## 🧑‍💻 Tech Stack

Node.js 20+, Express 5, MongoDB + Mongoose 9, JWT, bcrypt, Multer, express-rate-limit, Nodemailer, otplib + qrcode (2FA), Cloudinary, Razorpay, Stripe.

---

## 📁 Project Structure

```
forever-backend/
├── src/
│   ├── config/        # Cloudinary setup
│   ├── controllers/   # cart, category, order, payment, product, review, user
│   ├── db/            # MongoDB connection
│   ├── middlewares/   # auth, admin auth, RBAC/ACL, rate limiting, validation, payment verification, uploads
│   ├── models/        # Mongoose schemas
│   ├── routes/        # /api/v1 routers
│   ├── scripts/       # migrations, seeding and verification scripts
│   ├── utils/         # ApiError/ApiResponse, mail, TOTP, pricing helpers
│   ├── app.js
│   └── server.js
├── nodemon.json
└── vercel.json
```

Request pipeline:

```
CORS → rate limit → sanitise → JWT auth → RBAC → controllers → MongoDB / Cloudinary / Razorpay / Stripe
```

---

## 🔗 API Reference

Base URL: `/api/v1` · Health check: `GET /` → `"Forever eCommerce API is running..."`

| Area | Routes |
| --- | --- |
| Auth | `POST /user/register` · `/user/login` · `/user/admin` · `/user/register-seller` · `/user/logout` |
| 2FA | `POST /user/2fa/setup` · `/2fa/verify-setup` · `/2fa/verify-login` · `/2fa/disable` · `/2fa/regenerate-backup-codes` · `GET /user/2fa/status` |
| Profile | `GET/PUT /user/profile` · `POST /user/update-profile` |
| Users (admin) | `GET /user/all` · `POST /user/create` · `/user/update-user` · `/user/role` · `/user/delete` · `DELETE /user/:id` |
| Products | `GET /product/list` · `POST /product/single` · seller/admin: `POST /product/add` · `/update` · `/discount` · `/remove` · `GET /product/insights/:productId` |
| Categories | `GET /category` · `/category/list` · `/category/:id` · admin: `POST /category` · `PUT/DELETE /category/:id` |
| Cart | `POST /cart/get` · `/cart/add` · `/cart/update` |
| Orders | `POST /order/checkout` · `/order/place` · `/order/razorpay` · `/order/verifyRazorpay` · `/order/validate-coupon` · `GET /order/userorders` · seller/admin: `GET /order/list` · `/order/dashboard` · `POST /order/status` · `/order/delete` |
| Payments | `POST /payment/checkout` · `/payment/verify` · `/payment/webhook` · `GET /payment/order/:orderId` · seller/admin: `GET /payment/list` · `POST /payment/refund` |
| Reviews | `GET /review/product/:productId` · `/review/my-review/:productId` · `POST /review/add` · `DELETE /review/:id` · seller/admin: `GET /review/admin/list` · `POST /review/admin/update-status` |
| Newsletter | `POST /newsletter/subscribe` |

---

## 🔐 Security

- JWT authentication with server-side token revocation (logout blacklist)
- Role-based access control (buyer / seller / admin) with ownership checks
- Optional TOTP two-factor authentication with backup codes
- CORS restricted to the configured storefront and admin origins (plus `CORS_ORIGINS`)
- Rate limiting on all API routes, stricter on credential endpoints
- NoSQL-injection input sanitisation and 16 KB request body limit
- Server-side pricing — client-sent prices are never trusted
- Razorpay signature verification (timing-safe HMAC) and signed webhooks
- Image uploads restricted to image MIME types, 5 MB each

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and fill it in — `.env` is git-ignored.

Required (the server refuses to start without them):

- `MONGODB_URI`, `JWT_TOKEN_SECRET`, `ADMIN_JWT_SECRET`
- `FRONTEND_URL` / `ADMIN_URL` — storefront and admin origins for CORS and email links

Optional:

- **Cloudinary** — `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_SECRET_KEY`
- **Razorpay** — `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Email** — `SMTP_*` or `GMAIL_USER` / `GMAIL_APP_PASSWORD` (emails are logged to the console if neither is set)
- **Super admin** — `ADMIN_EMAIL` / `ADMIN_PASSWORD` (the env super-admin login is disabled while `ADMIN_PASSWORD` is empty)
- `CORS_ORIGINS` — extra allowed origins, comma separated

`ALLOW_MOCK_PAYMENTS` and `ALLOW_UNSIGNED_WEBHOOKS` are test-only switches — leave them unset in production.

---

## ▶️ Run Locally

Requires **Node.js 20+** and a MongoDB instance (local or Atlas).

```bash
git clone https://github.com/anshgangwar786/forever-backend.git
cd forever-backend
cp .env.example .env   # then edit values
npm install
npm run dev            # http://localhost:4000
```

### Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm start` | Start in production mode |
| `npm run migrate:orders` | Migrate legacy order documents |
| `npm run backfill:category-emojis` | Add emojis to existing categories |

---

## 🚢 Deployment

Deployed on **Vercel** as a serverless function via [vercel.json](vercel.json).

Production checklist:

- `NODE_ENV=production` (hides internal error details, disables localhost CORS)
- Strong, distinct `JWT_TOKEN_SECRET` and `ADMIN_JWT_SECRET`
- `FRONTEND_URL` / `ADMIN_URL` set to the real deployed origins
- `RAZORPAY_WEBHOOK_SECRET` configured if webhooks are used

---

## 👨‍💻 Author

**Ansh Gangwar** — Full-Stack Developer

🔗 GitHub: https://github.com/anshgangwar786<br>
🔗 LinkedIn: https://www.linkedin.com/in/ansh-gangwar/
