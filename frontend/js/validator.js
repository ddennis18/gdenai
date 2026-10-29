// =========================================
// CLIENT-SIDE FILE VALIDATION
// =========================================
const Validator = {
    validateFile(file, currentDocCount) {
        // 1. Check Max Documents
        if (currentDocCount >= CONFIG.MAX_DOCUMENTS) {
            return { valid: false, message: `Session limit reached. You can only upload ${CONFIG.MAX_DOCUMENTS} documents.` };
        }

        // 2. Check Extension
        const extension = file.name.split('.').pop().toLowerCase();
        if (!CONFIG.ALLOWED_EXTENSIONS.includes(extension)) {
            return { valid: false, message: `Invalid file type. Only PDF, DOCX, and TXT are allowed.` };
        }

        // 3. Check File Size
        const sizeInMB = file.size / (1024 * 1024);
        if (sizeInMB > CONFIG.MAX_FILE_SIZE_MB) {
            return { valid: false, message: `File is too large. Maximum size is ${CONFIG.MAX_FILE_SIZE_MB}MB.` };
        }

        return { valid: true };
    }
};
