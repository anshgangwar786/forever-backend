import mongoose from 'mongoose'
import { DB_NAME } from '../constant.js';

const connectDB = async () => {
    try {
        let uri = process.env.MONGODB_URI;
        if (!uri) {
            throw new Error("MONGODB_URI is not set in environment variables");
        }
        let connectionString;
        if (uri.includes('?')) {
            const [base, query] = uri.split('?');
            const cleanBase = base.replace(/\/+$/, '');
            connectionString = cleanBase.endsWith(`/${DB_NAME}`)
                ? `${cleanBase}?${query}`
                : `${cleanBase}/${DB_NAME}?${query}`;
        } else {
            const cleanBase = uri.replace(/\/+$/, '');
            connectionString = cleanBase.endsWith(`/${DB_NAME}`)
                ? cleanBase
                : `${cleanBase}/${DB_NAME}`;
        }

        const connection = await mongoose.connect(connectionString, {
            serverSelectionTimeoutMS: 5000
        })
        console.log(`\n MongoDB Connected DB HOST : ${connection.connection.host}`);
        
    } catch (error) {
        console.log("MongoDB Connection Error:" , error.message)
        // Re-throw so the caller can refuse to start instead of serving requests without a DB
        throw error
    }
}
export {connectDB}