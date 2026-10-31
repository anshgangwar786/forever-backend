import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const testCheckout = async () => {
    const baseUrl = 'http://localhost:4000';
    console.log('Testing against live server:', baseUrl);

    // 1. Fetch product list
    const prodRes = await fetch(`${baseUrl}/api/v1/product/list`);
    const prodData = await prodRes.json();
    const products = Array.isArray(prodData.data) ? prodData.data : prodData.products;
    const testItem = products.find(p => p.stock > 0) || products[0];
    console.log(`Using product: ${testItem.name} (ID: ${testItem._id})`);

    // 2. Create customer token
    const customerToken = jwt.sign(
        { id: '6adedef35d3676ee093d3896', email: 'tester_1792990963739@forever.com', role: 'user' },
        process.env.JWT_TOKEN_SECRET || 'secret',
        { expiresIn: '1h' }
    );

    // 3. Test Razorpay order creation
    console.log('\n--- 1. Testing POST /api/v1/order/razorpay ---');
    const razorpayPayload = {
        address: {
            firstName: 'Payment',
            lastName: 'Tester',
            email: 'tester_1792990963739@forever.com',
            street: '123 Test St',
            city: 'New York',
            state: 'NY',
            zipcode: '10001',
            country: 'USA',
            phone: '1234567890'
        },
        items: [
            {
                _id: testItem._id.toString(),
                name: testItem.name,
                price: testItem.price,
                quantity: 1,
                size: testItem.sizes?.[0] || 'Standard'
            }
        ],
        amount: testItem.price + 10
    };

    const rzpRes = await fetch(`${baseUrl}/api/v1/order/razorpay`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            token: customerToken
        },
        body: JSON.stringify(razorpayPayload)
    });

    const rzpData = await rzpRes.json();
    console.log('Razorpay response status:', rzpRes.status);
    console.log('Razorpay response body:', JSON.stringify(rzpData, null, 2));

    if (rzpData.success) {
        console.log('\n--- Testing what frontend initPay receives ---');
        console.log('rzpData.data.id:', rzpData.data?.id);
        console.log('rzpData.data.amount:', rzpData.data?.amount);
        console.log('rzpData.data.currency:', rzpData.data?.currency);
        console.log('rzpData.data.receipt:', rzpData.data?.receipt);
        console.log('rzpData.data.order:', rzpData.data?.order?._id);
        console.log('rzpData.data.payment:', rzpData.data?.payment?._id);
        console.log('rzpData.data.gatewayData:', rzpData.data?.gatewayData);
    }
};

testCheckout();
