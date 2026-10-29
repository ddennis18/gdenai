// =========================================
// DOM MANIPULATION & XSS PROTECTION
// =========================================
const UI = {
    _quiz: null,
    _escBound: false,

    // ---------- helpers ----------
    escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    _scrollChat() {
        const history = document.getElementById('chat-history');
        if (history) history.scrollTop = history.scrollHeight;
    },

    // Inline markdown: `code`, **bold**, *italic* (input is escaped first)
    _inline(text) {
        return text.split(/(`[^`]+`)/).map(part => {
            if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
                return `<code>${this.escapeHtml(part.slice(1, -1))}</code>`;
            }
            return this.escapeHtml(part)
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>');
        }).join('');
    },

    // Block markdown: headings, bullet + numbered lists, code fences, paragraphs.
    // Safe to call on partial text while streaming.
    formatAIResponse(text) {
        const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let list = null, para = [], code = null;

        const flushPara = () => {
            if (para.length) { out.push(`<p>${para.map(l => this._inline(l)).join('<br>')}</p>`); para = []; }
        };
        const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
        const openList = (tag) => { if (list !== tag) { flushList(); out.push(`<${tag}>`); list = tag; } };

        for (const line of lines) {
            if (/^\s*```/.test(line)) {
                if (code === null) { flushPara(); flushList(); code = []; }
                else { out.push(`<pre><code>${this.escapeHtml(code.join('\n'))}</code></pre>`); code = null; }
                continue;
            }
            if (code !== null) { code.push(line); continue; }

            let m;
            if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
                flushPara(); flushList();
                const level = m[1].length + 2; // # -> h3
                out.push(`<h${level}>${this._inline(m[2])}</h${level}>`);
            } else if ((m = line.match(/^\s*[-*\u2022]\s+(.*)$/))) {
                flushPara(); openList('ul');
                out.push(`<li>${this._inline(m[1])}</li>`);
            } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
                flushPara(); openList('ol');
                out.push(`<li>${this._inline(m[1])}</li>`);
            } else if (!line.trim()) {
                flushPara(); flushList();
            } else {
                flushList(); para.push(line);
            }
        }
        if (code !== null) out.push(`<pre><code>${this.escapeHtml(code.join('\n'))}</code></pre>`);
        flushPara(); flushList();
        return out.join('');
    },

    _fileExt(name) {
        const ext = String(name || '').split('.').pop().toLowerCase();
        return ['pdf', 'docx', 'txt'].includes(ext) ? ext : 'file';
    },

    // ---------- documents ----------
    renderDocuments() {
        const docs = State.documents;

        // Live counts (sidebar pill, mobile toggle button, etc.)
        document.querySelectorAll('[data-doc-count]').forEach(el => { el.textContent = docs.length; });

        // Documents page
        const grid = document.getElementById('documents-grid');
        if (grid) {
            if (docs.length === 0) {
                grid.innerHTML = `<div class="empty-state"><strong>No study materials yet</strong>Upload a PDF, DOCX or TXT file above and it will show up here, ready to query.</div>`;
            } else {
                grid.innerHTML = docs.map(doc => {
                    const name = this.escapeHtml(doc.filename);
                    const ext = this._fileExt(doc.filename);
                    const pages = Number(doc.pages) || 0, chunks = Number(doc.chunks) || 0;
                    return `
                    <div class="doc-card">
                        <div class="doc-badge" data-ext="${ext}" aria-hidden="true">${ext === 'file' ? 'DOC' : ext.toUpperCase()}</div>
                        <div class="doc-card-info">
                            <h4 title="${name}">${name}</h4>
                            <p>${pages} ${pages === 1 ? 'page' : 'pages'} &bull; ${chunks} ${chunks === 1 ? 'chunk' : 'chunks'}</p>
                        </div>
                        <div class="doc-card-actions">
                            <button class="btn btn-outline btn-sm" type="button" data-action="quiz" data-id="${this.escapeHtml(doc.id)}" data-name="${name}">Quiz me</button>
                            <button class="btn-icon" type="button" data-action="delete" data-id="${this.escapeHtml(doc.id)}" aria-label="Delete ${name}">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>`;
                }).join('');
            }
            // One delegated handler (assignment is idempotent across re-renders)
            grid.onclick = (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const { action, id, name } = btn.dataset;
                if (action === 'quiz') App.handleQuiz(id, name);
                if (action === 'delete') App.handleDelete(id);
            };
        }

        // Chat sidebar
        const sidebar = document.getElementById('sidebar-doc-list');
        if (sidebar) {
            if (docs.length === 0) {
                sidebar.innerHTML = `<div class="empty-state"><strong>No context loaded</strong>Add a document and the AI will answer from it, with page citations.</div>`;
            } else {
                sidebar.innerHTML = docs.map(doc => {
                    const name = this.escapeHtml(doc.filename);
                    return `
                    <div class="doc-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        <span class="doc-name" title="${name}">${name}</span>
                    </div>`;
                }).join('');
            }
        }
    },

    // ---------- chat ----------
    addMessage(role, htmlContent, id = null) {
        const history = document.getElementById('chat-history');
        if (!history) return;
        const group = document.createElement('div');
        group.className = `message-group ${role}-group`;
        if (id) group.id = id;
        group.innerHTML = `<div class="message-bubble ${role}-bubble">${htmlContent}</div>`;
        history.appendChild(group);
        history.scrollTop = history.scrollHeight;
    },

    // Streaming: store raw text, re-render formatted on each chunk
    appendToStream(id, text) {
        const group = document.getElementById(id);
        if (!group) return;
        const bubble = group.querySelector('.message-bubble');

        const rawText = (bubble.getAttribute('data-raw') || '') + text;
        bubble.setAttribute('data-raw', rawText);
        bubble.innerHTML = this.formatAIResponse(rawText);

        // Copy button, added once per answer (lives outside the bubble so re-renders don't wipe it)
        if (!group.querySelector('.msg-actions')) {
            const actions = document.createElement('div');
            actions.className = 'msg-actions';
            actions.innerHTML = `<button class="copy-btn" type="button" aria-label="Copy answer" title="Copy answer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
            actions.querySelector('button').addEventListener('click', () => {
                this.copyText(bubble.getAttribute('data-raw') || bubble.innerText);
            });
            group.appendChild(actions);
        }
        this._scrollChat();
    },

    addSourcesToStream(id, sources) {
        const group = document.getElementById(id);
        if (!group || !sources || sources.length === 0) return;
        const bubble = group.querySelector('.message-bubble');

        const unique = new Set();
        let chips = '';
        sources.forEach(s => {
            const label = `${s.filename} \u2014 Page ${s.page}`;
            if (unique.has(label)) return;
            unique.add(label);
            chips += `<span class="source-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>${this.escapeHtml(label)}</span>`;
        });
        bubble.insertAdjacentHTML('beforeend', `<div class="sources-container"><strong>Sources</strong>${chips}</div>`);
        this._scrollChat();
    },

    async copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('Answer copied', 'success');
        } catch (e) {
            this.showError('Could not copy. Select the text and copy it manually.');
        }
    },

    // ---------- toast ----------
    showToast(message, type = 'error') {
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.className = `toast ${type === 'success' ? 'success' : ''}`;
        toast.textContent = message;
        // force reflow so the transition replays on rapid calls
        void toast.offsetWidth;
        toast.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
    },

    showError(message) { this.showToast(message, 'error'); },

    // ---------- quiz ----------
    closeQuiz() {
        const modal = document.getElementById('quiz-modal');
        if (modal) modal.remove();
        document.body.classList.remove('modal-open');
    },

    renderQuizModal(questions, filename) {
        this._quiz = { questions, filename };

        let modal = document.getElementById('quiz-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'quiz-modal';
            modal.className = 'modal-backdrop';
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => { if (e.target === modal) this.closeQuiz(); });
        }
        if (!this._escBound) {
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeQuiz(); });
            this._escBound = true;
        }
        document.body.classList.add('modal-open');

        const total = questions.length;
        const body = questions.map((q, index) => `
            <fieldset class="quiz-q">
                <legend>${index + 1}. ${this.escapeHtml(q.question)}</legend>
                <div class="quiz-options">
                    ${q.options.map(opt => `
                    <label class="quiz-option">
                        <input type="radio" name="q${index}" value="${this.escapeHtml(opt)}" required>
                        <span>${this.escapeHtml(opt)}</span>
                    </label>`).join('')}
                </div>
            </fieldset>`).join('');

        modal.innerHTML = `
        <div class="quiz-dialog" role="dialog" aria-modal="true" aria-labelledby="quiz-title">
            <div class="quiz-head">
                <h2 id="quiz-title">Quiz: ${this.escapeHtml(filename)}</h2>
                <p>Questions are generated from this document.</p>
                <div class="quiz-progress"><div class="quiz-progress-bar" id="quiz-progress-bar"></div></div>
                <span class="quiz-progress-text" id="quiz-progress-text">0 of ${total} answered</span>
            </div>
            <form id="quiz-form" class="quiz-body">${body}</form>
            <div class="quiz-actions">
                <button class="btn btn-outline" type="button" id="quiz-close">Close</button>
                <button class="btn btn-primary" type="button" id="quiz-submit">Submit answers</button>
            </div>
        </div>`;

        const form = modal.querySelector('#quiz-form');
        form.addEventListener('change', () => {
            const answered = new Set([...new FormData(form).keys()]).size;
            modal.querySelector('#quiz-progress-bar').style.width = `${(answered / total) * 100}%`;
            modal.querySelector('#quiz-progress-text').textContent = `${answered} of ${total} answered`;
        });
        modal.querySelector('#quiz-close').addEventListener('click', () => this.closeQuiz());
        modal.querySelector('#quiz-submit').addEventListener('click', () => {
            if (!form.checkValidity()) { form.reportValidity(); return; }
            App.submitQuiz(questions);
        });
        modal.querySelector('input')?.focus();
    },

    showQuizResults(questions) {
        const form = document.getElementById('quiz-form');
        const dialog = document.querySelector('#quiz-modal .quiz-dialog');
        if (!form || !dialog) return;

        const formData = new FormData(form);
        let score = 0;

        const items = questions.map((q, index) => {
            const selected = formData.get(`q${index}`);
            const isCorrect = selected === q.answer;
            if (isCorrect) score++;
            return `
            <div class="result-item ${isCorrect ? 'correct' : 'incorrect'}">
                <p class="q">${index + 1}. ${this.escapeHtml(q.question)}</p>
                <p class="a">${isCorrect
                    ? `Correct: ${this.escapeHtml(selected)}`
                    : `You answered: ${this.escapeHtml(selected || 'No answer')}. Correct answer: ${this.escapeHtml(q.answer)}`}</p>
                ${q.explanation ? `<p class="why">${this.escapeHtml(q.explanation)}</p>` : ''}
            </div>`;
        }).join('');

        const pct = Math.round((score / questions.length) * 100);
        const msg = pct >= 80 ? 'Strong grasp of this material.'
            : pct >= 50 ? 'Getting there. Review the ones you missed.'
            : 'Worth another pass through the document.';

        dialog.innerHTML = `
            <div class="quiz-head">
                <h2>Results</h2>
                <p>${this.escapeHtml(this._quiz?.filename || '')}</p>
            </div>
            <div class="quiz-body">
                <div class="score-wrap">
                    <div class="score-ring" style="--pct:${pct}"><span>${score}/${questions.length}</span></div>
                    <p class="score-msg">${msg}</p>
                </div>
                ${items}
            </div>
            <div class="quiz-actions">
                <button class="btn btn-outline" type="button" id="quiz-retake">Retake quiz</button>
                <button class="btn btn-primary" type="button" id="quiz-done">Done</button>
            </div>`;

        dialog.querySelector('#quiz-done').addEventListener('click', () => this.closeQuiz());
        dialog.querySelector('#quiz-retake').addEventListener('click', () => {
            if (this._quiz) this.renderQuizModal(this._quiz.questions, this._quiz.filename);
        });
    }
};
