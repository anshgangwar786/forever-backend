import mongoose from 'mongoose'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin', 'seller'], default: 'user' },
    storeName: { type: String, default: '' },
    phone: { type: String, default: '' },
    cartData: { type: Object, default: {} },
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, default: '' },
    twoFactorTempSecret: { type: String, default: '' },
    twoFactorBackupCodes: [
        {
            code: { type: String },
            used: { type: Boolean, default: false }
        }
    ]
}, { timestamps: true, minimize: false }) //using this minimize properties we can also save empty object in database

userSchema.pre("save", async function(){
    try {
        if (!this.isModified("password")) return ;
        this.password = await bcrypt.hash(this.password,10);
        
    } catch (error) {
        
    }
})

userSchema.methods.isPasswordCorrect = async function(password){
    return await bcrypt.compare(password,this.password)
}

userSchema.methods.generateJwtToken = function(){
    return jwt.sign({
        id: this._id,
        email: this.email,
        role: this.role || 'user'
    },
    process.env.JWT_TOKEN_SECRET,
    {
        expiresIn: process.env.JWT_TOKEN_EXPIRE || '7d'
    })
}



export const User = mongoose.model('User',userSchema)