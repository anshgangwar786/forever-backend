// Must be the first import: ESM hoists imports, so env vars have to be loaded
// before any module (e.g. the Razorpay client in order.controller) reads them.
import "dotenv/config";
import { app } from "./app.js";
import { connectDB } from "./db/MongoDB.js";
import connectCloudinary from "./config/cloudinary.js";

const REQUIRED_ENV = ["MONGODB_URI", "JWT_TOKEN_SECRET", "ADMIN_JWT_SECRET"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const port = process.env.PORT || 4000;

connectCloudinary();

// On Vercel the platform invokes the exported app per request; elsewhere run a long-lived server.
if (process.env.VERCEL) {
  connectDB().catch((err) => console.error("MongoDB connection failed:", err.message));
} else {
  connectDB()
    .then(() => {
      app.listen(port, () => {
        console.log(`Server running on port ${port}`);
      });
    })
    .catch((err) => {
      console.error("MongoDB connection failed:", err.message);
      process.exit(1);
    });
}

export default app;
