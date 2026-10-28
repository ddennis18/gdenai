// =========================================
// STATE MANAGEMENT
// =========================================
const State = {
    // Cryptographically secure session ID
    sessionId: null,
    documents: [],

    init() {
        // Get or generate Session ID (Updated to GDenAI)
        let sid = localStorage.getItem('gdenai_session_id');
        if (!sid) {
            sid = crypto.randomUUID();
            localStorage.setItem('gdenai_session_id', sid);
        }
        this.sessionId = sid;

        // Load documents from local storage (Updated to GDenAI)
        const savedDocs = localStorage.getItem('gdenai_docs');
        if (savedDocs) {
            this.documents = JSON.parse(savedDocs);
        }
    },

    addDocument(doc) {
        this.documents.push(doc);
        this._save();
    },

    removeDocument(docId) {
        this.documents = this.documents.filter(d => d.id !== docId);
        this._save();
    },

    clearAll() {
        this.documents = [];
        this._save();
    },

    _save() {
        localStorage.setItem('gdenai_docs', JSON.stringify(this.documents));
    }
};

// Initialize state immediately
State.init();