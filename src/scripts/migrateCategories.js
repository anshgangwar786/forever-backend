import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { slugify } from '../models/category.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const migrate = async () => {
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

    const db = mongoose.connection.db;
    const cats = await db.collection('categories').find({}).toArray();

    const nameToIdMap = new Map();
    for (const c of cats) {
        nameToIdMap.set(c.name.trim().toLowerCase(), c._id);
    }

    const usedSlugs = new Set();

    for (const c of cats) {
        let baseSlug = c.slug || slugify(c.name);
        let slug = baseSlug;
        let counter = 1;
        while (usedSlugs.has(slug)) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }
        usedSlugs.add(slug);

        let parentId = null;
        if (c.parentCategory && typeof c.parentCategory === 'string' && c.parentCategory.trim()) {
            const matchId = nameToIdMap.get(c.parentCategory.trim().toLowerCase());
            if (matchId && matchId.toString() !== c._id.toString()) {
                parentId = matchId;
            }
        } else if (c.parentCategory && mongoose.isValidObjectId(c.parentCategory)) {
            parentId = new mongoose.Types.ObjectId(c.parentCategory);
        }

        await db.collection('categories').updateOne(
            { _id: c._id },
            {
                $set: {
                    name: c.name.trim(),
                    slug,
                    parentCategory: parentId,
                    description: c.description || '',
                    image: c.image || ''
                },
                $unset: {
                    type: '',
                    status: ''
                }
            }
        );
    }

    console.log(`Successfully migrated ${cats.length} categories to new schema structure!`);
    await mongoose.disconnect();
};

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
