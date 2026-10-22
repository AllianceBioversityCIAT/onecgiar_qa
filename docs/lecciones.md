
## 2026-10-21 · Reemplazos con `perl -0pi -e 's|…|…|'` que rompen archivos TypeScript
- **Qué pasó (3 veces en una sesión):** `results-view.ts` (dos veces) y `fields-view.ts` quedaron con líneas pegadas o con texto al inicio del archivo, y el build falló con `Unexpected "|"`.
- **Causa raíz:** usé `|` como delimitador de `s|…|…|`, y el código TypeScript tiene `|` (tipos unión `'a' | 'b'`, `||`). En el patrón, un `\|` mal escapado se volvió una alternativa vacía, que coincide en cualquier parte (por ejemplo, al inicio del archivo). En el reemplazo, un `|` sin escapar cerró la expresión antes de tiempo.
- **Cómo evitarlo:** para cambios de varias líneas o con `|`, usar la herramienta Edit (cadena exacta). Si hace falta sed o perl, usar un delimitador que no aparezca en el código (`#` o `~`). Después de un reemplazo masivo, revisar `git diff` antes de compilar.
