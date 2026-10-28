// =========================================
// GLOBAL CONFIGURATION
// =========================================
const CONFIG = {
    // Toggle this from 'true' to false when you want to connect to a real backend
    USE_MOCK_DATA: false, 

    // --- ENVIRONMENT SETTINGS ---
    // Change this to 'live' when you want to test the deployed backend
    // Change back to 'local' when developing on your phone/laptop
    ENVIRONMENT: 'live', 

    // Paste deployed Render/Railway link  on live
    API_URLS: {
        LOCAL: 'http://localhost:8000',
        LIVE: 'https://your-live-backend-link.onrender.com'
    },

    // This is automatically calculated based on the ENVIRONMENT above
    get API_BASE_URL() {
        return this.API_URLS[this.ENVIRONMENT.toUpperCase()];
    },
    
    // Validation Rules (Matches backend constraints)
    MAX_FILE_SIZE_MB: 10,
    MAX_DOCUMENTS: 5,
    ALLOWED_EXTENSIONS: ['pdf', 'docx', 'txt'],
    
    // Endpoints
    ENDPOINTS: {
        HEALTH: '/health',
        DOCUMENTS: '/documents',
        QUERY: '/query'
    }
};