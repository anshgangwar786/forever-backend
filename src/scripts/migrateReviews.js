import { connectDB } from '../db/MongoDB.js';
import { Review } from '../models/review.model.js';
import dotenv from 'dotenv';
dotenv.config();

const migrate = async () => {
    try {
        await connectDB();
        const result = await Review.updateMany(
            { status: { $exists: false } },
            { $set: { status: 'approved', isApproved: true } }
        );
        console.log('Migrated reviews without status:', result);
        const allReviews = await Review.find();
        console.log('Current reviews in DB:', allReviews.map(r => ({ id: r._id, status: r.status, isApproved: r.isApproved })));
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();
