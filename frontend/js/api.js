// =========================================
// API WRAPPER
// =========================================
const API = {
    getHeaders(isFormData = false) {
        const headers = { 'X-Session-Id': State.sessionId };
        if (!isFormData) headers['Content-Type'] = 'application/json';
        return headers;
    },

    async getDocuments() {
        if (CONFIG.USE_MOCK_DATA) return State.documents;
        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.DOCUMENTS}`, {
            headers: this.getHeaders()
        });
        if (res.status === 404) return []; // Session expired on backend
        if (!res.ok) throw new Error("Failed to fetch documents");
        return await res.json();
    },

    async uploadDocument(file) {
        if (CONFIG.USE_MOCK_DATA) {
            await new Promise(r => setTimeout(r, 1000));
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

    async clearSession() {
        if (CONFIG.USE_MOCK_DATA) return true;
        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.SESSION}`, {
            method: 'DELETE',
            headers: this.getHeaders()
        });
        return res.ok;
    },

    // Streams the chat response using Server-Sent Events (SSE)
    async chatStream(question, onToken, onSources, onDone, onError) {
        if (CONFIG.USE_MOCK_DATA) {
            // Simulate stream for Mock Data
            const mockText = "Based on your uploaded materials, **mitochondria** are the powerhouse of the cell.\n\n- They generate ATP.\n- They are found in the cytoplasm.";
            const words = mockText.split(" ");
            for (let word of words) {
                onToken(word + " ");
                await new Promise(r => setTimeout(r, 50));
            }
            onSources([{ filename: State.documents[0]?.filename || "Biology_Notes.pdf", page: 4 }]);
            onDone();
            return;
        }

        try {
            const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.CHAT}`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ 
                    question: question,
                    document_ids: State.documents.map(d => d.id), // Optional: filter by specific docs
                    history: State.history
                })
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.message || "Chat failed");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.replace('data: ', '').trim();
                        if (!dataStr) continue;
                        
                        const data = JSON.parse(dataStr);
                        if (data.type === 'token') onToken(data.text);
                        if (data.type === 'sources') onSources(data.sources);
                        if (data.type === 'done') onDone();
                    }
                }
            }
        } catch (err) {
            onError(err.message);
        }
    },

    async generateQuiz(documentId, numQuestions = 3) {
        if (CONFIG.USE_MOCK_DATA) {
            await new Promise(r => setTimeout(r, 1500));
            return [
                { question: "What is the main function of mitochondria?", options: ["Protein synthesis", "Energy production", "Waste removal", "Cell division"], answer: "Energy production", explanation: "Mitochondria generate most of the cell's supply of adenosine triphosphate (ATP).", source_page: 4 }
            ];
        }
        const res = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.QUIZ}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({ document_id: documentId, num_questions: numQuestions })
        });
        if (!res.ok) throw new Error("Failed to generate quiz");
        return await res.json();
    }
};