/**
 * Simplexa — Background Service Worker
 * Gestiona la comunicación entre popup, content script y el offscreen document
 * donde corre la IA (WebLLM + WASM + WebGPU).
 */

// Estado global del modelo por sesión
let modelState = {
    status: 'idle', // idle | downloading | ready | error
    progress: 0,
    error: null
};

// Estado de activación por pestaña
const activeTabs = new Set();

// ── Offscreen Document Management ───────────────────────────────────────

async function ensureOffscreenDocument() {
    // Verificar si ya existe
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (contexts.length > 0) return;

    // Crear offscreen document para ejecutar WebLLM
    await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
        justification: 'Ejecutar modelo de IA WebLLM con WebAssembly y WebGPU'
    });

    console.log('[Simplexa] Offscreen document creado.');
}

// ── Listeners de mensajes ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handlers = {
        'GET_MODEL_STATUS': () => {
            sendResponse({ ...modelState });
        },

        'SET_MODEL_STATUS': () => {
            modelState = { ...modelState, ...message.payload };
            chrome.runtime.sendMessage({
                type: 'MODEL_STATUS_UPDATE',
                payload: modelState
            }).catch(() => { });
            sendResponse({ ok: true });
        },

        // Relay de progreso del offscreen → content script
        'AI_PROGRESS': () => {
            const tabId = message.tabId;
            if (tabId) {
                chrome.tabs.sendMessage(tabId, {
                    type: 'AI_PROGRESS_UPDATE',
                    payload: message.payload
                }).catch(() => { });
            }
            // También actualizar el estado global
            modelState = {
                ...modelState,
                status: 'downloading',
                progress: message.payload.progress || 0
            };
            sendResponse({ ok: true });
        },

        'ACTIVATE_TAB': async () => {
            const tabId = message.tabId || sender.tab?.id;
            if (!tabId) {
                sendResponse({ ok: false, error: 'No se pudo determinar la pestaña.' });
                return;
            }
            activeTabs.add(tabId);

            try {
                // Inyectar content script si no está cargado
                await chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['content.js']
                }).catch(() => { });

                await new Promise(r => setTimeout(r, 200));

                // Enviar mensaje al content script para que inicie
                await chrome.tabs.sendMessage(tabId, { type: 'START_SIMPLIFICATION' });
                sendResponse({ ok: true });
            } catch (err) {
                console.error('[Simplexa] Error activando pestaña:', err);
                sendResponse({ ok: false, error: 'No se puede simplificar esta página. Probá en otra.' });
            }
        },

        // Content script pide análisis → crear offscreen + relay
        'REQUEST_ANALYZE': async () => {
            const tabId = sender.tab?.id;
            if (!tabId) {
                sendResponse({ ok: false, error: 'Sin pestaña.' });
                return;
            }

            try {
                await ensureOffscreenDocument();

                // Enviar a offscreen document para procesar
                const result = await chrome.runtime.sendMessage({
                    type: 'OFFSCREEN_ANALYZE',
                    tabId,
                    elements: message.elements,
                    pageTitle: message.pageTitle,
                    pageUrl: message.pageUrl
                });

                sendResponse(result);
            } catch (err) {
                console.error('[Simplexa] Error en análisis:', err);
                sendResponse({ ok: false, error: err.message });
            }
        },

        // Content script pide chat → relay al offscreen
        'REQUEST_CHAT': async () => {
            const tabId = sender.tab?.id;
            try {
                await ensureOffscreenDocument();

                const result = await chrome.runtime.sendMessage({
                    type: 'OFFSCREEN_CHAT',
                    tabId,
                    question: message.question
                });

                sendResponse(result);
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        },

        'DEACTIVATE_TAB': async () => {
            const tabId = message.tabId || sender.tab?.id;
            if (tabId) {
                activeTabs.delete(tabId);
                try {
                    await chrome.tabs.sendMessage(tabId, { type: 'STOP_SIMPLIFICATION' });
                } catch { /* tab puede estar cerrada */ }
            }
            sendResponse({ ok: true });
        },

        'IS_TAB_ACTIVE': () => {
            const tabId = message.tabId || sender.tab?.id;
            sendResponse({ active: activeTabs.has(tabId) });
        }
    };

    const handler = handlers[message.type];
    if (handler) {
        handler();
        return true;
    }
});

// ── Limpieza al cerrar pestañas ────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
});

// ── Evento de instalación ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('[Simplexa] Extensión instalada correctamente.');
        chrome.storage.local.set({
            simplexa_settings: {
                modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
                fontSize: 'large',
                highContrast: true
            }
        });
    }
});
