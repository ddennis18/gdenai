// =========================================
// API WRAPPER
// =========================================
const API = {
    getHeaders(isFormData = false) {
        const headers = { 'X-Session-Id': State.sessionId };
        if (!isFormData) headers['Content-Type'] = 'application/json';
        return headers;
    },

    async checkHealth() {
        if (CONFIG.USE_MOCK_DATA) return { status: "ok" };
        try {
            const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.HEALTH}`);
            return res.ok ? await res.json() : null;
        } catch (e) { return null; }
    },

    async uploadDocument(file) {
        if (CONFIG.USE_MOCK_DATA) {
            await new Promise(r => setTimeout(r, 1000)); // Fake delay
            return { id: "mock-" + Date.now(), filename: file.name, pages: 10, chunks: 45 };
        }

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.DOCUMENTS}`, {
            method: 'POST',
            headers: this.getHeaders(true),
            body: formData
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Upload failed");
        return data;
    },

    async deleteDocument(id) {
        if (CONFIG.USE_MOCK_DATA) return true;

        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.DOCUMENTS}/${id}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        if (!res.ok) throw new Error("Delete failed");
        return true;
    },

    async query(question) {
        if (CONFIG.USE_MOCK_DATA) {
            await new Promise(r => setTimeout(r, 2000)); // Fake delay
            return {
                answer: "Based on your uploaded materials, **mitochondria** are the powerhouse of the cell.\n\n- They generate ATP.\n- They are found in the cytoplasm.",
                sources: [{ filename: State.documents[0]?.filename || "Biology_Notes.pdf", page: 4 }]
            };
        }

        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.QUERY}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ question: question, top_k: 4 })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Query failed");
        return data;
    }
};