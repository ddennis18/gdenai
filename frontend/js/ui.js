// =========================================
// DOM MANIPULATION & XSS PROTECTION
// =========================================
const UI = {
    // 1. Sanitize & Render Markdown (Security Fix)
    formatAIResponse(text) {
        // Escape HTML first to prevent XSS (script injection)
        let safeText = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // Basic Markdown parsing
        safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
        safeText = safeText.replace(/\*(.*?)\*/g, '<em>$1</em>'); // Italics
        safeText = safeText.replace(/\n/g, '<br>'); // Line breaks
        safeText = safeText.replace(/- (.*?)(?:\n|$)/g, '<li>$1</li>'); // Bullet points
        if (safeText.includes('<li>')) {
            safeText = safeText.replace(/(<li>.*?<\/li>)/g, '<ul>$1</ul>');
        }
        
        return safeText;
    },

    // 2. Render Document Lists (Both Chat Sidebar & Documents Page)
    renderDocuments() {
        const docs = State.documents;
        
        // Render on Documents Page
        const grid = document.getElementById('documents-grid');
        if (grid) {
            if (docs.length === 0) {
                grid.innerHTML = '<p style="color: var(--text-muted); font-style: italic;">No study materials uploaded yet.</p>';
                return;
            }
            grid.innerHTML = docs.map(doc => `
                <div class="doc-card">
                    <div class="doc-card-info">
                        <h4 title="${doc.filename}">${doc.filename}</h4>
                        <p>Context Material</p>
                    </div>
                    <button class="btn-icon" onclick="App.handleDelete('${doc.id}')" aria-label="Delete document">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `).join('');
        }

        // Render on Chat Sidebar
        const sidebar = document.getElementById('sidebar-doc-list');
        if (sidebar) {
            if (docs.length === 0) {
                sidebar.innerHTML = '<p style="font-size: var(--text-small); color: var(--text-muted);">No context loaded.</p>';
                return;
            }
            sidebar.innerHTML = docs.map(doc => `
                <div class="doc-item">
                    <span class="doc-name" title="${doc.filename}">${doc.filename}</span>
                </div>
            `).join('');
        }
    },

    // 3. Chat Bubbles
    addMessage(role, htmlContent, id = null) {
        const history = document.getElementById('chat-history');
        const group = document.createElement('div');
        group.className = `message-group ${role}-group`;
        if (id) group.id = id;
        
        group.innerHTML = `<div class="message-bubble ${role}-bubble">${htmlContent}</div>`;
        history.appendChild(group);
        history.scrollTop = history.scrollHeight;
    },

    addAIMessage(text, sources) {
        let html = this.formatAIResponse(text);
        
        if (sources && sources.length > 0) {
            html += `<div class="sources-container"><strong>Sources:</strong>`;
            const unique = new Set();
            sources.forEach(s => {
                const label = `${s.filename} — Page ${s.page}`;
                if (!unique.has(label)) {
                    unique.add(label);
                    // Using an SVG instead of an emoji for Guideline #4
                    html += `<div class="source-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> ${label}</div>`;
                }
            });
            html += `</div>`;
        }
        this.addMessage('ai', html);
    },

    // 4. Toast Error Handling
    showError(message) {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
};