/**
 * Simplexa — AI Manager
 * Clase encargada de la descarga, carga y ejecución del modelo LLM
 * usando @mlc-ai/web-llm con WebGPU. Costo $0, 100% local.
 */

// Importar WebLLM desde paquete local (bundleado con esbuild)
import * as webllm from '@mlc-ai/web-llm';

// Modelo ligero recomendado (~600MB primera descarga)
const DEFAULT_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export class AIManager {
    constructor() {
        this.engine = null;
        this.modelId = DEFAULT_MODEL_ID;
        this.isReady = false;
        this._onProgress = null;
        // Historial de conversación por página (para chat interactivo)
        this._conversationHistory = [];
        this._pageContext = null;
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
     * WebLLM cachea los archivos internamente en Cache API.
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.isReady && this.engine) {
            console.log('[Simplexa] Modelo ya cargado, reutilizando.');
            return;
        }

        try {
            this._reportStatus('downloading', 0);
            let isFirstChunk = true;

            const initProgressCallback = (report) => {
                const progress = report.progress || 0;
                const text = report.text || '';
                const isFromCache = text.includes('Loading') || text.includes('loading') || text.includes('cache');
                const displayText = isFromCache || (!isFirstChunk && progress > 0.5)
                    ? 'Cargando modelo desde caché...'
                    : 'Descargando modelo de IA...';

                isFirstChunk = false;
                this._reportStatus('downloading', progress);
                if (this._onProgress) {
                    this._onProgress({ ...report, text: displayText, progress });
                }
            };

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
     * Analiza la página y genera un resumen comprensible + acciones clave.
     * @param {Array} domElements - Elementos escaneados del DOM
     * @param {string} pageTitle - Título de la página
     * @param {string} pageUrl - URL de la página
     * @returns {Promise<string>} Resumen en texto plano para el usuario
     */
    async analyzePage(domElements, pageTitle, pageUrl) {
        if (!this.isReady || !this.engine) {
            throw new Error('El modelo no está inicializado.');
        }

        // Guardar contexto para el chat posterior
        this._pageContext = { domElements, pageTitle, pageUrl };

        const systemPrompt = this._buildAnalysisSystemPrompt();
        const userPrompt = this._buildAnalysisUserPrompt(domElements, pageTitle, pageUrl);

        // Iniciar conversación limpia
        this._conversationHistory = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        try {
            const response = await this.engine.chat.completions.create({
                messages: this._conversationHistory,
                max_tokens: 600,
                temperature: 0.4,
                top_p: 0.9
            });

            const reply = response.choices[0]?.message?.content || 'No pude analizar esta página.';

            // Guardar respuesta en historial
            this._conversationHistory.push({ role: 'assistant', content: reply });

            return reply;
        } catch (error) {
            console.error('[Simplexa] Error analizando página:', error);
            throw error;
        }
    }

    /**
     * Responde una pregunta del usuario sobre la página actual.
     * Mantiene el contexto de la conversación.
     * @param {string} question - Pregunta del usuario
     * @returns {Promise<string>} Respuesta de la IA
     */
    async chat(question) {
        if (!this.isReady || !this.engine) {
            throw new Error('El modelo no está inicializado.');
        }

        // Agregar pregunta al historial
        this._conversationHistory.push({ role: 'user', content: question });

        // Limitar historial a últimos 10 mensajes (+ system) para no saturar contexto
        const maxHistory = 12;
        if (this._conversationHistory.length > maxHistory) {
            const systemMsg = this._conversationHistory[0];
            this._conversationHistory = [
                systemMsg,
                ...this._conversationHistory.slice(-maxHistory + 1)
            ];
        }

        try {
            const response = await this.engine.chat.completions.create({
                messages: this._conversationHistory,
                max_tokens: 400,
                temperature: 0.5,
                top_p: 0.9
            });

            const reply = response.choices[0]?.message?.content || 'No pude entender la pregunta. ¿Podés reformularla?';

            // Guardar respuesta
            this._conversationHistory.push({ role: 'assistant', content: reply });

            return reply;
        } catch (error) {
            console.error('[Simplexa] Error en chat:', error);
            return 'Hubo un error procesando tu pregunta. Intentá de nuevo.';
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
            this._conversationHistory = [];
            this._pageContext = null;
            this._reportStatus('idle', 0);
        }
    }

    // ── Prompts ────────────────────────────────────────────────────────────

    /**
     * Prompt de sistema para análisis de página.
     * Se enfoca en ENTENDER y EXPLICAR, no en repetir texto.
     */
    _buildAnalysisSystemPrompt() {
        return `Sos Simplexa, un asistente amable que ayuda a personas mayores a entender páginas web.

TU TRABAJO:
- Explicar QUÉ es esta página y PARA QUÉ sirve, en 1-2 oraciones simples.
- Listar las 3-5 acciones más importantes que el usuario puede hacer, explicadas como si hablaras con tu abuela.
- Si hay formularios, explicar qué datos piden y para qué.
- Si hay peligros (sitios de compra, datos de tarjeta), avisar con cuidado.

REGLAS:
1. Hablá en español sencillo, con vos/voseo si es natural.
2. NO repitas el texto de la página literalmente. Explicá con tus palabras.
3. Usá frases cortas. Máximo 2 líneas por punto.
4. Empezá siempre con "📄 Esta página..." para el resumen.
5. Listá las acciones con emojis descriptivos (🔍 para buscar, 📝 para escribir, 🛒 para comprar, etc).
6. Si hay campos de contraseña o datos de tarjeta, mencioná que son privados y seguros.
7. Terminá con una frase invitando a preguntar: "¿Tenés alguna duda? Preguntame lo que quieras."
8. Si el usuario hace preguntas de seguimiento, respondé basándote en lo que sabés de la página.
9. NO inventes información que no esté en los elementos de la página.
10. Respondé como si fueras un familiar paciente, no como un robot.`;
    }

    /**
     * Prompt del usuario con los elementos filtrados de la página.
     */
    _buildAnalysisUserPrompt(domElements, pageTitle, pageUrl) {
        // Filtrar solo los elementos más relevantes para el análisis
        const filtered = this._filterRelevantElements(domElements);
        const schemaStr = JSON.stringify(filtered, null, 0);

        return `Estoy en esta página web y necesito que me expliques qué es y qué puedo hacer.

Página: "${pageTitle}"
URL: ${pageUrl}

Elementos encontrados:
${schemaStr}

Explicame esta página de forma simple. ¿Qué es? ¿Qué puedo hacer acá?`;
    }

    /**
     * Filtra y prioriza elementos relevantes para el análisis.
     * Descarta elementos decorativos, repetidos o poco informativos.
     */
    _filterRelevantElements(elements) {
        const seen = new Set();
        return elements.filter(el => {
            // Descartar elementos sin texto útil
            if (!el.text && !el.placeholder && !el.links) return false;

            // Descartar duplicados por texto
            const key = (el.text || el.placeholder || '').toLowerCase().trim();
            if (key && key.length < 2) return false;
            if (seen.has(key)) return false;
            seen.add(key);

            // Priorizar: títulos, botones, campos, links principales
            return true;
        }).slice(0, 30); // Máximo 30 elementos filtrados
    }

    // ── Utilidades internas ────────────────────────────────────────────────

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
