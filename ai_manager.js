/**
 * Simplexa — AI Manager
 * Clase encargada de la descarga, carga y ejecución del modelo LLM
 * usando @mlc-ai/web-llm con WebGPU. Costo $0, 100% local.
 */

// Importar WebLLM desde CDN (compatible con service worker y content script)
import * as webllm from 'https://esm.run/@mlc-ai/web-llm';

// Modelo ligero recomendado (~600MB primera descarga)
const DEFAULT_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export class AIManager {
    constructor() {
        this.engine = null;
        this.modelId = DEFAULT_MODEL_ID;
        this.isReady = false;
        this._onProgress = null;
    }

    /**
     * Callback de progreso de descarga del modelo.
     * @param {function} callback - (progress: {text, progress}) => void
     */
    onProgress(callback) {
        this._onProgress = callback;
    }

    /**
     * Inicializa el motor WebLLM y descarga/carga el modelo.
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            this._reportStatus('downloading', 0);

            const initProgressCallback = (report) => {
                const progress = report.progress || 0;
                this._reportStatus('downloading', progress);
                if (this._onProgress) {
                    this._onProgress(report);
                }
            };

            // Crear el motor MLC con el modelo seleccionado
            this.engine = await webllm.CreateMLCEngine(this.modelId, {
                initProgressCallback,
                logLevel: 'SILENT'
            });

            this.isReady = true;
            this._reportStatus('ready', 1);
            console.log('[Simplexa] Modelo cargado correctamente:', this.modelId);
        } catch (error) {
            this.isReady = false;
            this._reportStatus('error', 0, error.message);
            console.error('[Simplexa] Error cargando modelo:', error);
            throw error;
        }
    }

    /**
     * Genera instrucciones simplificadas a partir del esquema DOM de la página.
     * @param {object} domSchema - Esquema JSON compacto del DOM
     * @param {string} pageTitle - Título de la página
     * @param {string} pageUrl - URL de la página
     * @returns {Promise<string>} Instrucciones simplificadas en texto
     */
    async simplifyPage(domSchema, pageTitle, pageUrl) {
        if (!this.isReady || !this.engine) {
            throw new Error('El modelo no está inicializado. Llama a initialize() primero.');
        }

        const systemPrompt = this._buildSystemPrompt();
        const userPrompt = this._buildUserPrompt(domSchema, pageTitle, pageUrl);

        try {
            const response = await this.engine.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 512,
                temperature: 0.3, // Baja temperatura para respuestas consistentes
                top_p: 0.9
            });

            return response.choices[0]?.message?.content || 'No se pudieron generar instrucciones.';
        } catch (error) {
            console.error('[Simplexa] Error generando simplificación:', error);
            throw error;
        }
    }

    /**
     * Libera los recursos del modelo.
     */
    async destroy() {
        if (this.engine) {
            await this.engine.unload();
            this.engine = null;
            this.isReady = false;
            this._reportStatus('idle', 0);
            console.log('[Simplexa] Modelo descargado.');
        }
    }

    // ── Prompts ────────────────────────────────────────────────────────────

    /**
     * Construye el prompt de sistema para la IA.
     */
    _buildSystemPrompt() {
        return `Eres un asistente de accesibilidad web llamado Simplexa. Tu trabajo es ayudar a adultos mayores a entender y usar páginas web.

REGLAS ESTRICTAS:
1. Responde SIEMPRE en español claro y sencillo.
2. Usa frases cortas y directas.
3. Numera cada paso empezando por 1.
4. Describe la ubicación visual de los elementos (arriba, abajo, centro, izquierda, derecha).
5. Usa verbos imperativos: "Haga clic en...", "Escriba su...", "Busque el botón...".
6. Si ves "[DATO SENSIBLE]" NO menciones ni describas ese campo. Solo di: "Hay un campo protegido para información privada."
7. Máximo 8 pasos por página.
8. Agrupa acciones relacionadas.
9. Ignora elementos decorativos o de publicidad.
10. Si la página es un formulario, explica qué información pide y dónde enviarla.`;
    }

    /**
     * Construye el prompt de usuario con el esquema DOM.
     */
    _buildUserPrompt(domSchema, pageTitle, pageUrl) {
        const schemaStr = JSON.stringify(domSchema, null, 0); // Compacto
        return `Página: "${pageTitle}"
URL: ${pageUrl}

Elementos encontrados en la página:
${schemaStr}

Genera instrucciones paso a paso, claras y sencillas, para que un adulto mayor pueda entender y usar esta página. Enfócate en las acciones principales que puede realizar.`;
    }

    // ── Utilidades internas ────────────────────────────────────────────────

    /**
     * Reporta el estado del modelo al background script.
     */
    _reportStatus(status, progress, error = null) {
        try {
            chrome.runtime.sendMessage({
                type: 'SET_MODEL_STATUS',
                payload: { status, progress, error }
            });
        } catch {
            // Puede fallar si no hay listener activo
        }
    }
}

// Singleton para uso global
export const aiManager = new AIManager();
