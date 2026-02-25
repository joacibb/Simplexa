/**
 * Simplexa — Background Service Worker
 * Gestiona la comunicación entre popup, content script y el estado del modelo IA.
 */

// Estado global del modelo por sesión
let modelState = {
  status: 'idle', // idle | downloading | ready | error
  progress: 0,
  error: null
};

// Estado de activación por pestaña
const activeTabs = new Set();

// ── Listeners de mensajes ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handlers = {
    'GET_MODEL_STATUS': () => {
      sendResponse({ ...modelState });
    },

    'SET_MODEL_STATUS': () => {
      modelState = { ...modelState, ...message.payload };
      // Notificar al popup si está abierto
      chrome.runtime.sendMessage({
        type: 'MODEL_STATUS_UPDATE',
        payload: modelState
      }).catch(() => { /* popup cerrado, ignorar */ });
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
        // Enviar mensaje al content script para que inicie el escaneo
        await chrome.tabs.sendMessage(tabId, { type: 'START_SIMPLIFICATION' });
        sendResponse({ ok: true });
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
    return true; // Mantener canal abierto para respuestas async
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
    // Valores por defecto en storage
    chrome.storage.local.set({
      simplexa_settings: {
        modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
        fontSize: 'large',
        highContrast: true
      }
    });
  }
});
