/**
 * Simplexa — Popup Script
 * Lógica de la interfaz del popup: activar/desactivar simplificación,
 * mostrar estado del modelo, y gestionar la comunicación con el background.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ── Elementos del DOM ────────────────────────────────────────────────

    const btnSimplify = document.getElementById('btnSimplify');
    const btnDeactivate = document.getElementById('btnDeactivate');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');

    // ── Estado inicial ───────────────────────────────────────────────────

    // Obtener pestaña activa
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;

    if (!tabId) {
        btnSimplify.disabled = true;
        statusText.textContent = 'No hay pestaña activa';
        return;
    }

    // Verificar si la pestaña ya está activa
    const tabState = await sendMessage({ type: 'IS_TAB_ACTIVE', tabId });
    if (tabState?.active) {
        setActiveUI();
    }

    // Obtener estado del modelo
    const modelStatus = await sendMessage({ type: 'GET_MODEL_STATUS' });
    updateModelStatus(modelStatus);

    // ── Eventos ──────────────────────────────────────────────────────────

    btnSimplify.addEventListener('click', async () => {
        btnSimplify.disabled = true;
        btnSimplify.querySelector('.btn-text').textContent = 'Iniciando...';

        try {
            const result = await sendMessage({ type: 'ACTIVATE_TAB', tabId });

            if (result?.ok) {
                setActiveUI();
            } else {
                btnSimplify.disabled = false;
                btnSimplify.querySelector('.btn-text').textContent = 'Simplificar esta página';
                statusText.textContent = result?.error || 'Error al activar';
                statusDot.className = 'status-dot error';
            }
        } catch (err) {
            btnSimplify.disabled = false;
            btnSimplify.querySelector('.btn-text').textContent = 'Simplificar esta página';
            console.error('[Simplexa Popup]', err);
        }
    });

    btnDeactivate.addEventListener('click', async () => {
        await sendMessage({ type: 'DEACTIVATE_TAB', tabId });
        setInactiveUI();
    });

    // ── Escuchar actualizaciones del modelo ──────────────────────────────

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MODEL_STATUS_UPDATE') {
            updateModelStatus(message.payload);
        }
    });

    // ── Funciones de UI ──────────────────────────────────────────────────

    function setActiveUI() {
        btnSimplify.style.display = 'none';
        btnDeactivate.style.display = 'flex';
    }

    function setInactiveUI() {
        btnSimplify.style.display = 'flex';
        btnDeactivate.style.display = 'none';
        btnSimplify.disabled = false;
        btnSimplify.querySelector('.btn-text').textContent = 'Simplificar esta página';
    }

    function updateModelStatus(status) {
        if (!status) return;

        switch (status.status) {
            case 'idle':
                statusDot.className = 'status-dot';
                statusText.textContent = 'Modelo no cargado';
                progressContainer.style.display = 'none';
                break;

            case 'downloading':
                statusDot.className = 'status-dot downloading';
                statusText.textContent = 'Descargando modelo de IA...';
                progressContainer.style.display = 'flex';
                const pct = Math.round((status.progress || 0) * 100);
                progressFill.style.width = `${pct}%`;
                progressText.textContent = `${pct}%`;
                break;

            case 'ready':
                statusDot.className = 'status-dot ready';
                statusText.textContent = 'Modelo listo ✓';
                progressContainer.style.display = 'none';
                break;

            case 'error':
                statusDot.className = 'status-dot error';
                statusText.textContent = status.error || 'Error del modelo';
                progressContainer.style.display = 'none';
                break;
        }
    }

    // ── Utilidades ───────────────────────────────────────────────────────

    function sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                resolve(response);
            });
        });
    }
});
