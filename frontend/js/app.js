// =========================================
// MAIN APPLICATION LOGIC
// =========================================
const App = {
    init() {
        const path = window.location.pathname;
        
        // Page Router
        if (path.includes('documents.html')) {
            this.initDocumentsPage();
        } else if (path.includes('chat.html')) {
            this.initChatPage();
        }

        UI.renderDocuments();
    },

    // --- DOCUMENTS PAGE LOGIC ---
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
            clearBtn.addEventListener('click', () => {
                if(confirm("Are you sure you want to delete all materials and start over?")) {
                    State.clearAll();
                    UI.renderDocuments();
                }
            });
        }
    },

    // --- CHAT PAGE LOGIC ---
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

        // Export Chat Event Listener
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportChat());
        }

        // Suggested Prompts Logic
        prompts.forEach(btn => {
            btn.addEventListener('click', () => {
                chatInput.value = btn.textContent;
                this.handleQuery();
            });
        });
    },

    // --- SHARED ACTIONS ---
    async handleUpload(file) {
        // 1. Validate
        const validation = Validator.validateFile(file, State.documents.length);
        if (!validation.valid) {
            UI.showError(validation.message);
            return;
        }

        // 2. Upload
        try {
            UI.showError("Processing document..."); 
            const newDoc = await API.uploadDocument(file);
            State.addDocument(newDoc);
            UI.renderDocuments();
            
            // Reset file inputs so the same file can be uploaded again if deleted
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
            UI.showError("Please upload at least one document before querying.");
            return;
        }

        // 1. Add User Message
        UI.addMessage('user', question);
        input.value = '';

        // 2. Add Typing Indicator
        const thinkingId = 'thinking-' + Date.now();
        UI.addMessage('ai', '<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>', thinkingId);

        // 3. Fetch AI Response
        try {
            const data = await API.query(question);
            document.getElementById(thinkingId)?.remove();
            UI.addAIMessage(data.answer, data.sources);
        } catch (error) {
            document.getElementById(thinkingId)?.remove();
            UI.addMessage('ai', `Error: ${error.message}`);
        }
    },

    // --- EXPORT CHAT TO TXT ---
    exportChat() {
        const history = document.getElementById('chat-history');
        const messages = history.querySelectorAll('.message-group');
        
        // Check if there's actual conversation (ignoring the initial AI greeting)
        if (messages.length <= 1) {
            UI.showError("No conversation to export yet.");
            return;
        }

        let textContent = "=========================================\n";
        textContent += "          GDENAI STUDY SESSION           \n";
        textContent += `Date: ${new Date().toLocaleString()}\n`;
        textContent += "=========================================\n\n";

        messages.forEach(msg => {
            const isUser = msg.classList.contains('user-group');
            const bubble = msg.querySelector('.message-bubble');
            
            // Skip typing indicators
            if (!bubble || bubble.querySelector('.typing-indicator')) return; 

            if (isUser) {
                textContent += `[STUDENT]:\n${bubble.innerText.trim()}\n\n`;
            } else {
                // Clone the bubble so we can safely manipulate the text without affecting the UI
                const clone = bubble.cloneNode(true);
                const sourcesContainer = clone.querySelector('.sources-container');
                
                let answerText = clone.innerText.trim();
                
                // If there are sources, format them cleanly at the bottom
                if (sourcesContainer) {
                    const sourceTexts = Array.from(sourcesContainer.querySelectorAll('.source-item')).map(s => s.innerText.trim());
                    
                    // Remove the raw HTML sources block from the main answer text
                    answerText = answerText.replace(sourcesContainer.innerText, '').trim();
                    
                    textContent += `[GDENAI]:\n${answerText}\n\n`;
                    textContent += `Sources Cited:\n- ${sourceTexts.join('\n- ')}\n\n`;
                } else {
                    textContent += `[GDENAI]:\n${answerText}\n\n`;
                }
            }
        });

        textContent += "=========================================\n";
        textContent += "Exported from GDenAI - Open Source Study Context Engine\n";

        // Create a Blob and trigger download
        const blob = new Blob([textContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        // Format date for filename (YYYY-MM-DD)
        const dateString = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `GDenAI_Notes_${dateString}.txt`;
        
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        UI.showError("Chat exported successfully!"); // Reusing toast for success message
    }
};

// Start App when DOM is ready
document.addEventListener('DOMContentLoaded', () => App.init());