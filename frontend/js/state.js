// =========================================
// STATE MANAGEMENT
// =========================================
const State = {
    sessionId: null,
    documents: [],
    history: [], // Stores conversation for context

    init() {
        let sid = localStorage.getItem('gdenai_session_id');
        if (!sid) {
            sid = crypto.randomUUID();
            localStorage.setItem('gdenai_session_id', sid);
        }
        this.sessionId = sid;

        const savedDocs = localStorage.getItem('gdenai_docs');
        if (savedDocs) {
            this.documents = JSON.parse(savedDocs);
        }
    },

    // Sync local state with the actual backend server
    async syncWithBackend() {
        if (CONFIG.USE_MOCK_DATA) return;
        try {
            const serverDocs = await API.getDocuments();
            // If backend session expired, it returns [] and we clear local
            this.documents = serverDocs || [];
            this._save();
        } catch (e) {
            console.warn("Could not sync with backend", e);
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
        this.history = []; // Clear chat history too
        this._save();
    },

    addToHistory(role, content) {
        this.history.push({ role, content });
        // Keep only last 4 messages for backend context limit
        if (this.history.length > 4) this.history.shift();
    },

    _save() {
        localStorage.setItem('gdenai_docs', JSON.stringify(this.documents));
    }
};

State.init();