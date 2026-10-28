// =========================================
// MAIN APPLICATION LOGIC
// =========================================
const App = {
    async init() {
        const path = window.location.pathname;
        
        // Fetch real documents from backend on page load
        await State.syncWithBackend();

        if (path.includes('documents.html')) {
            this.initDocumentsPage();
        } else if (path.includes('chat.html')) {
            this.initChatPage();
        }

        UI.renderDocuments();
    },

    initDocumentsPage() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const browseBtn = document.getElementById('browse-btn');
        const clearBtn = document.getElementById('clear-btn');

        browseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleUpload(e.target.files[0]);
        });

        dropZone.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            dropZone.style.borderColor = 'var(--color-brand)'; 
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'var(--color-accent-soft)';
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--color-accent-soft)';
            if (e.dataTransfer.files.length > 0) this.handleUpload(e.dataTransfer.files[0]);
        });

        if (clearBtn) {
            clearBtn.addEventListener('click', async () => {
                if(confirm("Are you sure you want to delete all materials and start over?")) {
                    await API.clearSession();
                    State.clearAll();
                    UI.renderDocuments();
                }
            });
        }
    },

    initChatPage() {
        const quickUploadBtn = document.getElementById('quick-upload-btn');
        const quickFileInput = document.getElementById('quick-file-input');
        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-btn');
        const prompts = document.querySelectorAll('.prompt-chip');
        const exportBtn = document.getElementById('export-chat-btn');

        quickUploadBtn.addEventListener('click', () => quickFileInput.click());
        quickFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this.handleUpload(e.target.files[0]);
        });

        sendBtn.addEventListener('click', () => this.handleQuery());
        chatInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') this.handleQuery(); 
        });

        if (exportBtn) exportBtn.addEventListener('click', () => this.exportChat());

        prompts.forEach(btn => {
            btn.addEventListener('click', () => {
                chatInput.value = btn.textContent;
                this.handleQuery();
            });
        });
    },

    async handleUpload(file) {
        const validation = Validator.validateFile(file, State.documents.length);
        if (!validation.valid) return UI.showError(validation.message);

        try {
            UI.showError("Processing document..."); 
            const newDoc = await API.uploadDocument(file);
            State.addDocument(newDoc);
            UI.renderDocuments();
            
            const fileInputs = document.querySelectorAll('input[type="file"]');
            fileInputs.forEach(input => input.value = '');
        } catch (error) {
            UI.showError(error.message);
        }
    },

    async handleDelete(id) {
        if (!confirm("Remove this material from your context?")) return;
        try {
            await API.deleteDocument(id);
            State.removeDocument(id);
            UI.renderDocuments();
        } catch (error) {
            UI.showError(error.message);
        }
    },

    async handleQuery() {
        const input = document.getElementById('chat-input');
        const question = input.value.trim();
        if (!question) return;

        if (State.documents.length === 0) {
            return UI.showError("Please upload at least one document before querying.");
        }

        // 1. Add User Message
        UI.addMessage('user', question);
        State.addToHistory('user', question); // Save to context
        input.value = '';

        // 2. Create empty AI Bubble for streaming
        const aiMsgId = 'ai-msg-' + Date.now();
        UI.addMessage('ai', '', aiMsgId); // Start empty

        // 3. Start Streaming
        let fullAnswer = '';
        await API.chatStream(
            question,
            (token) => {
                // On Token (Typewriter effect)
                fullAnswer += token;
                UI.appendToStream(aiMsgId, token);
            },
            (sources) => {
                // On Sources received
                UI.addSourcesToStream(aiMsgId, sources);
            },
            () => {
                // On Done
                State.addToHistory('assistant', fullAnswer);
            },
            (error) => {
                // On Error
                document.getElementById(aiMsgId)?.remove();
                UI.addMessage('ai', `Error: ${error}`);
            }
        );
    },

    async handleQuiz(docId, filename) {
        try {
            UI.showError("Generating quiz from document...");
            const questions = await API.generateQuiz(docId, 3); // Generate 3 questions
            UI.renderQuizModal(questions, filename);
        } catch (error) {
            UI.showError(error.message);
        }
    },

    submitQuiz(questions) {
        UI.showQuizResults(questions);
    },

    exportChat() {
        const history = document.getElementById('chat-history');
        const messages = history.querySelectorAll('.message-group');
        
        if (messages.length <= 1) return UI.showError("No conversation to export yet.");

        let textContent = "=========================================\n";
        textContent += "          GDENAI STUDY SESSION           \n";
        textContent += `Date: ${new Date().toLocaleString()}\n`;
        textContent += "=========================================\n\n";

        messages.forEach(msg => {
            const isUser = msg.classList.contains('user-group');
            const bubble = msg.querySelector('.message-bubble');
            if (!bubble) return;

            if (isUser) {
                textContent += `[STUDENT]:\n${bubble.innerText.trim()}\n\n`;
            } else {
                const clone = bubble.cloneNode(true);
                const sourcesContainer = clone.querySelector('.sources-container');
                let answerText = clone.innerText.trim();
                
                if (sourcesContainer) {
                    const sourceTexts = Array.from(sourcesContainer.querySelectorAll('.source-item')).map(s => s.innerText.trim());
                    answerText = answerText.replace(sourcesContainer.innerText, '').trim();
                    textContent += `[GDENAI]:\n${answerText}\n\nSources:\n- ${sourceTexts.join('\n- ')}\n\n`;
                } else {
                    textContent += `[GDENAI]:\n${answerText}\n\n`;
                }
            }
        });

        const blob = new Blob([textContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GDenAI_Notes_${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.showError("Chat exported successfully!"); 
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());