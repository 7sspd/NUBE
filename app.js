/**
 * NUBE Offline - Almacenamiento local con IndexedDB + cifrado AES-256-GCM.
 *
 * Arquitectura:
 *  - Los archivos se guardan como Blob binario en IndexedDB. Sin pérdida.
 *  - Modo "cifrado": cada archivo se cifra con AES-256-GCM. La clave se deriva
 *    de la contraseña del usuario mediante PBKDF2 (200k iteraciones, SHA-256).
 *    La contraseña NO se guarda; solo se guarda un "verificador" cifrado para
 *    poder validar el password en el desbloqueo.
 *  - Modo "abierto": archivos sin cifrar (más rápido, menos privado).
 *  - PWA: servicio worker en sw.js cachea el app shell para uso offline.
 *
 * Lo que se cifra (modo cifrado): nombre del archivo + contenido (blob).
 * Lo que NO se cifra: tamaño, tipo MIME, fecha de creación. Esto permite
 * ordenar/filtrar sin tener que descifrar todos los archivos en memoria.
 */
(() => {
    'use strict';

    // =========================================================
    // 1. IndexedDB
    // =========================================================
    const DB_NAME = 'nube_offline';
    const DB_VERSION = 2;
    const STORE_FILES = 'files';
    const STORE_CONFIG = 'config';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_FILES)) {
                    const s = db.createObjectStore(STORE_FILES, { keyPath: 'id', autoIncrement: true });
                    s.createIndex('createdAt', 'createdAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_CONFIG)) {
                    db.createObjectStore(STORE_CONFIG, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function reqToPromise(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getConfig(key) {
        const db = await openDB();
        const tx = db.transaction(STORE_CONFIG, 'readonly');
        return reqToPromise(tx.objectStore(STORE_CONFIG).get(key));
    }
    async function setConfig(key, value) {
        const db = await openDB();
        const tx = db.transaction(STORE_CONFIG, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_CONFIG).put({ key, ...value }));
    }
    async function clearConfig() {
        const db = await openDB();
        const tx = db.transaction(STORE_CONFIG, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_CONFIG).clear());
    }

    async function addRecord(record) {
        const db = await openDB();
        const tx = db.transaction(STORE_FILES, 'readwrite');
        const id = await reqToPromise(tx.objectStore(STORE_FILES).add(record));
        await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
        return id;
    }
    async function getAllRecords() {
        const db = await openDB();
        const tx = db.transaction(STORE_FILES, 'readonly');
        return reqToPromise(tx.objectStore(STORE_FILES).getAll());
    }
    async function getRecord(id) {
        const db = await openDB();
        const tx = db.transaction(STORE_FILES, 'readonly');
        return reqToPromise(tx.objectStore(STORE_FILES).get(id));
    }
    async function deleteRecord(id) {
        const db = await openDB();
        const tx = db.transaction(STORE_FILES, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_FILES).delete(id));
    }
    async function clearRecords() {
        const db = await openDB();
        const tx = db.transaction(STORE_FILES, 'readwrite');
        await reqToPromise(tx.objectStore(STORE_FILES).clear());
    }

    // =========================================================
    // 2. Criptografía (AES-256-GCM + PBKDF2)
    // =========================================================
    const PBKDF2_ITERATIONS = 200000;
    const VERIFIER_PLAINTEXT = 'NUBE_OK_v1';

    function randomBytes(n) {
        const arr = new Uint8Array(n);
        crypto.getRandomValues(arr);
        return arr;
    }

    async function deriveKey(password, salt) {
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptBytes(key, bytes) {
        const iv = randomBytes(12);
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
        return { iv, ct: new Uint8Array(ct) };
    }

    async function decryptBytes(key, iv, ct) {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return new Uint8Array(pt);
    }

    async function encryptString(key, str) {
        return encryptBytes(key, new TextEncoder().encode(str));
    }
    async function decryptString(key, iv, ct) {
        const bytes = await decryptBytes(key, iv, ct);
        return new TextDecoder().decode(bytes);
    }

    async function encryptBlob(key, blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const { iv, ct } = await encryptBytes(key, buf);
        return { iv, blob: new Blob([ct]) };
    }

    async function decryptBlob(key, iv, blob, mimeType) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const pt = await decryptBytes(key, iv, buf);
        return new Blob([pt], { type: mimeType || 'application/octet-stream' });
    }

    // =========================================================
    // 3. Estado global
    // =========================================================
    const state = {
        files: [],            // metadatos en memoria (con name ya descifrado)
        viewMode: localStorage.getItem('nube_view') || 'grid',
        sortBy: 'date-desc',
        searchTerm: '',
        encrypted: false,     // true si el vault está cifrado
        cryptoKey: null,      // CryptoKey activa (null si no hay cifrado o está bloqueado)
        deferredInstall: null // BeforeInstallPromptEvent para PWA
    };

    // =========================================================
    // 4. DOM helpers
    // =========================================================
    const $ = (id) => document.getElementById(id);
    const dom = {};
    function bindDom() {
        const ids = [
            'setupScreen', 'setupPasswordForm', 'setupPassword', 'setupPassword2',
            'lockScreen', 'unlockForm', 'unlockPassword', 'unlockError', 'resetVaultBtn',
            'mainApp', 'installBtn', 'lockBtn', 'encryptionBadge',
            'dropZone', 'fileInput', 'uploadProgress', 'progressBar', 'progressText',
            'searchInput', 'sortSelect', 'gridViewBtn', 'listViewBtn',
            'exportAllBtn', 'clearAllBtn',
            'filesContainer', 'filesList', 'emptyState',
            'previewModal', 'previewTitle', 'previewBody', 'previewDownloadBtn',
            'toastContainer', 'storageFill', 'storageText', 'footerText'
        ];
        ids.forEach((id) => { dom[id] = $(id); });
    }

    // =========================================================
    // 5. Utilidades de formato
    // =========================================================
    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        const value = bytes / Math.pow(1024, i);
        return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    }
    function formatDate(ts) { return new Date(ts).toLocaleString(); }

    function getFileIcon(type, name) {
        const ext = (name || '').split('.').pop().toLowerCase();
        if (type.startsWith('image/')) return '🖼️';
        if (type.startsWith('video/')) return '🎬';
        if (type.startsWith('audio/')) return '🎵';
        if (type === 'application/pdf' || ext === 'pdf') return '📕';
        if (type.includes('zip') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
        if (type.includes('word') || ['doc', 'docx'].includes(ext)) return '📘';
        if (type.includes('excel') || type.includes('sheet') || ['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
        if (type.includes('powerpoint') || type.includes('presentation') || ['ppt', 'pptx'].includes(ext)) return '📙';
        if (type.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'log'].includes(ext)) return '📝';
        if (['js','ts','jsx','tsx','py','java','c','cpp','cs','go','rb','php','rs','swift','kt','html','css'].includes(ext)) return '💻';
        if (['exe','msi','apk','dmg','deb','rpm'].includes(ext)) return '⚙️';
        return '📄';
    }

    const isImg = (t) => t.startsWith('image/');
    const isVid = (t) => t.startsWith('video/');
    const isAud = (t) => t.startsWith('audio/');
    const isPdf = (t) => t === 'application/pdf';
    function isText(type, name) {
        if (type.startsWith('text/')) return true;
        const ext = (name || '').split('.').pop().toLowerCase();
        return ['txt','md','json','xml','log','js','ts','jsx','tsx','py','java','c','cpp',
                'cs','go','rb','php','rs','swift','kt','html','css','csv','yml','yaml','sh','bash'].includes(ext);
    }

    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (c) => (
            { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
        ));
    }

    // =========================================================
    // 6. Toasts
    // =========================================================
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

    // =========================================================
    // 7. Almacenamiento del navegador (cuota)
    // =========================================================
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
            console.warn('No se pudo obtener la cuota:', err);
        }
    }

    // =========================================================
    // 8. Operaciones de archivo (capa de cifrado)
    // =========================================================
    async function saveFile(file) {
        const baseRecord = {
            type: file.type || 'application/octet-stream',
            size: file.size,
            createdAt: Date.now(),
        };

        if (state.encrypted && state.cryptoKey) {
            const enc = await encryptBlob(state.cryptoKey, file);
            const nameEnc = await encryptString(state.cryptoKey, file.name);
            return addRecord({
                ...baseRecord,
                encrypted: true,
                blob: enc.blob,
                blobIv: enc.iv,
                nameCt: nameEnc.ct,
                nameIv: nameEnc.iv,
            });
        }
        return addRecord({ ...baseRecord, encrypted: false, name: file.name, blob: file });
    }

    /** Devuelve el nombre legible del registro. */
    async function readName(rec) {
        if (rec.encrypted) {
            return decryptString(state.cryptoKey, rec.nameIv, rec.nameCt);
        }
        return rec.name;
    }

    /** Devuelve el Blob descifrado (o el original si no hay cifrado). */
    async function readBlob(rec) {
        if (rec.encrypted) {
            return decryptBlob(state.cryptoKey, rec.blobIv, rec.blob, rec.type);
        }
        return rec.blob;
    }

    async function loadAllFiles() {
        const records = await getAllRecords();
        const list = [];
        for (const r of records) {
            try {
                list.push({
                    id: r.id,
                    name: await readName(r),
                    type: r.type,
                    size: r.size,
                    createdAt: r.createdAt,
                    encrypted: !!r.encrypted,
                });
            } catch (err) {
                console.error('No se pudo leer el registro', r.id, err);
            }
        }
        return list;
    }

    // =========================================================
    // 9. Render UI
    // =========================================================
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

    /**
     * Construye una miniatura. Si está cifrado, usamos icono (descifrar todas
     * las imágenes solo para una miniatura sería costoso). El usuario las verá
     * descifradas en la previsualización.
     */
    function buildThumb(meta) {
        const icon = getFileIcon(meta.type, meta.name);
        if (!meta.encrypted && isImg(meta.type)) {
            // En modo abierto podemos cargar la miniatura directamente.
            return `<div class="file-thumb" data-thumb="${meta.id}">${icon}</div>`;
        }
        return `<div class="file-thumb">${icon}</div>`;
    }

    function renderFiles() {
        // Liberar URLs anteriores
        dom.filesList.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').forEach((el) => {
            URL.revokeObjectURL(el.src);
        });
        dom.filesList.innerHTML = '';

        const files = getFilteredFiles();
        if (files.length === 0) {
            dom.emptyState.classList.remove('hidden');
            const h3 = dom.emptyState.querySelector('h3');
            const p = dom.emptyState.querySelector('p');
            if (state.searchTerm) {
                h3.textContent = 'Sin resultados';
                p.textContent = `No se encontraron archivos para "${state.searchTerm}".`;
            } else {
                h3.textContent = 'Tu nube está vacía';
                p.textContent = 'Sube archivos para comenzar. Se guardarán en tu dispositivo y estarán disponibles incluso sin internet.';
            }
            return;
        }
        dom.emptyState.classList.add('hidden');

        const fragment = document.createDocumentFragment();
        for (const f of files) {
            const card = document.createElement('div');
            card.className = 'file-card';
            card.dataset.id = f.id;
            card.tabIndex = 0;
            card.innerHTML = `
                ${buildThumb(f)}
                <div class="file-info">
                    <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                    <div class="file-meta">${formatBytes(f.size)} · ${formatDate(f.createdAt)}</div>
                </div>
                <div class="file-size">${formatBytes(f.size)}</div>
                <div class="file-date">${formatDate(f.createdAt)}</div>
                <div class="file-actions">
                    <button class="btn-icon" data-action="download" title="Descargar" aria-label="Descargar ${escapeHtml(f.name)}">⬇</button>
                    <button class="btn-icon" data-action="delete"   title="Eliminar"  aria-label="Eliminar ${escapeHtml(f.name)}">🗑</button>
                </div>
            `;
            fragment.appendChild(card);
        }
        dom.filesList.appendChild(fragment);

        // Cargar miniaturas de imágenes solo en modo abierto
        if (!state.encrypted) {
            dom.filesList.querySelectorAll('[data-thumb]').forEach(async (el) => {
                const id = Number(el.dataset.thumb);
                try {
                    const rec = await getRecord(id);
                    if (rec && isImg(rec.type)) {
                        const url = URL.createObjectURL(rec.blob);
                        el.innerHTML = `<img src="${url}" alt="" loading="lazy">`;
                    }
                } catch {}
            });
        }
    }

    function setViewMode(mode) {
        state.viewMode = mode;
        localStorage.setItem('nube_view', mode);
        dom.filesContainer.classList.toggle('grid-view', mode === 'grid');
        dom.filesContainer.classList.toggle('list-view', mode === 'list');
        dom.gridViewBtn.classList.toggle('active', mode === 'grid');
        dom.listViewBtn.classList.toggle('active', mode === 'list');
    }

    // =========================================================
    // 10. Acciones de usuario
    // =========================================================
    async function refresh() {
        state.files = await loadAllFiles();
        renderFiles();
        updateStorageInfo();
    }

    async function handleUpload(fileList) {
        const files = Array.from(fileList);
        if (files.length === 0) return;

        dom.uploadProgress.classList.remove('hidden');
        let done = 0, failed = 0;
        for (const file of files) {
            try {
                await saveFile(file);
                done++;
            } catch (err) {
                console.error('Error guardando', file.name, err);
                failed++;
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
            toast(`${done} archivo${done !== 1 ? 's' : ''} guardado${done !== 1 ? 's' : ''}${state.encrypted ? ' (cifrado)' : ''}`, 'success');
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
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function handleDownload(id) {
        const rec = await getRecord(id);
        if (!rec) return;
        try {
            const name = await readName(rec);
            const blob = await readBlob(rec);
            downloadBlob(blob, name);
        } catch (err) {
            console.error(err);
            toast('No se pudo descifrar el archivo', 'error');
        }
    }

    async function handleDelete(id) {
        const meta = state.files.find((f) => f.id === id);
        if (!meta) return;
        if (!confirm(`¿Eliminar "${meta.name}"? Esta acción no se puede deshacer.`)) return;
        await deleteRecord(id);
        toast('Archivo eliminado', 'success');
        await refresh();
    }

    async function handleClearAll() {
        if (state.files.length === 0) {
            toast('No hay archivos para eliminar', 'warning');
            return;
        }
        if (!confirm(`¿Eliminar TODOS los ${state.files.length} archivos?`)) return;
        await clearRecords();
        toast('Todos los archivos fueron eliminados', 'success');
        await refresh();
    }

    async function handleExportAll() {
        if (state.files.length === 0) {
            toast('No hay archivos para exportar', 'warning');
            return;
        }
        toast(`Descargando ${state.files.length} archivo(s)…`, 'info');
        for (const meta of state.files) {
            const rec = await getRecord(meta.id);
            if (rec) {
                try {
                    const name = await readName(rec);
                    const blob = await readBlob(rec);
                    downloadBlob(blob, name);
                    await new Promise((r) => setTimeout(r, 250));
                } catch (err) {
                    console.error(err);
                }
            }
        }
    }

    async function handlePreview(id) {
        const rec = await getRecord(id);
        if (!rec) return;
        let name, blob;
        try {
            name = await readName(rec);
            blob = await readBlob(rec);
        } catch {
            toast('No se pudo descifrar el archivo', 'error');
            return;
        }

        dom.previewTitle.textContent = name;
        dom.previewBody.innerHTML = '';
        dom.previewDownloadBtn.onclick = () => downloadBlob(blob, name);

        const url = URL.createObjectURL(blob);
        const cleanup = () => {
            URL.revokeObjectURL(url);
            dom.previewBody.innerHTML = '';
        };

        if (isImg(rec.type)) {
            const img = document.createElement('img');
            img.src = url; img.alt = name;
            dom.previewBody.appendChild(img);
        } else if (isVid(rec.type)) {
            const v = document.createElement('video');
            v.src = url; v.controls = true; v.playsInline = true;
            dom.previewBody.appendChild(v);
        } else if (isAud(rec.type)) {
            const a = document.createElement('audio');
            a.src = url; a.controls = true;
            dom.previewBody.appendChild(a);
        } else if (isPdf(rec.type)) {
            const f = document.createElement('iframe');
            f.src = url; f.title = name;
            dom.previewBody.appendChild(f);
        } else if (isText(rec.type, name) && rec.size < 5 * 1024 * 1024) {
            try {
                const text = await blob.text();
                const pre = document.createElement('pre');
                pre.textContent = text;
                dom.previewBody.appendChild(pre);
            } catch { showFallback(rec, name); }
        } else {
            showFallback(rec, name);
        }
        openModal(cleanup);
    }

    function showFallback(rec, name) {
        const div = document.createElement('div');
        div.className = 'preview-fallback';
        div.innerHTML = `
            <div class="icon">${getFileIcon(rec.type, name)}</div>
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(rec.type || 'archivo binario')} · ${formatBytes(rec.size)}</p>
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

    // =========================================================
    // 11. Auth (setup / unlock / lock)
    // =========================================================
    function showSetup()  { hideAll(); dom.setupScreen.classList.remove('hidden'); }
    function showLock()   { hideAll(); dom.lockScreen.classList.remove('hidden'); setTimeout(() => dom.unlockPassword.focus(), 50); }
    function showApp()    { hideAll(); dom.mainApp.classList.remove('hidden'); }
    function hideAll() {
        dom.setupScreen.classList.add('hidden');
        dom.lockScreen.classList.add('hidden');
        dom.mainApp.classList.add('hidden');
    }

    function updateEncryptionBadge() {
        if (state.encrypted) {
            dom.encryptionBadge.textContent = '🔒 Cifrado';
            dom.encryptionBadge.classList.add('locked-mode');
            dom.encryptionBadge.classList.remove('open-mode');
            dom.lockBtn.classList.remove('hidden');
            dom.footerText.textContent = '100% offline · IndexedDB + AES-256-GCM';
        } else {
            dom.encryptionBadge.textContent = '🔓 Sin cifrar';
            dom.encryptionBadge.classList.add('open-mode');
            dom.encryptionBadge.classList.remove('locked-mode');
            dom.lockBtn.classList.add('hidden');
            dom.footerText.textContent = '100% offline · IndexedDB';
        }
    }

    /** Crea el vault con contraseña por primera vez. */
    async function setupWithPassword(password) {
        const salt = randomBytes(16);
        const key = await deriveKey(password, salt);
        const verifier = await encryptString(key, VERIFIER_PLAINTEXT);
        await setConfig('vault', {
            mode: 'encrypted',
            salt,
            verifierIv: verifier.iv,
            verifierCt: verifier.ct,
            createdAt: Date.now(),
        });
        state.encrypted = true;
        state.cryptoKey = key;
    }

    async function setupOpen() {
        await setConfig('vault', { mode: 'open', createdAt: Date.now() });
        state.encrypted = false;
        state.cryptoKey = null;
    }

    /** Intenta desbloquear con la contraseña. Devuelve true si correcta. */
    async function unlockWithPassword(password) {
        const cfg = await getConfig('vault');
        if (!cfg || cfg.mode !== 'encrypted') return false;
        try {
            const key = await deriveKey(password, cfg.salt);
            const plain = await decryptString(key, cfg.verifierIv, cfg.verifierCt);
            if (plain !== VERIFIER_PLAINTEXT) return false;
            state.encrypted = true;
            state.cryptoKey = key;
            return true;
        } catch {
            return false;
        }
    }

    function lockApp() {
        state.cryptoKey = null;
        state.files = [];
        renderFiles();
        showLock();
    }

    async function resetVault() {
        const ok = confirm(
            'Esto BORRARÁ todos los archivos cifrados (no hay forma de recuperarlos sin la contraseña) ' +
            'y te permitirá empezar de cero. ¿Continuar?'
        );
        if (!ok) return;
        await clearRecords();
        await clearConfig();
        location.reload();
    }

    // =========================================================
    // 12. Service Worker (PWA)
    // =========================================================
    function registerSW() {
        if (!('serviceWorker' in navigator)) return;
        // Servir desde el mismo path donde está la página.
        const swUrl = new URL('sw.js', location.href).toString();
        navigator.serviceWorker.register(swUrl).catch((err) => {
            console.warn('SW registration failed:', err);
        });
    }

    function setupInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            state.deferredInstall = e;
            dom.installBtn.classList.remove('hidden');
        });
        dom.installBtn.addEventListener('click', async () => {
            if (!state.deferredInstall) return;
            state.deferredInstall.prompt();
            await state.deferredInstall.userChoice;
            state.deferredInstall = null;
            dom.installBtn.classList.add('hidden');
        });
        window.addEventListener('appinstalled', () => {
            dom.installBtn.classList.add('hidden');
            toast('¡App instalada!', 'success');
        });
    }

    // =========================================================
    // 13. Event listeners
    // =========================================================
    function setupAuthEvents() {
        // Setup screen
        dom.setupScreen.querySelectorAll('.auth-option').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const mode = btn.dataset.mode;
                if (mode === 'open') {
                    if (!confirm('Sin cifrado, cualquiera con acceso a este dispositivo verá tus archivos. ¿Continuar?')) return;
                    await setupOpen();
                    updateEncryptionBadge();
                    showApp();
                    await refresh();
                } else if (mode === 'password') {
                    dom.setupPasswordForm.classList.remove('hidden');
                    dom.setupScreen.querySelector('.auth-options').classList.add('hidden');
                    setTimeout(() => dom.setupPassword.focus(), 50);
                }
            });
        });
        dom.setupPasswordForm.querySelector('[data-back]').addEventListener('click', () => {
            dom.setupPasswordForm.classList.add('hidden');
            dom.setupScreen.querySelector('.auth-options').classList.remove('hidden');
        });
        dom.setupPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const p1 = dom.setupPassword.value;
            const p2 = dom.setupPassword2.value;
            if (p1.length < 4) { toast('La contraseña debe tener al menos 4 caracteres', 'error'); return; }
            if (p1 !== p2)     { toast('Las contraseñas no coinciden', 'error'); return; }
            try {
                await setupWithPassword(p1);
                updateEncryptionBadge();
                showApp();
                await refresh();
                toast('Nube creada y cifrada 🔒', 'success');
            } catch (err) {
                console.error(err);
                toast('Error creando la nube', 'error');
            }
        });

        // Lock screen
        dom.unlockForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            dom.unlockError.classList.add('hidden');
            const p = dom.unlockPassword.value;
            const ok = await unlockWithPassword(p);
            if (!ok) {
                dom.unlockError.classList.remove('hidden');
                dom.unlockPassword.value = '';
                return;
            }
            dom.unlockPassword.value = '';
            updateEncryptionBadge();
            showApp();
            await refresh();
        });
        dom.resetVaultBtn.addEventListener('click', resetVault);
        dom.lockBtn.addEventListener('click', lockApp);
    }

    function setupAppEvents() {
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
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                handleUpload(e.dataTransfer.files);
            }
        });
        window.addEventListener('dragover', (e) => e.preventDefault());
        window.addEventListener('drop', (e) => e.preventDefault());

        // File input
        dom.fileInput.addEventListener('change', (e) => {
            handleUpload(e.target.files);
            e.target.value = '';
        });

        // Búsqueda y orden
        dom.searchInput.addEventListener('input', (e) => {
            state.searchTerm = e.target.value.trim();
            renderFiles();
        });
        dom.sortSelect.addEventListener('change', (e) => {
            state.sortBy = e.target.value;
            renderFiles();
        });

        // Vista
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
            handlePreview(id);
        });

        // Modal
        dom.previewModal.addEventListener('click', (e) => {
            if (e.target.matches('[data-close-modal]')) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !dom.previewModal.classList.contains('hidden')) closeModal();
        });
    }

    // =========================================================
    // 14. Inicialización
    // =========================================================
    async function init() {
        bindDom();

        if (!('indexedDB' in window)) {
            alert('Tu navegador no soporta IndexedDB y no puede ejecutar esta app.');
            return;
        }
        if (!('crypto' in window) || !crypto.subtle) {
            alert('Tu navegador no soporta Web Crypto. Necesitas un navegador moderno (Chrome, Edge, Firefox, Safari recientes).\n' +
                  'IMPORTANTE: el cifrado solo funciona en HTTPS o desde localhost.');
        }

        // Almacenamiento persistente (evita que el navegador borre datos)
        if (navigator.storage && navigator.storage.persist) {
            try { await navigator.storage.persist(); } catch {}
        }

        registerSW();
        setupInstallPrompt();
        setupAuthEvents();
        setupAppEvents();
        setViewMode(state.viewMode);

        // Decidir pantalla inicial según config almacenada
        const cfg = await getConfig('vault');
        if (!cfg) {
            // Primera vez
            showSetup();
        } else if (cfg.mode === 'encrypted') {
            showLock();
        } else {
            state.encrypted = false;
            updateEncryptionBadge();
            showApp();
            await refresh();
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
