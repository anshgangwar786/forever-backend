import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const run = async () => {
    const uri = process.env.MONGODB_URI;
    const DB_NAME = process.env.DB_NAME || 'ecommerceDB';
    let cs = uri.includes('?') ? uri.replace(/\/?\?/, '/' + DB_NAME + '?') : uri + '/' + DB_NAME;
    await mongoose.connect(cs);
    const Product = mongoose.model('Product', new mongoose.Schema({}, { strict: false }));
    await Product.updateMany({}, { $unset: { 'sizeStock.Standard': 1 } });
    console.log('Cleaned sizeStock.Standard successfully');
    await mongoose.disconnect();
};

run().catch(console.error);
