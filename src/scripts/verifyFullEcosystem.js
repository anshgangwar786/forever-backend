import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { app } from '../app.js';
import { Order } from '../models/order.model.js';
import { Payment } from '../models/payment.model.js';
import { User } from '../models/user.model.js';
import { Product } from '../models/product.model.js';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const verifyEcosystem = async () => {
    console.log('================================================================');
    console.log('🚀 RUNNING COMPREHENSIVE ECOSYSTEM INTEGRATION TEST');
    console.log('   Testing: Database (MongoDB Atlas) <-> Backend APIs <-> Admin & Frontend Flow');
    console.log('================================================================\n');

    const uri = process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
    let connectionString;
    if (uri.includes('?')) {
        const [base, query] = uri.split('?');
        const cleanBase = base.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`) ? `${cleanBase}?${query}` : `${cleanBase}/${DB_NAME}?${query}`;
    } else {
        const cleanBase = uri.replace(/\/+$/, '');
        connectionString = cleanBase.endsWith(`/${DB_NAME}`) ? cleanBase : `${cleanBase}/${DB_NAME}`;
    }

    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 10000 });
    console.log('✅ 1. Database Connection: Connected to MongoDB Atlas ("' + DB_NAME + '")');

    // Start a test server on a free port
    const server = app.listen(0);
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`✅ 2. Backend Server: Active on ephemeral test port ${port}`);

    try {
        // --- STEP 1: Verify Catalog in DB ---
        console.log('\n--- Step 1: Catalog Verification ---');
        const prodRes = await fetch(`${baseUrl}/api/v1/product/list`);
        const prodData = await prodRes.json();
        const productList = Array.isArray(prodData.data) ? prodData.data : (Array.isArray(prodData.products) ? prodData.products : []);
        if (!prodData.success || productList.length === 0) {
            throw new Error(`Failed to fetch catalog or catalog is empty (success: ${prodData.success}, count: ${productList.length})`);
        }
        console.log(`✅ Fetched catalog successfully: ${productList.length} products found in MongoDB`);
        
        const categoriesFound = new Set(productList.map(p => p.category));
        console.log(`   Discovered Categories: ${Array.from(categoriesFound).join(', ')}`);

        // Select a product to purchase
        const sampleProduct = productList.find(p => p.stock > 0) || productList[0];
        console.log(`   Selected item for order: "${sampleProduct.name}" (ID: ${sampleProduct._id}, Price: $${sampleProduct.price})`);

        // --- STEP 2: Buyer Authentication ---
        console.log('\n--- Step 2: Buyer Authentication ---');
        let buyerUser = await User.findOne({ role: 'user' });
        if (!buyerUser) {
            buyerUser = await User.create({
                name: 'Ecosystem Buyer',
                email: `buyer_${Date.now()}@example.com`,
                password: 'Password123!',
                role: 'user'
            });
        }

        const buyerToken = jwt.sign(
            { id: buyerUser._id.toString(), email: buyerUser.email, role: 'user' },
            process.env.JWT_TOKEN_SECRET || 'secret',
            { expiresIn: '2h' }
        );
        console.log(`✅ Buyer authenticated: ${buyerUser.email} (ID: ${buyerUser._id})`);

        // --- STEP 3: Customer Places an Order (Storefront Flow) ---
        console.log('\n--- Step 3: Frontend Storefront Order Placement ---');
        const orderPayload = {
            address: {
                firstName: 'Jane',
                lastName: 'Marketplace',
                email: buyerUser.email,
                street: '456 Innovation Way',
                city: 'Austin',
                state: 'TX',
                zipcode: '78701',
                country: 'USA',
                phone: '+15125550199'
            },
            items: [
                {
                    _id: sampleProduct._id.toString(),
                    name: sampleProduct.name,
                    price: sampleProduct.price,
                    quantity: 1,
                    size: sampleProduct.sizes?.[0] || 'Standard'
                }
            ],
            amount: sampleProduct.price + 10 // item + shipping
        };

        const placeRes = await fetch(`${baseUrl}/api/v1/order/place`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: buyerToken
            },
            body: JSON.stringify(orderPayload)
        });

        const placeResult = await placeRes.json();
        if (!placeResult.success) {
            throw new Error(`Order placement failed: ${placeResult.message}`);
        }
        console.log(`✅ Order placed successfully! Message: "${placeResult.message}"`);

        // --- STEP 4: Verify MongoDB Orders and Payments Collections ---
        console.log('\n--- Step 4: MongoDB Transaction Ledger Verification ---');
        const createdOrder = await Order.findOne({ userId: buyerUser._id }).sort({ createdAt: -1 });
        if (!createdOrder) {
            throw new Error('Order document not found in MongoDB "orders" collection');
        }
        console.log(`✅ Order recorded in MongoDB "orders" collection:`);
        console.log(`   - Order ID: ${createdOrder._id}`);
        console.log(`   - Order Number: ${createdOrder.orderNumber}`);
        console.log(`   - Grand Total: $${createdOrder.grandTotal}`);
        console.log(`   - Fulfillment Status: ${createdOrder.fulfillmentStatus}`);
        console.log(`   - Payment Status: ${createdOrder.paymentStatus}`);

        const createdPayment = await Payment.findOne({ orderId: createdOrder._id });
        if (!createdPayment) {
            throw new Error('Payment transaction was NOT recorded in MongoDB "payments" collection!');
        }
        console.log(`✅ Payment Transaction recorded in MongoDB "payments" collection:`);
        console.log(`   - Transaction ID: ${createdPayment.transactionId}`);
        console.log(`   - Payment Provider: ${createdPayment.paymentProvider}`);
        console.log(`   - Amount: $${createdPayment.amount} ${createdPayment.currency}`);
        console.log(`   - Status: ${createdPayment.status}`);
        console.log(`   - Linked Order ID: ${createdPayment.orderId}`);

        // --- STEP 5: Admin Panel Ledger & Orders Access ---
        console.log('\n--- Step 5: Admin Panel Ledger & Verification ---');
        let adminUser = await User.findOne({ role: 'admin' });
        if (!adminUser) {
            adminUser = await User.create({
                name: 'Super Admin',
                email: 'admin@forever.com',
                password: 'adminpassword',
                role: 'admin'
            });
        }

        const adminToken = jwt.sign(
            { id: adminUser._id.toString(), email: adminUser.email, role: 'admin' },
            process.env.ADMIN_JWT_SECRET || process.env.JWT_TOKEN_SECRET || 'secret',
            { expiresIn: '2h' }
        );

        // Fetch Admin Transaction Ledger (GET /api/v1/payment/list)
        const ledgerRes = await fetch(`${baseUrl}/api/v1/payment/list`, {
            headers: { token: adminToken }
        });
        const ledgerData = await ledgerRes.json();
        if (!ledgerData.success || !Array.isArray(ledgerData.data?.payments)) {
            throw new Error(`Failed to fetch admin transactions: ${ledgerData.message}`);
        }
        
        const matchedTxn = ledgerData.data.payments.find(p => p._id.toString() === createdPayment._id.toString() || p.orderId?._id?.toString() === createdOrder._id.toString() || p.orderId?.toString() === createdOrder._id.toString());
        if (!matchedTxn) {
            throw new Error('Newly created transaction was not visible in Admin transaction ledger!');
        }
        console.log(`✅ Transaction verified in Admin Transaction Ledger (GET /api/v1/payment/list):`);
        console.log(`   - Total Ledger Records: ${ledgerData.data.payments.length}`);
        console.log(`   - Ledger Entry TXN: ${matchedTxn.transactionId}`);
        console.log(`   - Current Ledger Status: ${matchedTxn.status}`);

        // --- STEP 6: Admin Status Update to Delivered & Payment Transition ---
        console.log('\n--- Step 6: Admin Fulfillment & Ledger Auto-Reconciliation ---');
        const updateRes = await fetch(`${baseUrl}/api/v1/order/status`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: adminToken
            },
            body: JSON.stringify({
                orderId: createdOrder._id.toString(),
                status: 'Delivered'
            })
        });

        const updateData = await updateRes.json();
        if (!updateData.success) {
            throw new Error(`Failed to update order status: ${updateData.message}`);
        }
        console.log(`✅ Admin updated order status to "Delivered"`);

        // Check updated Order and Payment status in Database
        const refreshedOrder = await Order.findById(createdOrder._id);
        const refreshedPayment = await Payment.findById(createdPayment._id);

        console.log(`   - Updated Order fulfillmentStatus: ${refreshedOrder.fulfillmentStatus}`);
        console.log(`   - Updated Order paymentStatus: ${refreshedOrder.paymentStatus}`);
        console.log(`   - Updated Payment status: ${refreshedPayment.status}`);

        if (refreshedOrder.paymentStatus !== 'Paid') {
            throw new Error(`Expected order.paymentStatus to be 'Paid', got '${refreshedOrder.paymentStatus}'`);
        }
        if (refreshedPayment.status !== 'Success') {
            throw new Error(`Expected payment.status to be 'Success', got '${refreshedPayment.status}'`);
        }

        // --- STEP 7: Verify Admin Dashboard Stats ---
        console.log('\n--- Step 7: Admin Dashboard Verification ---');
        const dashRes = await fetch(`${baseUrl}/api/v1/order/dashboard`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                token: adminToken
            },
            body: JSON.stringify({})
        });
        const dashData = await dashRes.json();
        if (!dashData.success) {
            throw new Error(`Failed to fetch admin dashboard: ${dashData.message}`);
        }
        console.log(`✅ Admin Dashboard Metrics (POST /api/v1/order/dashboard):`);
        console.log(`   - Total Revenue: $${dashData.data.totalRevenue || 0}`);
        console.log(`   - Total Orders: ${dashData.data.totalOrders || 0}`);
        console.log(`   - Delivered Orders: ${dashData.data.deliveredOrders || 0}`);
        console.log(`   - Pending Orders: ${dashData.data.pendingOrders || 0}`);
        console.log(`   - Total Products: ${dashData.data.totalProducts || 0}`);
        console.log(`   - Total Users: ${dashData.data.totalUsers || 0}`);
        console.log(`   - Payment Methods Distribution:`, dashData.data.paymentDistribution);

        console.log('\n================================================================');
        console.log('🎉 ALL INTEGRATION TESTS PASSED WITH 100% SUCCESS!');
        console.log('   - MongoDB Database: Mapped & storing Products, Orders, Payments, Users');
        console.log('   - Storefront Checkout: Placing orders & initiating transactions');
        console.log('   - Admin Panel: Real-time Ledger, Order status updates & Financial Analytics');
        console.log('================================================================');

    } finally {
        server.close();
        await mongoose.disconnect();
    }
};

verifyEcosystem().catch(err => {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
});
