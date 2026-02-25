/**
 * Simplexa — Offscreen Document Script
 * Ejecuta WebLLM en el contexto de la extensión (no del content script)
 * para evitar restricciones de CSP de las páginas web.
 * Este documento tiene acceso a wasm-unsafe-eval y WebGPU.
 */

import { aiManager } from './lib/ai_manager.bundle.js';

// ── Message Handler ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'OFFSCREEN_INIT':
            handleInit(message, sendResponse);
            return true;

        case 'OFFSCREEN_ANALYZE':
            handleAnalyze(message, sendResponse);
            return true;

        case 'OFFSCREEN_CHAT':
            handleChat(message, sendResponse);
            return true;

        case 'OFFSCREEN_STATUS':
            sendResponse({ ready: aiManager.isReady });
            return false;
    }
});

// ── Handlers ────────────────────────────────────────────────────────────

async function handleInit(message, sendResponse) {
    try {
        // Setup progress relay → background → content script
        aiManager.onProgress((report) => {
            chrome.runtime.sendMessage({
                type: 'AI_PROGRESS',
                tabId: message.tabId,
                payload: report
            }).catch(() => { });
        });

        if (!aiManager.isReady) {
            await aiManager.initialize();
        }

        sendResponse({ ok: true });
    } catch (error) {
        sendResponse({ ok: false, error: error.message });
    }
}

async function handleAnalyze(message, sendResponse) {
    try {
        // Asegurar que el modelo esté inicializado
        if (!aiManager.isReady) {
            aiManager.onProgress((report) => {
                chrome.runtime.sendMessage({
                    type: 'AI_PROGRESS',
                    tabId: message.tabId,
                    payload: report
                }).catch(() => { });
            });
            await aiManager.initialize();
        }

        const summary = await aiManager.analyzePage(
            message.elements,
            message.pageTitle,
            message.pageUrl
        );

        sendResponse({ ok: true, summary });
    } catch (error) {
        sendResponse({ ok: false, error: error.message });
    }
}

async function handleChat(message, sendResponse) {
    try {
        const reply = await aiManager.chat(message.question);
        sendResponse({ ok: true, reply });
    } catch (error) {
        sendResponse({ ok: false, error: error.message });
    }
}

console.log('[Simplexa] Offscreen document cargado.');
