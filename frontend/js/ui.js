// =========================================
// DOM MANIPULATION & XSS PROTECTION
// =========================================
const UI = {
    formatAIResponse(text) {
        // Escape HTML
        let safeText = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        // Basic Markdown
        safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        safeText = safeText.replace(/\*(.*?)\*/g, '<em>$1</em>');
        safeText = safeText.replace(/\n/g, '<br>');
        safeText = safeText.replace(/- (.*?)(?:\n|$)/g, '<li>$1</li>');
        if (safeText.includes('<li>')) {
            safeText = safeText.replace(/(<li>.*?<\/li>)/g, '<ul>$1</ul>');
        }
        return safeText;
    },

    renderDocuments() {
        const docs = State.documents;
        
        // Documents Page
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
                        <p>${doc.pages} Pages &bull; ${doc.chunks} Chunks</p>
                    </div>
                    <div style="display:flex; gap: var(--space-2);">
                        <button class="btn btn-outline" style="padding: var(--space-1) var(--space-2); font-size: var(--text-small);" onclick="App.handleQuiz('${doc.id}', '${doc.filename}')">Quiz</button>
                        <button class="btn-icon" onclick="App.handleDelete('${doc.id}')" aria-label="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
            `).join('');
        }

        // Chat Sidebar
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

    addMessage(role, htmlContent, id = null) {
        const history = document.getElementById('chat-history');
        const group = document.createElement('div');
        group.className = `message-group ${role}-group`;
        if (id) group.id = id;
        
        group.innerHTML = `<div class="message-bubble ${role}-bubble">${htmlContent}</div>`;
        history.appendChild(group);
        history.scrollTop = history.scrollHeight;
    },

    // Used during streaming to append text to the current bubble
    appendToStream(id, text) {
        const group = document.getElementById(id);
        if (!group) return;
        const bubble = group.querySelector('.message-bubble');
        
        // We store raw text in a data attribute to format it properly on each append
        let rawText = bubble.getAttribute('data-raw') || '';
        rawText += text;
        bubble.setAttribute('data-raw', rawText);
        bubble.innerHTML = this.formatAIResponse(rawText);
        
        const history = document.getElementById('chat-history');
        history.scrollTop = history.scrollHeight;
    },

    addSourcesToStream(id, sources) {
        const group = document.getElementById(id);
        if (!group || !sources || sources.length === 0) return;
        const bubble = group.querySelector('.message-bubble');
        
        let html = bubble.innerHTML;
        html += `<div class="sources-container"><strong>Sources:</strong>`;
        const unique = new Set();
        sources.forEach(s => {
            const label = `${s.filename} — Page ${s.page}`;
            if (!unique.has(label)) {
                unique.add(label);
                html += `<div class="source-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg> ${label}</div>`;
            }
        });
        html += `</div>`;
        bubble.innerHTML = html;
        document.getElementById('chat-history').scrollTop = document.getElementById('chat-history').scrollHeight;
    },

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
    },

    // Quiz Modal Logic
    renderQuizModal(questions, filename) {
        let modal = document.getElementById('quiz-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'quiz-modal';
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;justify-content:center;align-items:center;z-index:1000;padding:var(--space-4);';
            document.body.appendChild(modal);
        }

        let html = `<div style="background:var(--color-bg-surface); padding:var(--space-5); max-width:600px; width:100%; max-height:90vh; overflow-y:auto; border-top: 4px solid var(--color-brand);">
            <h2 style="font-family:var(--font-heading); color:var(--color-brand); margin-bottom:var(--space-2);">Quiz: ${filename}</h2>
            <p style="font-size:var(--text-small); color:var(--text-muted); margin-bottom:var(--space-4);">Test your knowledge based on the uploaded document.</p>
            <form id="quiz-form">`;

        questions.forEach((q, index) => {
            html += `<div style="margin-bottom:var(--space-4);">
                <p style="font-weight:600; margin-bottom:var(--space-2);">${index + 1}. ${q.question}</p>
                <div style="display:flex; flex-direction:column; gap:var(--space-2);">`;
            q.options.forEach(opt => {
                html += `<label style="display:flex; align-items:center; gap:var(--space-2); font-size:var(--text-small); cursor:pointer;">
                    <input type="radio" name="q${index}" value="${opt}" required> ${opt}
                </label>`;
            });
            html += `</div></div>`;
        });

        html += `</form>
            <div style="display:flex; justify-content:flex-end; gap:var(--space-3); margin-top:var(--space-4);">
                <button class="btn btn-outline" onclick="document.getElementById('quiz-modal').remove()">Close</button>
                <button class="btn btn-primary" onclick="App.submitQuiz(${JSON.stringify(questions).replace(/"/g, '&quot;')})">Submit Answers</button>
            </div>
        </div>`;

        modal.innerHTML = html;
    },

    showQuizResults(questions) {
        const form = document.getElementById('quiz-form');
        const formData = new FormData(form);
        let score = 0;

        let resultsHtml = `<h3 style="color:var(--color-brand); margin-bottom:var(--space-3);">Results</h3>`;

        questions.forEach((q, index) => {
            const selected = formData.get(`q${index}`);
            const isCorrect = selected === q.answer;
            if (isCorrect) score++;

            resultsHtml += `<div style="margin-bottom:var(--space-3); padding:var(--space-2); border-left: 3px solid ${isCorrect ? 'var(--color-ai)' : 'var(--color-error)'}; background: rgba(0,0,0,0.02);">
                <p style="font-weight:600;">${index + 1}. ${q.question}</p>
                <p style="font-size:var(--text-small); color: ${isCorrect ? 'var(--color-ai)' : 'var(--color-error)'};">
                    Your answer: ${selected || 'None'} ${isCorrect ? '(Correct)' : `(Incorrect - Answer: ${q.answer})`}
                </p>
                <p style="font-size:var(--text-small); color:var(--text-muted); margin-top:var(--space-1); font-style:italic;">${q.explanation}</p>
            </div>`;
        });

        resultsHtml += `<p style="font-weight:600; font-size:var(--text-h3); text-align:center; margin-top:var(--space-4);">Score: ${score} / ${questions.length}</p>`;
        resultsHtml += `<div style="display:flex; justify-content:center; margin-top:var(--space-4);"><button class="btn btn-primary" onclick="document.getElementById('quiz-modal').remove()">Done</button></div>`;

        document.querySelector('#quiz-modal > div').innerHTML = resultsHtml;
    }
};