# ☁️ NUBE Offline

Una página web que funciona como **nube personal 100% offline**: guarda cualquier tipo de archivo en tu navegador, sin servidores, sin pérdida de datos y sin necesidad de conexión a internet.

## Características

- 📁 **Cualquier tipo de archivo**: imágenes, videos, audio, PDF, ZIP, código, ejecutables, lo que sea.
- 🔒 **Sin pérdida de datos**: los archivos se guardan como `Blob` (binario crudo) byte por byte.
- 🌐 **100% offline**: nada sale de tu dispositivo. No hay backend.
- 💾 **Mucha capacidad**: usa IndexedDB, soportando cientos de MB a varios GB (según el navegador y el espacio disponible).
- 🖼️ **Previsualizaciones** integradas para imágenes, video, audio, PDF y texto/código.
- 🔍 **Búsqueda y orden** por nombre, fecha o tamaño.
- 🔄 **Vista cuadrícula o lista**.
- ⬇ **Descarga individual** o exportación masiva.
- 🌓 **Modo claro/oscuro automático** según las preferencias del sistema.

## Cómo se usa

No requiere instalación ni servidor.

1. Abre `index.html` en tu navegador (doble clic, o sirviéndolo con cualquier servidor estático).
2. Arrastra archivos a la zona de subida o usa el botón **Seleccionar archivos**.
3. Tus archivos quedan guardados en el almacenamiento del navegador (IndexedDB) y permanecen ahí incluso si cierras la pestaña o reinicias el equipo.

> Para garantizar que el navegador no borre los datos en caso de poco espacio, la app solicita automáticamente almacenamiento **persistente** (`navigator.storage.persist`).

## ¿Por qué IndexedDB y no localStorage?

| | localStorage | IndexedDB |
|---|---|---|
| Tipo de datos | Solo texto (strings) | Cualquier dato, incluyendo `Blob` y `File` |
| Tamaño máximo | ~5–10 MB | Cientos de MB a varios GB |
| Pérdida en binarios | Sí (hay que codificar a base64 → +33% tamaño y latencia) | No (binario crudo) |
| API | Síncrona | Asíncrona (no bloquea la UI) |

Por eso esta app usa **IndexedDB**: es la única forma del navegador de guardar archivos arbitrarios sin pérdida y a gran escala.

## Estructura

```
NUBE/
├── index.html   # Estructura de la app
├── styles.css   # Estilos (modo claro/oscuro)
└── app.js       # Lógica IndexedDB + UI
```

## Notas

- Los archivos se guardan **por origen y por navegador**. Si abres la página desde una URL distinta, no verás los mismos archivos.
- El navegador puede borrar los datos en modo incógnito o si elimina el caché del sitio.
- Para mayor seguridad, también puedes exportar los archivos con el botón **Exportar todo** y respaldarlos donde prefieras.
