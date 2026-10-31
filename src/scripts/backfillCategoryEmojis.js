import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { DEFAULT_CATEGORY_EMOJIS } from '../utils/categoryEmojis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Sets a default emoji on categories that don't have one yet.
 * Categories with an emoji already chosen are left untouched.
 */
const backfill = async () => {
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

    await mongoose.connect(connectionString, { serverSelectionTimeoutMS: 8000 });
    console.log('Connected to DB');

    const collection = mongoose.connection.db.collection('categories');
    let updated = 0;

    for (const [slug, emoji] of Object.entries(DEFAULT_CATEGORY_EMOJIS)) {
        const result = await collection.updateOne(
            { slug, $or: [{ emoji: { $exists: false } }, { emoji: '' }, { emoji: null }] },
            { $set: { emoji } }
        );
        updated += result.modifiedCount;
    }

    console.log(`Backfilled emoji on ${updated} categories.`);
    await mongoose.disconnect();
};

backfill().catch(err => {
    console.error(err);
    process.exit(1);
});
