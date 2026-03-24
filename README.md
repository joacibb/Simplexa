# ✦ Simplexa

**Accesibilidad inteligente para la web — IA local, privacidad total.**

Simplexa es una extensión para navegadores Chromium que analiza cualquier página web y la explica en lenguaje simple, pensada especialmente para adultos mayores o personas con dificultades para navegar interfaces complejas. Toda la inteligencia artificial corre **directamente en el dispositivo del usuario**, sin enviar ningún dato a servidores externos.

---

## Tabla de contenidos

- [¿Qué hace Simplexa?](#qué-hace-simplexa)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
  - [Desde código fuente (desarrollo)](#desde-código-fuente-desarrollo)
  - [Instalación en el navegador](#instalación-en-el-navegador)
- [Uso](#uso)
- [Cómo funciona internamente](#cómo-funciona-internamente)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Configuración y scripts](#configuración-y-scripts)
- [Privacidad y seguridad](#privacidad-y-seguridad)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Licencia](#licencia)

---

## ¿Qué hace Simplexa?

Al activar la extensión en cualquier página web, Simplexa:

1. **Escanea el DOM** de la página e identifica los elementos interactivos relevantes (botones, formularios, enlaces, títulos, campos de texto, etc.).
2. **Genera una explicación** en español claro y accesible: qué es la página, para qué sirve y cuáles son las acciones principales que el usuario puede realizar.
3. **Habilita un chat interactivo** donde el usuario puede hacer preguntas adicionales sobre la página en lenguaje natural.
4. **Advierte sobre riesgos** como formularios que piden datos de tarjeta de crédito o posibles sitios de phishing.

Todo esto ocurre **sin conexión a internet adicional** una vez que el modelo está descargado, y **sin enviar ningún dato** al exterior.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                    Navegador                        │
│                                                     │
│  ┌──────────┐    ┌────────────────┐    ┌─────────┐  │
│  │  Popup   │◄──►│   Background   │◄──►│Offscreen│  │
│  │ (UI)     │    │ Service Worker │    │Document │  │
│  └──────────┘    └───────┬────────┘    └────┬────┘  │
│                          │                  │        │
│                  ┌───────▼────────┐    ┌────▼────┐  │
│                  │ Content Script │    │ WebLLM  │  │
│                  │ (DOM Scanner + │    │ (WASM + │  │
│                  │  Overlay UI)   │    │ WebGPU) │  │
│                  └────────────────┘    └─────────┘  │
└─────────────────────────────────────────────────────┘
```

| Componente | Rol |
|---|---|
| **Popup** | Interfaz del usuario: botón de activación, estado del modelo y barra de progreso de descarga. |
| **Background Service Worker** | Orquestador central. Gestiona el estado de las pestañas activas y actúa como relay de mensajes entre todos los componentes. |
| **Content Script** | Escanea el DOM de la página activa, filtra elementos relevantes, e inyecta el overlay de la interfaz simplificada usando Shadow DOM. |
| **Offscreen Document** | Contexto aislado con permisos `wasm-unsafe-eval` donde se ejecuta el modelo LLM mediante WebGPU/WebAssembly, sin estar sujeto a las restricciones CSP de las páginas visitadas. |
| **AI Manager** | Clase que encapsula la inicialización, la descarga, el análisis de página y el chat interactivo usando `@mlc-ai/web-llm`. |

**Modelo utilizado:** `Llama-3.2-1B-Instruct-q4f16_1-MLC`
- Tamaño aproximado: ~600 MB (descarga única, queda cacheado en el navegador).
- Motor de inferencia: [WebLLM](https://github.com/mlc-ai/web-llm) con aceleración WebGPU.
- Costo de uso: **$0** — no requiere API keys ni suscripciones.

---

## Requisitos

### Para usar la extensión

| Requisito | Detalle |
|---|---|
| Navegador | Google Chrome 113+ o cualquier navegador basado en Chromium (Edge, Brave, Arc, etc.) |
| WebGPU | El navegador debe tener WebGPU habilitado (activado por defecto en Chrome 113+) |
| RAM | Mínimo 4 GB disponibles (recomendado 8 GB) |
| Almacenamiento | ~700 MB libres para el modelo (se descarga una sola vez) |
| GPU | Compatible con WebGPU. Funciona con GPU integrada, aunque una GPU dedicada mejora el rendimiento |
| Conexión | Solo requerida la primera vez, para descargar el modelo (~600 MB) |

### Para desarrollo

| Requisito | Versión |
|---|---|
| Node.js | 18+ |
| npm | 9+ |

---

## Instalación

### Desde código fuente (desarrollo)

**1. Clonar el repositorio**

```bash
git clone https://github.com/joacibb/Simplexa.git
cd Simplexa
```

**2. Instalar dependencias**

```bash
npm install
```

Esto instala las devDependencies del proyecto:
- `@mlc-ai/web-llm` — motor de inferencia LLM en el navegador.
- `esbuild` — bundler ultrarrápido para generar el bundle del AI Manager.

**3. Generar el bundle de la IA**

```bash
npm run build
```

Este comando ejecuta `esbuild` y genera el archivo `lib/ai_manager.bundle.js`, que es el AI Manager con todas sus dependencias incluidas, listo para ser cargado en el Offscreen Document de la extensión.

> **Importante:** Este paso es obligatorio. Sin el bundle, la extensión no puede cargar ni ejecutar el modelo de IA.

---

### Instalación en el navegador

Una vez generado el bundle (o si ya está presente en `lib/`):

1. Abrí Google Chrome y navegá a `chrome://extensions/`.
2. Activá el **Modo de desarrollador** (switch en la esquina superior derecha).
3. Hacé click en **"Cargar extensión sin empaquetar"**.
4. Seleccioná la carpeta raíz del proyecto (`Simplexa-main/`).
5. La extensión aparecerá en la lista y su ícono (`✦`) estará visible en la barra de herramientas.

> Para versiones de producción distribuidas como `.crx`, el proceso de instalación es diferente y requiere publicación en la Chrome Web Store o configuración de políticas empresariales.

---

## Uso

### Primera vez

1. Navegá a cualquier página web.
2. Hacé click en el ícono de **Simplexa** (`✦`) en la barra de herramientas.
3. El popup mostrará el estado del modelo como **"Modelo no cargado"**.
4. Hacé click en **"Simplificar esta página"**.
5. En la primera ejecución, la extensión descargará el modelo (~600 MB). El progreso se muestra en tiempo real en el popup.

> La descarga es única. En usos posteriores, el modelo se carga directamente desde la caché del navegador en segundos.

### Uso normal

1. Abrí cualquier página web que quieras entender mejor.
2. Hacé click en el ícono de **Simplexa**.
3. Hacé click en **"Simplificar esta página"**.
4. En pocos segundos, aparecerá un panel superpuesto sobre la página con:
   - Un **resumen claro** de qué es la página y para qué sirve.
   - Una **lista de acciones principales** explicadas con íconos y lenguaje simple.
   - Advertencias si la página solicita datos sensibles.
5. Podés usar el **chat integrado** para hacer preguntas sobre la página. Por ejemplo: *"¿Cómo busco una receta?"* o *"¿Qué significa este botón?"*

### Desactivar

Para volver a la vista normal de la página, abrí el popup y hacé click en **"Desactivar Simplexa"**.

---

## Cómo funciona internamente

### Flujo de análisis de una página

```
Usuario hace click en "Simplificar"
        │
        ▼
Popup envía mensaje ACTIVATE_TAB al Background
        │
        ▼
Background inyecta content.js en la pestaña activa
        │
        ▼
Content Script escanea el DOM:
  - Encuentra hasta 80 elementos visibles e interactivos
  - Filtra campos sensibles (contraseñas, tarjetas de crédito)
  - Genera un esquema JSON compacto de la página
        │
        ▼
Content Script envía REQUEST_ANALYZE al Background
        │
        ▼
Background crea (si no existe) el Offscreen Document
  y reenvía los datos al AI Manager
        │
        ▼
AI Manager (WebLLM):
  1. Carga el modelo desde caché (o lo descarga)
  2. Filtra los elementos más relevantes (máx. 30)
  3. Construye el prompt del sistema + prompt de usuario
  4. Ejecuta la inferencia con Llama 3.2 1B
  5. Devuelve el resumen generado
        │
        ▼
Content Script inyecta el overlay con el resumen
  sobre la página, usando Shadow DOM
```

### Seguridad y filtrado de datos

Antes de enviar cualquier dato al modelo, el Content Script aplica los siguientes filtros:

- **Campos de contraseña y tarjetas de crédito:** se detectan por `type`, `name` y atributo `autocomplete`, y se excluyen completamente del esquema enviado a la IA.
- **Elementos ocultos:** solo se procesan elementos visibles en pantalla (`offsetParent !== null`, `visibility !== hidden`).
- **Deduplicación:** se eliminan elementos con texto repetido para no saturar el contexto del modelo.
- **Límite de elementos:** se envían como máximo 30 elementos al modelo, priorizando títulos, botones y campos de formulario.

### Chat interactivo

El chat mantiene un historial de conversación (hasta 12 mensajes) que incluye el contexto del análisis inicial de la página. Esto permite hacer preguntas de seguimiento sin necesidad de re-analizar la página. El historial se resetea al analizar una nueva página.

---

## Estructura del proyecto

```
Simplexa-main/
├── manifest.json           # Configuración de la extensión (Manifest V3)
├── background.js           # Service Worker: orquestador de mensajes y estado
├── content.js              # Content Script: escáner DOM + overlay UI (Shadow DOM)
├── offscreen.html          # HTML mínimo del Offscreen Document
├── offscreen.js            # Script del Offscreen Document: relay al AI Manager
├── ai_manager.js           # Clase AIManager: lógica de carga, análisis y chat
├── package.json            # Dependencias y scripts de build
├── package-lock.json       # Lockfile de npm
├── lib/
│   └── ai_manager.bundle.js  # Bundle generado por esbuild (no editar manualmente)
├── popup/
│   ├── popup.html          # Interfaz del popup
│   ├── popup.js            # Lógica del popup: estado del modelo, botones
│   └── popup.css           # Estilos del popup
├── styles/
│   └── overlay.css         # Estilos del overlay inyectado en la página
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Configuración y scripts

### Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run build` | Genera `lib/ai_manager.bundle.js` usando esbuild. Ejecutar después de cualquier cambio en `ai_manager.js`. |
| `npm test` | Sin configurar (placeholder). |

### Ajustes de configuración

Al instalar la extensión por primera vez, se guardan en `chrome.storage.local` los siguientes valores por defecto:

```json
{
  "simplexa_settings": {
    "modelId": "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    "fontSize": "large",
    "highContrast": true
  }
}
```

Para cambiar el modelo, modificá la constante `DEFAULT_MODEL_ID` en `ai_manager.js` por cualquier modelo compatible con WebLLM y regenerá el bundle.

---

## Privacidad y seguridad

- **Sin telemetría:** Simplexa no recopila, registra ni transmite ningún dato de uso ni de navegación.
- **Sin API keys:** No se comunica con ningún servicio externo de IA. La inferencia ocurre completamente en el dispositivo del usuario.
- **Datos sensibles protegidos:** Los campos de contraseña y datos de tarjeta de crédito se detectan y excluyen antes de ser procesados por el modelo.
- **Permisos mínimos:** La extensión solicita únicamente `activeTab`, `storage`, `scripting` y `offscreen` — los permisos estrictamente necesarios para su funcionamiento.

---

## Limitaciones conocidas

- **Requiere WebGPU:** Navegadores sin soporte WebGPU (Firefox, Safari sin flag, Chrome en algunos sistemas Linux con GPU antigua) no podrán ejecutar el modelo. En ese caso, la extensión mostrará un error al intentar cargar.
- **Primera carga lenta:** La descarga inicial del modelo (~600 MB) puede demorar varios minutos dependiendo de la velocidad de conexión.
- **Páginas con CSP muy estrictos:** Algunas páginas que bloquean la inyección de scripts pueden impedir que el overlay se muestre. La IA igual puede analizar la página, pero la UI visual puede no aparecer correctamente.
- **Modelo pequeño:** Se utiliza Llama 3.2 1B para maximizar la compatibilidad y velocidad. Para páginas muy complejas, las respuestas pueden ser menos precisas que con modelos más grandes.
- **Idioma:** Los prompts del sistema están optimizados para español. El análisis de páginas en otros idiomas puede ser menos preciso.

---

## Licencia

MIT — libre para usar, modificar y distribuir sin restricciones.

---

> Desarrollado con 💙 — IA local, accesibilidad real.
