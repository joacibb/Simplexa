/**
 * Simplexa — Content Script
 * Motor de escaneo DOM + inyección de interfaz simplificada via Shadow DOM.
 * Se ejecuta en el contexto de cada página web.
 */

(() => {
    'use strict';

    // ── Estado ───────────────────────────────────────────────────────────

    let overlayRoot = null;
    let shadowRoot = null;
    let isActive = false;

    // ── Selectores de elementos interactivos ─────────────────────────────

    const INTERACTIVE_SELECTORS = [
        'button',
        'a[href]',
        'input',
        'select',
        'textarea',
        'h1', 'h2', 'h3',
        'label',
        'nav',
        '[role="button"]',
        '[role="link"]',
        '[role="navigation"]',
        '[role="search"]',
        '[role="form"]'
    ];

    // Campos que contienen datos sensibles — NO enviar al modelo
    const SENSITIVE_PATTERNS = {
        types: ['password', 'credit-card', 'cc-number', 'cc-exp', 'cc-csc'],
        names: /password|passwd|pwd|credit.?card|cc.?num|cvv|cvc|ssn|social.?security/i,
        autocomplete: /cc-|new-password|current-password|credit-card/i
    };

    // ── Escaneo del DOM ──────────────────────────────────────────────────

    /**
     * Escanea la página y genera un esquema JSON compacto de elementos interactivos.
     * @returns {object} Esquema con metadatos de la página y lista de elementos.
     */
    function scanDOM() {
        const elements = [];
        const selector = INTERACTIVE_SELECTORS.join(', ');
        const nodes = document.querySelectorAll(selector);

        // Limitar a 80 elementos para no saturar contexto del LLM
        const maxElements = 80;
        let count = 0;

        for (const node of nodes) {
            if (count >= maxElements) break;

            // Ignorar elementos ocultos
            if (!isVisible(node)) continue;

            const elementData = extractElementData(node);
            if (elementData) {
                elements.push(elementData);
                count++;
            }
        }

        return {
            page: {
                title: document.title,
                url: window.location.href,
                lang: document.documentElement.lang || 'es'
            },
            elements
        };
    }

    /**
     * Extrae datos relevantes de un elemento del DOM.
     */
    function extractElementData(node) {
        const tag = node.tagName.toLowerCase();
        const data = { tag };

        // Texto visible del elemento
        const text = getVisibleText(node);
        if (text) data.text = text;

        // Atributos relevantes según tipo de elemento
        switch (tag) {
            case 'a':
                data.type = 'enlace';
                if (node.href) data.href = sanitizeUrl(node.href);
                break;

            case 'button':
                data.type = 'botón';
                break;

            case 'input':
            case 'textarea':
                data.type = 'campo';
                data.inputType = node.type || 'text';

                // ── SEGURIDAD: Detectar campos sensibles ──
                if (isSensitiveField(node)) {
                    data.sensitive = true;
                    data.text = '[DATO SENSIBLE - NO PROCESAR]';
                    // No incluir valor ni placeholder de campos sensibles
                    return data;
                }

                if (node.placeholder) data.placeholder = node.placeholder;
                if (node.required) data.required = true;
                break;

            case 'select':
                data.type = 'selector';
                data.options = Array.from(node.options)
                    .slice(0, 5) // Máximo 5 opciones para no saturar
                    .map(o => o.textContent.trim());
                break;

            case 'h1':
            case 'h2':
            case 'h3':
                data.type = 'título';
                data.level = parseInt(tag[1]);
                break;

            case 'label':
                data.type = 'etiqueta';
                break;

            case 'nav':
                data.type = 'navegación';
                // Extraer solo los links directos del nav
                const navLinks = Array.from(node.querySelectorAll('a[href]'))
                    .slice(0, 8)
                    .map(a => ({ text: getVisibleText(a), href: sanitizeUrl(a.href) }))
                    .filter(l => l.text);
                if (navLinks.length) data.links = navLinks;
                break;

            default:
                // Elementos con role
                data.type = node.getAttribute('role') || 'interactivo';
        }

        // Aria-label como fallback del texto
        if (!data.text && node.getAttribute('aria-label')) {
            data.text = node.getAttribute('aria-label');
        }

        // Descartar elementos sin texto identificable
        if (!data.text && !data.links && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
            return null;
        }

        return data;
    }

    // ── Seguridad: Detección de campos sensibles ─────────────────────────

    /**
     * Determina si un campo de formulario contiene datos sensibles.
     * Estos campos NO se envían al modelo de IA.
     */
    function isSensitiveField(node) {
        const type = (node.type || '').toLowerCase();
        const name = (node.name || '').toLowerCase();
        const id = (node.id || '').toLowerCase();
        const autocomplete = (node.getAttribute('autocomplete') || '').toLowerCase();

        // Tipo password siempre es sensible
        if (type === 'password') return true;

        // Patrones en nombre o ID
        if (SENSITIVE_PATTERNS.names.test(name) || SENSITIVE_PATTERNS.names.test(id)) return true;

        // Autocomplete de tarjeta o contraseña
        if (SENSITIVE_PATTERNS.autocomplete.test(autocomplete)) return true;

        // Tipos explícitamente sensibles
        if (SENSITIVE_PATTERNS.types.includes(type)) return true;

        return false;
    }

    // ── Utilidades DOM ───────────────────────────────────────────────────

    function isVisible(node) {
        const style = window.getComputedStyle(node);
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            node.offsetWidth > 0 &&
            node.offsetHeight > 0;
    }

    function getVisibleText(node) {
        // Priorizar aria-label, luego textContent
        const ariaLabel = node.getAttribute('aria-label');
        if (ariaLabel) return ariaLabel.trim().slice(0, 100);

        const text = node.textContent || '';
        return text.trim().slice(0, 100); // Limitar longitud
    }

    function sanitizeUrl(url) {
        try {
            const parsed = new URL(url);
            // Solo devolver path para URLs del mismo dominio
            if (parsed.origin === window.location.origin) {
                return parsed.pathname;
            }
            return parsed.href;
        } catch {
            return url;
        }
    }

    // ── Shadow DOM Overlay ───────────────────────────────────────────────

    /**
     * Crea e inyecta el overlay de Simplexa usando Shadow DOM aislado.
     */
    function createOverlay() {
        if (overlayRoot) return;

        overlayRoot = document.createElement('div');
        overlayRoot.id = 'simplexa-overlay-host';
        // Posicionamiento fijo sin interferir con la página
        overlayRoot.style.cssText = 'all: initial; position: fixed; top: 0; right: 0; z-index: 2147483647; pointer-events: none;';

        shadowRoot = overlayRoot.attachShadow({ mode: 'closed' });

        // Cargar estilos del overlay
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = chrome.runtime.getURL('styles/overlay.css');
        shadowRoot.appendChild(style);

        // Contenedor principal
        const container = document.createElement('div');
        container.id = 'simplexa-panel';
        container.innerHTML = `
      <div class="simplexa-header">
        <div class="simplexa-logo">
          <span class="simplexa-icon">✦</span>
          <span class="simplexa-title">Simplexa</span>
        </div>
        <button class="simplexa-close" aria-label="Cerrar Simplexa">✕</button>
      </div>
      <div class="simplexa-content">
        <div class="simplexa-loading">
          <div class="simplexa-spinner"></div>
          <p class="simplexa-loading-text">Analizando la página...</p>
          <div class="simplexa-progress-bar">
            <div class="simplexa-progress-fill"></div>
          </div>
        </div>
        <div class="simplexa-instructions" style="display: none;"></div>
      </div>
      <div class="simplexa-footer">
        <span>🔒 Todo se procesa en tu dispositivo</span>
      </div>
    `;
        shadowRoot.appendChild(container);

        // Evento de cierre
        const closeBtn = shadowRoot.querySelector('.simplexa-close');
        closeBtn.addEventListener('click', () => {
            deactivate();
            chrome.runtime.sendMessage({ type: 'DEACTIVATE_TAB' });
        });

        document.documentElement.appendChild(overlayRoot);
    }

    /**
     * Muestra las instrucciones simplificadas en el overlay.
     */
    function showInstructions(text) {
        if (!shadowRoot) return;

        const loading = shadowRoot.querySelector('.simplexa-loading');
        const instructions = shadowRoot.querySelector('.simplexa-instructions');

        if (loading) loading.style.display = 'none';
        if (instructions) {
            // Convertir las instrucciones en HTML con formato
            instructions.innerHTML = formatInstructions(text);
            instructions.style.display = 'block';
        }
    }

    /**
     * Muestra un error en el overlay.
     */
    function showError(message) {
        if (!shadowRoot) return;

        const loading = shadowRoot.querySelector('.simplexa-loading');
        const instructions = shadowRoot.querySelector('.simplexa-instructions');

        if (loading) loading.style.display = 'none';
        if (instructions) {
            instructions.innerHTML = `
        <div class="simplexa-error">
          <span class="simplexa-error-icon">⚠️</span>
          <p>${message}</p>
          <button class="simplexa-retry" onclick="this.closest('.simplexa-instructions').style.display='none'">
            Reintentar
          </button>
        </div>
      `;
            instructions.style.display = 'block';
        }
    }

    /**
     * Actualiza la barra de progreso de descarga del modelo.
     */
    function updateProgress(progress, text) {
        if (!shadowRoot) return;

        const fill = shadowRoot.querySelector('.simplexa-progress-fill');
        const loadingText = shadowRoot.querySelector('.simplexa-loading-text');

        if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
        if (loadingText && text) loadingText.textContent = text;
    }

    /**
     * Formatea instrucciones de texto plano a HTML legible.
     */
    function formatInstructions(text) {
        // Dividir por líneas y formatear
        const lines = text.split('\n').filter(l => l.trim());
        let html = '';

        for (const line of lines) {
            const trimmed = line.trim();

            // Detectar pasos numerados: "1.", "1)", "Paso 1:"
            const stepMatch = trimmed.match(/^(\d+)[.):\s-]+\s*(.+)/);
            if (stepMatch) {
                html += `<div class="simplexa-step">
          <span class="simplexa-step-number">${stepMatch[1]}</span>
          <span class="simplexa-step-text">${stepMatch[2]}</span>
        </div>`;
            } else if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
                html += `<div class="simplexa-bullet">${trimmed.slice(1).trim()}</div>`;
            } else {
                html += `<p class="simplexa-paragraph">${trimmed}</p>`;
            }
        }

        return html;
    }

    /**
     * Elimina el overlay de la página.
     */
    function removeOverlay() {
        if (overlayRoot) {
            overlayRoot.remove();
            overlayRoot = null;
            shadowRoot = null;
        }
    }

    // ── Motor principal ──────────────────────────────────────────────────

    /**
     * Activa Simplexa: escanea el DOM, carga la IA si es necesario,
     * y muestra las instrucciones simplificadas.
     */
    async function activate() {
        if (isActive) return;
        isActive = true;

        // 1. Crear overlay con estado de carga
        createOverlay();

        try {
            // 2. Escanear el DOM
            updateProgress(0.1, 'Escaneando la página...');
            const schema = scanDOM();
            console.log('[Simplexa] DOM escaneado:', schema.elements.length, 'elementos');

            // 3. Importar y cargar el AI Manager dinámicamente
            updateProgress(0.2, 'Preparando la inteligencia artificial...');

            // Importar el módulo de IA
            const { aiManager } = await import(chrome.runtime.getURL('ai_manager.js'));

            // Configurar callback de progreso
            aiManager.onProgress((report) => {
                const progressText = report.text || 'Descargando modelo de IA...';
                const progressValue = 0.2 + (report.progress || 0) * 0.6;
                updateProgress(progressValue, progressText);
            });

            // Inicializar si no está listo
            if (!aiManager.isReady) {
                await aiManager.initialize();
            }

            // 4. Generar simplificación
            updateProgress(0.85, 'Generando instrucciones...');
            const instructions = await aiManager.simplifyPage(
                schema.elements,
                schema.page.title,
                schema.page.url
            );

            // 5. Mostrar resultado
            showInstructions(instructions);

        } catch (error) {
            console.error('[Simplexa] Error:', error);

            // Mensajes de error amigables
            let errorMsg = 'No se pudo simplificar la página.';
            if (error.message?.includes('WebGPU')) {
                errorMsg = 'Tu navegador no soporta WebGPU. Necesitas Chrome 113 o superior con una GPU compatible.';
            } else if (error.message?.includes('model')) {
                errorMsg = 'Error al cargar el modelo de IA. Verifica tu conexión a internet para la primera descarga.';
            }

            showError(errorMsg);
        }
    }

    /**
     * Desactiva Simplexa y limpia el overlay.
     */
    function deactivate() {
        isActive = false;
        removeOverlay();
    }

    // ── Listener de mensajes del background ──────────────────────────────

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'START_SIMPLIFICATION':
                activate();
                sendResponse({ ok: true });
                break;

            case 'STOP_SIMPLIFICATION':
                deactivate();
                sendResponse({ ok: true });
                break;

            case 'PING':
                sendResponse({ ok: true, active: isActive });
                break;
        }
        return true;
    });

    console.log('[Simplexa] Content script cargado.');
})();
