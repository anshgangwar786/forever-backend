import multer from "multer"
import path from "path"
import { ApiError } from "../utils/ApiError.js"

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB per image

const storage = multer.diskStorage({
    filename: function (req, file, cb) {
        // Never trust the client filename: keep only a sanitized extension
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "")
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    }
})

const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true)
    cb(new ApiError(400, `Unsupported file type: ${file.mimetype}. Only images are allowed.`))
}

export const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE, files: 10 }
})
