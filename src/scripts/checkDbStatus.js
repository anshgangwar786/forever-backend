import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const checkDb = async () => {
    const uri = process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
    let cs = uri.includes('?') ? uri.replace(/\/?\?/, '/' + DB_NAME + '?') : uri + '/' + DB_NAME;
    await mongoose.connect(cs);
    const Payment = mongoose.model('Payment', new mongoose.Schema({}, { strict: false }));
    const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }));

    const payments = await Payment.find({}).sort({ createdAt: -1 });
    const orders = await Order.find({}).sort({ createdAt: -1 });

    console.log('Total Orders in DB:', orders.length);
    console.log('Total Payments in DB:', payments.length);
    payments.forEach((p, idx) => {
        console.log(`[#${idx+1}] ID: ${p._id} | TxnId: ${p.transactionId} | Status: ${p.status} | Amount: $${p.amount} | Provider: ${p.paymentProvider} | OrderId: ${p.orderId}`);
    });

    await mongoose.disconnect();
};

checkDb().catch(console.error);
