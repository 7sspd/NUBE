/**
 * NUBE Offline - Almacenamiento de archivos local con IndexedDB
 *
 * Los archivos se guardan como Blob (binario crudo) directamente en IndexedDB,
 * lo que garantiza:
 *  - Soporte para CUALQUIER tipo de archivo (imágenes, video, audio, PDF, ZIP, exe, etc.)
 *  - Cero pérdida: el contenido se guarda byte por byte sin reconvertirlo a texto/base64.
 *  - Capacidad mucho mayor que localStorage (cientos de MB a varios GB según el navegador).
 */

(() => {
    'use strict';

    // ===== Configuración de IndexedDB =====
    const DB_NAME = 'nube_offline';
    const DB_VERSION = 1;
    const STORE_NAME = 'files';

    /** Abre (o crea) la base de datos IndexedDB. */
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /** Helper genérico para envolver un IDBRequest en una Promise. */
    function reqToPromise(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ===== Operaciones CRUD =====

    async function addFile(file) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const record = {
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            blob: file, // Guardamos el File/Blob tal cual: cero pérdida.
            createdAt: Date.now(),
        };
        const id = await reqToPromise(tx.objectStore(STORE_NAME).add(record));
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return id;
    }

    async function getAllFiles() {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        return reqToPromise(tx.objectStore(STORE_NAME).getAll());
    }

    async function getFile(id) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        return reqToPromise(tx.objectStore(STORE_NAME).get(id));
    }

    async function deleteFile(id) {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_NAME).delete(id));
    }

    async function clearAllFiles() {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_NAME).clear());
    }

    // ===== Utilidades =====

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const value = bytes / Math.pow(1024, i);
        return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    }

    function formatDate(ts) {
        const d = new Date(ts);
        return d.toLocaleString();
    }

    function getFileIcon(type, name) {
        const ext = name.split('.').pop().toLowerCase();
        if (type.startsWith('image/')) return '🖼️';
        if (type.startsWith('video/')) return '🎬';
        if (type.startsWith('audio/')) return '🎵';
        if (type === 'application/pdf' || ext === 'pdf') return '📕';
        if (type.includes('zip') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
        if (type.includes('word') || ['doc', 'docx'].includes(ext)) return '📘';
        if (type.includes('excel') || type.includes('sheet') || ['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
        if (type.includes('powerpoint') || type.includes('presentation') || ['ppt', 'pptx'].includes(ext)) return '📙';
        if (type.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'log'].includes(ext)) return '📝';
        if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'php', 'rs', 'swift', 'kt', 'html', 'css'].includes(ext)) return '💻';
        if (['exe', 'msi', 'apk', 'dmg', 'deb', 'rpm'].includes(ext)) return '⚙️';
        return '📄';
    }

    function isPreviewableImage(type) {
        return type.startsWith('image/');
    }
    function isPreviewableVideo(type) {
        return type.startsWith('video/');
    }
    function isPreviewableAudio(type) {
        return type.startsWith('audio/');
    }
    function isPreviewablePDF(type) {
        return type === 'application/pdf';
    }
    function isPreviewableText(type, name) {
        if (type.startsWith('text/')) return true;
        const ext = name.split('.').pop().toLowerCase();
        return ['txt', 'md', 'json', 'xml', 'log', 'js', 'ts', 'jsx', 'tsx', 'py',
                'java', 'c', 'cpp', 'cs', 'go', 'rb', 'php', 'rs', 'swift', 'kt',
                'html', 'css', 'csv', 'yml', 'yaml', 'sh', 'bash'].includes(ext);
    }

    // ===== Estado de la UI =====

    const state = {
        files: [],
        viewMode: localStorage.getItem('nube_view') || 'grid',
        sortBy: 'date-desc',
        searchTerm: '',
    };

    // ===== Referencias DOM =====
    const $ = (id) => document.getElementById(id);
    const dom = {
        dropZone: $('dropZone'),
        fileInput: $('fileInput'),
        uploadProgress: $('uploadProgress'),
        progressBar: $('progressBar'),
        progressText: $('progressText'),
        searchInput: $('searchInput'),
        sortSelect: $('sortSelect'),
        gridViewBtn: $('gridViewBtn'),
        listViewBtn: $('listViewBtn'),
        exportAllBtn: $('exportAllBtn'),
        clearAllBtn: $('clearAllBtn'),
        filesContainer: $('filesContainer'),
        filesList: $('filesList'),
        emptyState: $('emptyState'),
        previewModal: $('previewModal'),
        previewTitle: $('previewTitle'),
        previewBody: $('previewBody'),
        previewDownloadBtn: $('previewDownloadBtn'),
        toastContainer: $('toastContainer'),
        storageFill: $('storageFill'),
        storageText: $('storageText'),
    };

    // ===== Toast notifications =====

    function toast(message, variant = 'info', duration = 3000) {
        const el = document.createElement('div');
        el.className = `toast ${variant}`;
        el.textContent = message;
        dom.toastContainer.appendChild(el);
        setTimeout(() => {
            el.classList.add('removing');
            el.addEventListener('animationend', () => el.remove(), { once: true });
        }, duration);
    }

    // ===== Almacenamiento (cuota) =====

    async function updateStorageInfo() {
        try {
            if (navigator.storage && navigator.storage.estimate) {
                const { usage = 0, quota = 0 } = await navigator.storage.estimate();
                const percent = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
                dom.storageFill.style.width = `${percent}%`;
                dom.storageText.textContent =
                    `${formatBytes(usage)} usados de ${formatBytes(quota)} disponibles`;
            } else {
                dom.storageText.textContent = 'Espacio: información no disponible';
            }
        } catch (err) {
            console.warn('No se pudo obtener la cuota de almacenamiento:', err);
        }
    }

    // ===== Render =====

    function getFilteredFiles() {
        let list = [...state.files];
        if (state.searchTerm) {
            const term = state.searchTerm.toLowerCase();
            list = list.filter((f) => f.name.toLowerCase().includes(term));
        }
        switch (state.sortBy) {
            case 'date-desc': list.sort((a, b) => b.createdAt - a.createdAt); break;
            case 'date-asc':  list.sort((a, b) => a.createdAt - b.createdAt); break;
            case 'name-asc':  list.sort((a, b) => a.name.localeCompare(b.name)); break;
            case 'name-desc': list.sort((a, b) => b.name.localeCompare(a.name)); break;
            case 'size-desc': list.sort((a, b) => b.size - a.size); break;
            case 'size-asc':  list.sort((a, b) => a.size - b.size); break;
        }
        return list;
    }

    function buildThumb(file) {
        const icon = getFileIcon(file.type, file.name);
        // Para imágenes, usamos object URL como miniatura.
        if (isPreviewableImage(file.type)) {
            const url = URL.createObjectURL(file.blob);
            return `<div class="file-thumb"><img src="${url}" alt="" loading="lazy"></div>`;
        }
        return `<div class="file-thumb">${icon}</div>`;
    }

    function renderFiles() {
        const files = getFilteredFiles();
        // Limpiamos object URLs creadas anteriormente para no fugar memoria.
        dom.filesList.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').forEach((el) => {
            URL.revokeObjectURL(el.src);
        });
        dom.filesList.innerHTML = '';

        if (files.length === 0) {
            dom.emptyState.classList.remove('hidden');
            if (state.searchTerm) {
                dom.emptyState.querySelector('h3').textContent = 'Sin resultados';
                dom.emptyState.querySelector('p').textContent = `No se encontraron archivos para "${state.searchTerm}".`;
            } else {
                dom.emptyState.querySelector('h3').textContent = 'Tu nube está vacía';
                dom.emptyState.querySelector('p').textContent =
                    'Sube archivos para comenzar. Se guardarán en tu navegador y estarán disponibles incluso sin internet.';
            }
            return;
        }

        dom.emptyState.classList.add('hidden');

        const fragment = document.createDocumentFragment();
        for (const file of files) {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.dataset.id = file.id;
            card.innerHTML = `
                ${buildThumb(file)}
                <div class="file-info">
                    <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="file-meta">${formatBytes(file.size)} · ${formatDate(file.createdAt)}</div>
                </div>
                <div class="file-size">${formatBytes(file.size)}</div>
                <div class="file-date">${formatDate(file.createdAt)}</div>
                <div class="file-actions">
                    <button class="btn-icon" data-action="download" title="Descargar">⬇</button>
                    <button class="btn-icon" data-action="delete" title="Eliminar">🗑</button>
                </div>
            `;
            fragment.appendChild(card);
        }
        dom.filesList.appendChild(fragment);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function setViewMode(mode) {
        state.viewMode = mode;
        localStorage.setItem('nube_view', mode);
        dom.filesContainer.classList.toggle('grid-view', mode === 'grid');
        dom.filesContainer.classList.toggle('list-view', mode === 'list');
        dom.gridViewBtn.classList.toggle('active', mode === 'grid');
        dom.listViewBtn.classList.toggle('active', mode === 'list');
    }

    // ===== Acciones =====

    async function refresh() {
        state.files = await getAllFiles();
        renderFiles();
        updateStorageInfo();
    }

    async function handleUpload(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        dom.uploadProgress.classList.remove('hidden');
        let done = 0;
        let failed = 0;

        for (const file of files) {
            try {
                await addFile(file);
                done++;
            } catch (err) {
                console.error('Error guardando', file.name, err);
                failed++;
                // Causa más probable: cuota excedida.
                if (err && err.name === 'QuotaExceededError') {
                    toast(`Espacio insuficiente para "${file.name}"`, 'error', 5000);
                } else {
                    toast(`Error al guardar "${file.name}"`, 'error');
                }
            }
            const total = done + failed;
            const percent = Math.round((total / files.length) * 100);
            dom.progressBar.style.width = `${percent}%`;
            dom.progressText.textContent = `${percent}%`;
        }

        setTimeout(() => {
            dom.uploadProgress.classList.add('hidden');
            dom.progressBar.style.width = '0%';
            dom.progressText.textContent = '0%';
        }, 600);

        if (done > 0) {
            toast(`${done} archivo${done !== 1 ? 's' : ''} guardado${done !== 1 ? 's' : ''} correctamente`, 'success');
        }
        await refresh();
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Pequeño delay antes de revocar para asegurar que la descarga inicie.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function handleDownload(id) {
        const file = await getFile(id);
        if (!file) return;
        downloadBlob(file.blob, file.name);
    }

    async function handleDelete(id) {
        const file = await getFile(id);
        if (!file) return;
        if (!confirm(`¿Eliminar "${file.name}"? Esta acción no se puede deshacer.`)) return;
        await deleteFile(id);
        toast('Archivo eliminado', 'success');
        await refresh();
    }

    async function handleClearAll() {
        if (state.files.length === 0) {
            toast('No hay archivos para eliminar', 'warning');
            return;
        }
        if (!confirm(`¿Eliminar TODOS los ${state.files.length} archivos? Esta acción no se puede deshacer.`)) return;
        await clearAllFiles();
        toast('Todos los archivos fueron eliminados', 'success');
        await refresh();
    }

    async function handleExportAll() {
        if (state.files.length === 0) {
            toast('No hay archivos para exportar', 'warning');
            return;
        }
        // Descargamos cada archivo individualmente (sin dependencias externas como JSZip).
        toast(`Descargando ${state.files.length} archivo(s)…`, 'info');
        for (const f of state.files) {
            const full = await getFile(f.id);
            if (full) {
                downloadBlob(full.blob, full.name);
                // Damos un respiro al navegador entre descargas.
                await new Promise((r) => setTimeout(r, 250));
            }
        }
    }

    async function handlePreview(id) {
        const file = await getFile(id);
        if (!file) return;

        dom.previewTitle.textContent = file.name;
        dom.previewBody.innerHTML = '';
        dom.previewDownloadBtn.onclick = () => downloadBlob(file.blob, file.name);

        const url = URL.createObjectURL(file.blob);

        // Liberamos la URL al cerrar el modal.
        const cleanup = () => {
            URL.revokeObjectURL(url);
            dom.previewBody.innerHTML = '';
        };

        if (isPreviewableImage(file.type)) {
            const img = document.createElement('img');
            img.src = url;
            img.alt = file.name;
            dom.previewBody.appendChild(img);
        } else if (isPreviewableVideo(file.type)) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            dom.previewBody.appendChild(video);
        } else if (isPreviewableAudio(file.type)) {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.controls = true;
            dom.previewBody.appendChild(audio);
        } else if (isPreviewablePDF(file.type)) {
            const iframe = document.createElement('iframe');
            iframe.src = url;
            iframe.title = file.name;
            dom.previewBody.appendChild(iframe);
        } else if (isPreviewableText(file.type, file.name) && file.size < 5 * 1024 * 1024) {
            try {
                const text = await file.blob.text();
                const pre = document.createElement('pre');
                pre.textContent = text;
                dom.previewBody.appendChild(pre);
            } catch {
                showFallback(file);
            }
        } else {
            showFallback(file);
        }

        openModal(cleanup);
    }

    function showFallback(file) {
        const div = document.createElement('div');
        div.className = 'preview-fallback';
        div.innerHTML = `
            <div class="icon">${getFileIcon(file.type, file.name)}</div>
            <h3>${escapeHtml(file.name)}</h3>
            <p>${escapeHtml(file.type || 'archivo binario')} · ${formatBytes(file.size)}</p>
            <p style="margin-top: 12px;">No hay vista previa disponible para este tipo de archivo.</p>
        `;
        dom.previewBody.appendChild(div);
    }

    let modalCleanup = null;
    function openModal(cleanup) {
        modalCleanup = cleanup;
        dom.previewModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }
    function closeModal() {
        dom.previewModal.classList.add('hidden');
        document.body.style.overflow = '';
        if (modalCleanup) { modalCleanup(); modalCleanup = null; }
    }

    // ===== Event listeners =====

    function setupEvents() {
        // Drag & drop
        ['dragenter', 'dragover'].forEach((ev) => {
            dom.dropZone.addEventListener(ev, (e) => {
                e.preventDefault();
                dom.dropZone.classList.add('dragging');
            });
        });
        ['dragleave', 'drop'].forEach((ev) => {
            dom.dropZone.addEventListener(ev, (e) => {
                e.preventDefault();
                if (ev === 'dragleave' && e.target !== dom.dropZone) return;
                dom.dropZone.classList.remove('dragging');
            });
        });
        dom.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZone.classList.remove('dragging');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleUpload(e.dataTransfer.files);
            }
        });
        // Drop fuera de la zona = ignorar (pero evitar que el navegador abra el archivo)
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());

        // Botón de selección
        dom.fileInput.addEventListener('change', (e) => {
            handleUpload(e.target.files);
            e.target.value = ''; // permitir re-subir el mismo archivo
        });

        // Búsqueda
        dom.searchInput.addEventListener('input', (e) => {
            state.searchTerm = e.target.value.trim();
            renderFiles();
        });

        // Orden
        dom.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            renderFiles();
        });

        // Vistas
        dom.gridViewBtn.addEventListener('click', () => setViewMode('grid'));
        dom.listViewBtn.addEventListener('click', () => setViewMode('list'));

        // Acciones globales
        dom.exportAllBtn.addEventListener('click', handleExportAll);
        dom.clearAllBtn.addEventListener('click', handleClearAll);

        // Acciones por archivo (delegación)
        dom.filesList.addEventListener('click', (e) => {
            const card = e.target.closest('.file-card');
            if (!card) return;
            const id = Number(card.dataset.id);

            const actionBtn = e.target.closest('[data-action]');
            if (actionBtn) {
                e.stopPropagation();
                const action = actionBtn.dataset.action;
                if (action === 'download') handleDownload(id);
                else if (action === 'delete') handleDelete(id);
                return;
            }
            // Click sobre el card -> previsualizar
            handlePreview(id);
        });

        // Modal
        dom.previewModal.addEventListener('click', (e) => {
            if (e.target.matches('[data-close-modal]')) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !dom.previewModal.classList.contains('hidden')) {
                closeModal();
            }
        });
    }

    // ===== Inicialización =====

    async function init() {
        if (!('indexedDB' in window)) {
            toast('Tu navegador no soporta IndexedDB y no puede ejecutar esta app.', 'error', 8000);
            return;
        }
        // Pedimos almacenamiento persistente (evita que el navegador borre los datos
        // cuando le falta espacio). Solo se concede en algunos contextos seguros.
        if (navigator.storage && navigator.storage.persist) {
            try {
                await navigator.storage.persist();
            } catch { /* opcional */ }
        }
        setupEvents();
        setViewMode(state.viewMode);
        await refresh();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
