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
    let elementIdCounter = 0;
    const elementMap = new Map(); // simplexa-id → DOM node

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

    // Dominios legítimos conocidos que suelen ser imitados (phishing)
    const TRUSTED_DOMAINS = [
        'google.com', 'facebook.com', 'amazon.com', 'apple.com', 'microsoft.com',
        'paypal.com', 'netflix.com', 'instagram.com', 'twitter.com', 'x.com',
        'linkedin.com', 'whatsapp.com', 'mercadolibre.com', 'mercadopago.com',
        'bankofamerica.com', 'chase.com', 'wellsfargo.com'
    ];

    // ── Escaneo del DOM ──────────────────────────────────────────────────

    /**
     * Escanea la página y genera un esquema JSON compacto de elementos interactivos.
     * @returns {object} Esquema con metadatos de la página y lista de elementos.
     */
    function scanDOM() {
        const elements = [];
        const selector = INTERACTIVE_SELECTORS.join(', ');
        const nodes = document.querySelectorAll(selector);

        // Limpiar estado previo
        elementIdCounter = 0;
        elementMap.clear();

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

        // Asignar ID único al elemento para mapear la respuesta de la IA
        const simplexaId = `sx-${elementIdCounter++}`;
        node.setAttribute('data-simplexa-id', simplexaId);
        elementMap.set(simplexaId, node);

        const data = { id: simplexaId, tag };

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

    // ── Detección de Seguridad del Sitio ─────────────────────────────────

    /**
     * Analiza la seguridad del sitio actual.
     * @returns {object} { level: 'safe'|'warning'|'danger', reasons: string[] }
     */
    function analyzeSiteSafety() {
        const reasons = [];
        let level = 'safe';
        const url = window.location;

        // 1. Verificar HTTPS
        if (url.protocol !== 'https:') {
            reasons.push('Este sitio NO usa conexión segura (HTTPS). Tu información podría ser leída por otros.');
            level = 'danger';
        }

        // 2. Verificar dominio sospechoso (typosquatting)
        const hostname = url.hostname.toLowerCase();
        const hostBase = hostname.split('.').slice(0, -1).join('.'); // sin TLD
        for (const trusted of TRUSTED_DOMAINS) {
            const base = trusted.split('.')[0];
            // Ignorar dominios base muy cortos (ej: "x") — demasiados falsos positivos
            if (base.length < 5) continue;
            // Solo alertar si el hostname contiene una variación cercana del dominio confiable
            // pero NO es el dominio real
            if (hostname.endsWith(trusted)) continue;
            // Comparar: el nombre base del host debe contener al menos el 80% del dominio confiable
            const threshold = Math.ceil(base.length * 0.8);
            const baseChunk = base.slice(0, threshold);
            if (hostBase.includes(baseChunk) && hostBase !== base) {
                reasons.push(`Este sitio se parece a ${trusted} pero NO es el sitio oficial. ¡Cuidado!`);
                level = 'danger';
            }
        }

        // 3. Dominio con IP directa (sospechoso)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            reasons.push('Este sitio usa una dirección IP en lugar de un nombre normal. Esto es inusual.');
            level = level === 'safe' ? 'warning' : level;
        }

        // 4. Subdominios excesivos (sospechoso)
        const subdomainCount = hostname.split('.').length - 2;
        if (subdomainCount > 3) {
            reasons.push('Este sitio tiene una dirección web muy larga y compleja. Verificalo con cuidado.');
            level = level === 'safe' ? 'warning' : level;
        }

        // 5. Formularios con datos sensibles en HTTP
        if (url.protocol !== 'https:') {
            const hasPasswordField = document.querySelector('input[type="password"]');
            if (hasPasswordField) {
                reasons.push('¡ATENCIÓN! Te piden una contraseña en un sitio SIN conexión segura. No la escribas.');
                level = 'danger';
            }
        }

        // 6. Contenido mixto (HTTPS con recursos HTTP)
        if (url.protocol === 'https:') {
            const insecureResources = document.querySelectorAll(
                'script[src^="http:"], iframe[src^="http:"], form[action^="http:"]'
            );
            if (insecureResources.length > 0) {
                reasons.push('Esta página mezcla contenido seguro e inseguro. Tené precaución.');
                level = level === 'safe' ? 'warning' : level;
            }
        }

        // Mensaje positivo si todo está bien
        if (reasons.length === 0) {
            reasons.push('Conexión segura (HTTPS). El sitio parece confiable.');
        }

        return { level, reasons };
    }

    /**
     * Genera HTML del banner de seguridad para el overlay.
     */
    function buildSafetyBanner(safety) {
        const colors = {
            safe: { bg: 'rgba(52, 211, 153, 0.12)', border: '#34d399', icon: '✅', text: '#6ee7b7' },
            warning: { bg: 'rgba(251, 191, 36, 0.12)', border: '#fbbf24', icon: '⚠️', text: '#fde68a' },
            danger: { bg: 'rgba(239, 68, 68, 0.15)', border: '#ef4444', icon: '🚨', text: '#fca5a5' }
        };
        const c = colors[safety.level];
        const reasonsHTML = safety.reasons.map(r => `<div style="font-size:14px;margin:3px 0;">• ${r}</div>`).join('');

        return `<div style="
            background:${c.bg};
            border:1px solid ${c.border};
            border-radius:10px;
            padding:10px 14px;
            margin-bottom:12px;
        ">
            <div style="font-weight:600;font-size:15px;color:${c.text};margin-bottom:4px;">
                ${c.icon} Seguridad del sitio
            </div>
            <div style="color:${c.text};opacity:0.9;">${reasonsHTML}</div>
        </div>`;
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
        <div class="simplexa-safety"></div>
        <div class="simplexa-loading">
          <div class="simplexa-spinner"></div>
          <p class="simplexa-loading-text">Analizando la página...</p>
          <div class="simplexa-progress-bar">
            <div class="simplexa-progress-fill"></div>
          </div>
        </div>
        <div class="simplexa-chat-area" style="display: none;"></div>
      </div>
      <div class="simplexa-chat-input-area" style="display: none;">
        <input type="text" class="simplexa-chat-input" placeholder="Preguntame sobre esta página..." />
        <button class="simplexa-chat-send" aria-label="Enviar pregunta">➤</button>
      </div>
      <div class="simplexa-footer">
        <span>🔒 Todo se procesa en tu dispositivo</span>
      </div>
    `;
        shadowRoot.appendChild(container);

        // Analizar y mostrar seguridad del sitio inmediatamente
        const safety = analyzeSiteSafety();
        const safetyContainer = shadowRoot.querySelector('.simplexa-safety');
        if (safetyContainer) {
            safetyContainer.innerHTML = buildSafetyBanner(safety);
        }

        // Evento de cierre
        const closeBtn = shadowRoot.querySelector('.simplexa-close');
        closeBtn.addEventListener('click', () => {
            deactivate();
            chrome.runtime.sendMessage({ type: 'DEACTIVATE_TAB' });
        });

        // Eventos del chat
        const chatInput = shadowRoot.querySelector('.simplexa-chat-input');
        const chatSendBtn = shadowRoot.querySelector('.simplexa-chat-send');

        chatSendBtn.addEventListener('click', () => handleChatSubmit());
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSubmit();
            }
        });

        document.documentElement.appendChild(overlayRoot);
    }

    /**
     * Muestra el resumen de la página en el chat area.
     * @param {string} summary - Resumen generado por la IA
     */
    function showSummary(summary) {
        if (!shadowRoot) return;

        const loading = shadowRoot.querySelector('.simplexa-loading');
        const chatArea = shadowRoot.querySelector('.simplexa-chat-area');
        const chatInputArea = shadowRoot.querySelector('.simplexa-chat-input-area');

        if (loading) loading.style.display = 'none';
        if (chatArea) {
            chatArea.style.display = 'block';
            addChatMessage('assistant', summary);
        }
        if (chatInputArea) {
            chatInputArea.style.display = 'flex';
            // Focus en el input
            const input = shadowRoot.querySelector('.simplexa-chat-input');
            if (input) setTimeout(() => input.focus(), 100);
        }
    }

    /**
     * Agrega un mensaje al área de chat.
     * @param {'user'|'assistant'} role - Quién envió el mensaje
     * @param {string} text - Contenido del mensaje
     */
    function addChatMessage(role, text) {
        if (!shadowRoot) return;
        const chatArea = shadowRoot.querySelector('.simplexa-chat-area');
        if (!chatArea) return;

        const msg = document.createElement('div');
        msg.className = `simplexa-msg simplexa-msg-${role}`;

        const avatar = role === 'assistant' ? '✦' : '👤';
        const formattedText = formatMessageText(text);

        msg.innerHTML = `
            <span class="simplexa-msg-avatar">${avatar}</span>
            <div class="simplexa-msg-bubble">${formattedText}</div>
        `;
        chatArea.appendChild(msg);

        // Scroll al último mensaje
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    /**
     * Muestra un indicador de "escribiendo..." en el chat.
     */
    function showTypingIndicator() {
        if (!shadowRoot) return;
        const chatArea = shadowRoot.querySelector('.simplexa-chat-area');
        if (!chatArea) return;

        const typing = document.createElement('div');
        typing.className = 'simplexa-msg simplexa-msg-assistant simplexa-typing';
        typing.innerHTML = `
            <span class="simplexa-msg-avatar">✦</span>
            <div class="simplexa-msg-bubble"><span class="simplexa-dots">Pensando<span>.</span><span>.</span><span>.</span></span></div>
        `;
        chatArea.appendChild(typing);
        chatArea.scrollTop = chatArea.scrollHeight;
    }

    /**
     * Remueve el indicador de "escribiendo...".
     */
    function removeTypingIndicator() {
        if (!shadowRoot) return;
        const typing = shadowRoot.querySelector('.simplexa-typing');
        if (typing) typing.remove();
    }

    /**
     * Maneja el envío de un mensaje del usuario.
     */
    async function handleChatSubmit() {
        if (!shadowRoot) return;

        const input = shadowRoot.querySelector('.simplexa-chat-input');
        const sendBtn = shadowRoot.querySelector('.simplexa-chat-send');
        if (!input) return;

        const question = input.value.trim();
        if (!question) return;

        // Mostrar pregunta del usuario
        addChatMessage('user', question);
        input.value = '';
        input.disabled = true;
        sendBtn.disabled = true;

        // Mostrar indicador de carga
        showTypingIndicator();

        try {
            // Enviar pregunta al offscreen via background
            const result = await chrome.runtime.sendMessage({
                type: 'REQUEST_CHAT',
                question
            });

            removeTypingIndicator();

            if (result?.ok) {
                addChatMessage('assistant', result.reply);
            } else {
                addChatMessage('assistant', result?.error || 'No pude procesar tu pregunta.');
            }
        } catch (err) {
            removeTypingIndicator();
            addChatMessage('assistant', 'Perdón, no pude procesar tu pregunta. Intentá de nuevo.');
        }

        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
    }

    /**
     * Formatea texto de mensaje: convierte saltos de línea, emojis, y listas.
     */
    function formatMessageText(text) {
        return text
            .split('\n')
            .map(line => {
                const trimmed = line.trim();
                if (!trimmed) return '';
                // Líneas que empiezan con emoji o bullet
                if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(trimmed)) {
                    return `<div class="simplexa-msg-item">${trimmed}</div>`;
                }
                if (/^[-•*]\s/.test(trimmed)) {
                    return `<div class="simplexa-msg-item">• ${trimmed.slice(2)}</div>`;
                }
                if (/^\d+[.)\s]/.test(trimmed)) {
                    return `<div class="simplexa-msg-item">${trimmed}</div>`;
                }
                return `<p style="margin:4px 0;">${trimmed}</p>`;
            })
            .join('');
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
     * Aplica las etiquetas simplificadas directamente sobre los elementos de la página.
     * Agrega badges visuales junto a cada elemento para guiar al usuario.
     * @param {object} labelsMap - Mapa {elementId: "etiqueta"}
     */
    function applyLabelsToPage(labelsMap) {
        for (const [id, label] of Object.entries(labelsMap)) {
            const node = elementMap.get(id);
            if (!node) continue;

            // No modificar el contenido de campos sensibles
            if (node.getAttribute('data-simplexa-sensitive') === 'true') continue;

            // Crear badge visual junto al elemento
            const badge = document.createElement('span');
            badge.className = 'simplexa-label-badge';
            badge.setAttribute('data-simplexa-badge', id);
            badge.textContent = `✦ ${label}`;
            badge.style.cssText = `
                display: inline-block;
                background: linear-gradient(135deg, #3b82f6, #6366f1);
                color: white;
                font-size: 14px;
                font-weight: 600;
                padding: 4px 10px;
                border-radius: 8px;
                margin: 2px 4px;
                box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
                font-family: system-ui, -apple-system, sans-serif;
                z-index: 2147483646;
                position: relative;
                line-height: 1.4;
                pointer-events: none;
            `;

            // Resaltar el elemento original
            node.style.outline = '2px solid #60a5fa';
            node.style.outlineOffset = '2px';
            node.style.borderRadius = node.style.borderRadius || '4px';

            // Insertar badge después del elemento
            if (node.parentNode) {
                node.parentNode.insertBefore(badge, node.nextSibling);
            }
        }
    }

    /**
     * Remueve todos los badges y resaltados de la página.
     */
    function removeLabelsFromPage() {
        // Quitar badges
        document.querySelectorAll('[data-simplexa-badge]').forEach(b => b.remove());
        // Quitar resaltados
        elementMap.forEach((node) => {
            node.style.outline = '';
            node.style.outlineOffset = '';
            node.removeAttribute('data-simplexa-id');
        });
        elementMap.clear();
    }

    /**
     * Escapa HTML para prevenir XSS en el panel.
     */
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Elimina el overlay y los badges de la página.
     */
    function removeOverlay() {
        removeLabelsFromPage();
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

            // 3. Enviar al background → offscreen para anlizar
            updateProgress(0.2, 'Preparando la inteligencia artificial...');

            const result = await chrome.runtime.sendMessage({
                type: 'REQUEST_ANALYZE',
                elements: schema.elements,
                pageTitle: schema.page.title,
                pageUrl: schema.page.url
            });

            if (!result?.ok) {
                throw new Error(result?.error || 'Error en el análisis');
            }

            console.log('[Simplexa] Análisis generado.');

            // 4. Mostrar resumen y habilitar chat
            showSummary(result.summary);

        } catch (error) {
            console.error('[Simplexa] Error:', error);

            let errorMsg = 'No se pudo simplificar la página.';
            if (error.message?.includes('WebGPU')) {
                errorMsg = 'Tu navegador no soporta WebGPU. Necesitas Chrome 113 o superior con una GPU compatible.';
            } else if (error.message?.includes('model')) {
                errorMsg = 'Error al cargar el modelo de IA. Verificá tu conexión a internet para la primera descarga.';
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

            // Recibir progreso del offscreen via background
            case 'AI_PROGRESS_UPDATE':
                if (message.payload) {
                    const progressText = message.payload.text || 'Cargando modelo de IA...';
                    const progressValue = 0.2 + (message.payload.progress || 0) * 0.6;
                    updateProgress(progressValue, progressText);
                }
                sendResponse({ ok: true });
                break;
        }
        return true;
    });

    console.log('[Simplexa] Content script cargado.');
})();
