# ☁️ NUBE Offline

Tu **nube personal 100% offline**, instalable como app en Android, iOS, Windows, macOS y Linux. Guarda cualquier tipo de archivo en tu propio dispositivo, cifrado con tu contraseña. Sin servidores, sin pérdida.

---

## ✨ Qué incluye

- 📁 **Cualquier tipo de archivo** (imágenes, video, audio, PDF, ZIP, código, ejecutables…)
- 🔒 **Cifrado AES-256-GCM** con contraseña (Web Crypto + PBKDF2 200k iteraciones)
- 📲 **PWA instalable** en Android, iOS, Windows, macOS y Linux
- 🌐 **100% offline** después de la primera carga (Service Worker)
- 💾 **Almacenamiento masivo** (IndexedDB: cientos de MB a varios GB)
- 🔍 Búsqueda, orden, vista cuadrícula/lista
- 🖼️ Previsualización integrada (imágenes, video, audio, PDF, texto/código)
- 🔄 Auto-deploy a GitHub Pages

---

## 🚀 Cómo usarla (paso a paso)

### Paso 1 — Activa GitHub Pages (una sola vez)

Ya hay un workflow configurado que la despliega automáticamente. Solo tienes que activar Pages:

1. Entra a tu repo: https://github.com/7sspd/NUBE
2. **Settings → Pages**
3. En "Source" elige **GitHub Actions**
4. Espera 1–2 minutos. Tu URL será:

   ```
   https://7sspd.github.io/NUBE/
   ```

> Cada vez que hagas push a `main`, GitHub re-desplegará la app automáticamente.

### Paso 2 — Instálala en tu dispositivo

#### 📱 Android (Chrome / Edge / Brave / Samsung Internet)

1. Abre `https://7sspd.github.io/NUBE/` en Chrome.
2. Toca el menú **⋮** → **"Instalar app"** o **"Añadir a pantalla de inicio"**.
3. Aparecerá como app nativa, con su icono propio y pantalla completa.

> En cuanto entres por primera vez, también verás un botón **"📲 Instalar app"** en la cabecera.

#### 🍎 iPhone / iPad (Safari)

1. Abre `https://7sspd.github.io/NUBE/` en **Safari** (no funciona desde Chrome iOS).
2. Toca el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Baja y elige **"Añadir a pantalla de inicio"**.
4. Toca **"Añadir"**. La app aparece en tu pantalla de inicio como una app nativa, sin barra del navegador.

> ⚠️ **Aviso iOS**: Safari puede borrar el almacenamiento de un sitio si no lo abres durante **7 días**. La app pide almacenamiento persistente automáticamente (mitigando el problema), pero te recomiendo entrar a la app cada cierto tiempo o exportar respaldos.

#### 💻 Windows / macOS / Linux (Chrome / Edge)

1. Abre `https://7sspd.github.io/NUBE/`.
2. En la barra de direcciones aparece un icono **"Instalar"** (⊕). Pulsa.
3. La app se abre en su propia ventana, separada del navegador.

### Paso 3 — Configura la app la primera vez

Al abrir verás dos opciones:

- **🔒 Con contraseña (recomendado)** — todos tus archivos se cifran con AES-256. Sin la contraseña nadie puede abrirlos, ni siquiera tú.
- **🔓 Sin contraseña** — acceso directo sin cifrado.

Si eliges contraseña, la app la pedirá cada vez que la abras. Puedes pulsar **🔒 Bloquear** en cualquier momento.

> ⚠️ **Si olvidas la contraseña, no hay forma de recuperar los archivos**. Eso es lo que la hace segura. Anótala donde la guardes a salvo.

---

## 📖 Guía rápida

| Quiero… | Cómo |
|---|---|
| Subir archivos | Arrastra a la zona azul, o pulsa "Seleccionar archivos" |
| Ver un archivo | Pulsa en la tarjeta |
| Descargar | Botón ⬇ de la tarjeta o desde la previsualización |
| Borrar uno | Botón 🗑 de la tarjeta |
| Buscar | Barra de búsqueda |
| Cambiar orden | Menú "Más recientes / Nombre / Tamaño" |
| Vista | Botones ▦ (cuadrícula) o ☰ (lista) |
| Bajar todo | Botón "⬇ Exportar" |
| Vaciar la nube | Botón "🗑 Borrar todo" |
| Bloquear | Botón "🔒 Bloquear" (solo modo cifrado) |

---

## 🛡️ Seguridad y privacidad

- **Tus archivos nunca salen del dispositivo.** No hay servidor que reciba nada.
- **Cifrado AES-256-GCM** con clave derivada por PBKDF2 (200 000 iteraciones SHA-256).
- **La contraseña no se guarda.** Solo se almacena un "verificador" cifrado para validar que la contraseña sea correcta al desbloquear.
- **Cada archivo tiene su propio IV aleatorio** (vector de inicialización), garantizando que cifrar dos veces el mismo contenido produce resultados distintos.
- **Lo que se cifra**: nombre + contenido. **Lo que NO se cifra**: tamaño, tipo MIME y fecha (necesarios para ordenar/filtrar sin descifrar todo).

---

## 🤔 Preguntas frecuentes

**¿Puedo usar la misma nube en mi PC y mi móvil?**
No, cada navegador/dispositivo tiene su propio IndexedDB. Es una nube *local* sin sincronización. Si quieres compartir entre dispositivos, exporta y vuelve a importar manualmente.

**¿Por qué IndexedDB y no localStorage?**
| | localStorage | IndexedDB |
|---|---|---|
| Tipos de datos | Solo texto | Cualquier cosa, incluyendo Blob |
| Pérdida en binarios | Sí (hay que codificar a base64) | No |
| Tamaño máximo | ~5–10 MB | Cientos de MB / GB |

**¿El cifrado funciona offline?**
Sí. La Web Crypto API es nativa del navegador, no requiere internet.

**¿Cómo cambio la contraseña?**
Por ahora se hace exportando todos los archivos, luego "Borrar todo" + reset de la nube, y volver a configurar. (Mejora futura: botón directo).

**¿Qué pasa si el navegador borra los datos?**
La app pide almacenamiento **persistente** automáticamente, lo que reduce mucho la probabilidad. Aun así, recomiendo exportar respaldos periódicos con el botón "⬇ Exportar".

---

## 🛠️ Estructura

```
NUBE/
├── index.html              # Estructura de la app (lock/setup/main)
├── styles.css              # Estilos (claro/oscuro automático, responsive)
├── app.js                  # Lógica: IndexedDB + AES-GCM + PWA
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service Worker (cache offline del app shell)
├── icons/                  # Iconos PNG generados (192, 512, maskable, apple)
├── scripts/make_icons.py   # Generador de iconos (solo dev, no se usa en runtime)
└── .github/workflows/pages.yml  # Auto-deploy a GitHub Pages
```

---

## 🧪 Uso local (sin GitHub Pages)

Como la app usa Service Workers + Web Crypto, **no funciona abriendo `index.html` con doble clic en navegadores modernos**. Necesitas servirla por HTTP. Lo más fácil:

```bash
# Python (cualquiera)
cd NUBE
python3 -m http.server 8000
# luego abre http://localhost:8000
```

```bash
# Node
npx serve NUBE
```

Localhost cuenta como "contexto seguro", así que el cifrado y el SW funcionan.
