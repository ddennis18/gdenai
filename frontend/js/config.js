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
    API_URLS: {
        LOCAL: 'http://localhost:8000',
        LIVE: 'https://your-live-backend-link.onrender.com' 
    },
    get API_BASE_URL() {
        return this.API_URLS[this.ENVIRONMENT.toUpperCase()];
    },
    MAX_FILE_SIZE_MB: 10,
    MAX_DOCUMENTS: 5,
    ALLOWED_EXTENSIONS: ['pdf', 'docx', 'txt'],
    
    // Updated Endpoints
    ENDPOINTS: {
        HEALTH: '/health',
        DOCUMENTS: '/documents',
        CHAT: '/chat',        // Replaces /query for streaming
        SESSION: '/session',  // For clearing all docs
        QUIZ: '/quiz'         // For generating quizzes
    }
};