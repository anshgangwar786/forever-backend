import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Razorpay from 'razorpay';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const testRazorpay = async () => {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    console.log('Testing with Key ID:', key_id);

    const rzp = new Razorpay({ key_id, key_secret });

    try {
        console.log('Attempting INR order creation...');
        const inrOrder = await rzp.orders.create({
            amount: 50000,
            currency: 'INR',
            receipt: 'rcpt_' + Date.now()
        });
        console.log('✅ INR Order created successfully:', inrOrder.id);
    } catch (e) {
        console.error('❌ INR Order creation error:', e.error || e.message || e);
    }

    try {
        console.log('Attempting USD order creation...');
        const usdOrder = await rzp.orders.create({
            amount: 5000,
            currency: 'USD',
            receipt: 'rcpt_' + Date.now()
        });
        console.log('✅ USD Order created successfully:', usdOrder.id);
    } catch (e) {
        console.error('❌ USD Order creation error:', e.error || e.message || e);
    }
};

testRazorpay();
