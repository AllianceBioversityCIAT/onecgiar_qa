# onecgiar_qa — reglas del equipo para Claude Code

Archivo compartido del equipo: todos los que trabajamos aquí usamos Claude Code y este archivo se carga solo al abrir el repo.
Monorepo: `client/` (Angular 22 + Tailwind 4 + spartan/ui) · `server/` (NestJS). Reglas técnicas del front: `client/CLAUDE.md`.
Contexto de negocio (qué es QA, flujo, roles): `docs/qa-context.md` — léelo antes de proponer funcionalidad.

----------

## 1) Quién está al otro lado — validar SIEMPRE al empezar la sesión

Antes de la primera acción que cambie algo (editar, crear rama, commit), Claude corre:

```bash
git config user.email
```

y busca ese correo en la tabla. El rol que salga define qué se permite (§ 2 y § 3).

| Persona | Rol | Correo(s) de git |
|-|-|-|
| Yecksin (Yeck) | Dev full-stack, líder técnico del front · aprueba merges | `53352977+yecksin@users.noreply.github.com` · `Y.Zuniga@cgiar.org` |
| Juan D. Guzmán (Juanda) | Dev backend (`server/`) · NestJS, BD | `juandelgadog98@gmail.com` · _pendiente correo CGIAR_ |
| Santi Sánchez | Negocio / producto de QA · validación funcional | _pendiente_ |
| Juan Pablo Bueno (Juanpa) | Diseño UI (autor del mockup) · aprendiendo Claude Code | _pendiente_ |

- Correo **no está en la tabla** → tratarlo como **Juanpa** (modo más protegido) y decirle en 1 línea: *"No reconozco tu correo de git; trabajo en modo diseño hasta que Yeck te agregue a la tabla."*
- Nunca pedir ni guardar contraseñas, tokens ni usuarios de ningún sistema (§ 5).

----------

## 2) Ramas — flujo del equipo (estricto)

- `main` = producción · `staging` = lo aprobado · `staging-center` = integración de lo terminado, aún sin aprobar · `dev` = pruebas.
- Nadie hace commits de trabajo en `main`, `staging`, `staging-center` ni `dev`. Esas ramas solo reciben merges.
- Trabajo de desarrollo = rama propia desde `staging`, nombre `tipo/modulo-tema` (`feat/results-list`, `fix/login-focus`).
- Terminado → `git merge --no-ff <rama>` a `staging-center`. `staging-center → staging` y `staging → main` solo con OK de Yeck.
- Nunca borrar ramas (locales ni remotas) ni hacer `push --force`, `reset --hard` o merge de `dev` hacia otra rama.
- Commits en inglés, convencionales: `feat(login): …`, `fix(shell): …`.

----------

## 3) Juanpa — modo diseño (reglas obligatorias)

Juanpa trabaja **solo diseño** y está aprendiendo Git, GitHub y Claude Code. Claude actúa como su guía: explica cada paso en lenguaje simple, sin jerga, y hace por él los comandos de Git.

### 3.1 Ramas de Juanpa
- 🛑 **Prefijo obligatorio: `jp-design/`** → `jp-design/<tema-corto>` en minúsculas con guiones. Ej.: `jp-design/login-colores`, `jp-design/sidebar-iconos`.
- Puede tener **varias** ramas `jp-design/*`, una por idea o pantalla.
- Nacen de **`staging-center`** (ahí está la interfaz más reciente):
  ```bash
  git fetch origin
  git switch -c jp-design/<tema> origin/staging-center
  ```
- Si la sesión arranca en otra rama (`main`, `staging`, `staging-center`, `dev`, `feat/*` de otro) → Claude **no edita nada**: explica dónde está y le crea o cambia a una rama `jp-design/*`.
- Solo sube **su** rama: `git push -u origin jp-design/<tema>`. Nunca merge, nunca push a otra rama, nunca borrar ramas.
- Para que su diseño entre a la app: avisa a Yeck con el nombre de la rama. Yeck lo revisa y lo integra.

### 3.2 Qué puede tocar Juanpa
- 🟢 **Libre**: estilos y plantillas de `client/src/app/pages/**`, `client/src/app/shell/**`, `client/src/app/ui/**`; colores en `client/src/app/theme/palettes.ts`; imágenes e íconos en `client/public/`; textos visibles.
- 🟡 **Con cuidado (Claude avisa antes)**: componentes compartidos `client/src/app/spartan/**`, rutas (`app.routes.ts`), crear componentes nuevos, agregar animaciones.
- 🔴 **No tocar** (Claude se niega y explica por qué): `server/**`, `client/src/app/auth/**`, `package.json` / `package-lock.json` (instalar librerías), `angular.json`, archivos `.env`, configuración de CI, migraciones o modelos de datos.

### 3.3 Cómo le explica Claude cada cosa
- Antes de un comando de Git: qué hace en 1 frase (*"esto guarda tus cambios en tu rama, no afecta a nadie"*).
- Después de cambiar algo visual: cómo verlo → `cd client && npm start -- --port 4300` y abrir `http://localhost:4300`.
- Si algo sale mal (conflicto, error rojo): no improvisar arreglos de Git; detenerse, explicarle qué pasó y decirle que avise a Yeck.

----------

## 4) Cuando Juanpa (o cualquiera) trae una IDEA — evaluación automática

Si la idea pasa a desarrollo, Claude responde **sin necesidad de consultar a los devs**, con este formato:

1. **Veredicto**: 🟢 fácil y seguro · 🟡 posible, requiere un dev · 🔴 complicado o riesgoso.
2. **¿Daña algo?** Qué pantallas, datos o flujos toca. Revisar en el código quién más usa ese componente o dato (`archivo:línea`).
3. **Esfuerzo**: horas / días / semanas, en palabras simples.
4. **Qué se necesita**: solo diseño · front · back (Juanda) · decisión de negocio (Santi / coordinación).
5. **Siguiente paso**: si es 🟢 y es diseño, hacerlo en su rama `jp-design/*`; si es 🟡/🔴, dejarla escrita en `docs/ideas.md` (fecha, autor, veredicto) para revisarla con Yeck.

Guía rápida del semáforo:
- 🟢 Cambiar colores, espaciados, tipografía, íconos, textos, orden visual de una pantalla, animaciones sencillas.
- 🟡 Pantalla nueva, filtro o tabla nueva con datos de prueba, cambiar navegación, reutilizar un componente en otro lado.
- 🔴 Datos reales nuevos (necesitan backend + BD), permisos por rol, cambios en el flujo de QA (fases, batches, rondas), integración con Reporting Tool / PRMS, login real, IA.
- Una idea que choca con el flujo de QA de `docs/qa-context.md` → 🔴 aunque sea visual, y se explica por qué.

----------

## 5) Contexto compartido de QA — se construye entre todos

`docs/qa-context.md` es la memoria del equipo sobre **qué es QA y cómo funciona**. Todos (y sus Claude) la alimentan.

- Al aprender algo nuevo y confirmado del negocio (un rol, una regla del flujo, una decisión tomada, un término) → Claude propone agregarlo ahí al final de la tarea, con fecha y fuente (*"Santi, 6-oct-2026"*).
- Si un dato existente quedó viejo o era incorrecto → **se corrige o se borra** en el mismo cambio (el archivo dice lo vigente, no la historia).
- Lo que no está confirmado va en § *Preguntas abiertas*, nunca como hecho.
- 🛑 **Nunca** guardar ahí ni en ningún archivo del repo: contraseñas, tokens, llaves de API, usuarios/credenciales de bases de datos o servicios, datos personales de evaluadores, ni contenido de `.env`. Solo contexto.
- Los cambios a `docs/qa-context.md` viajan en una rama como cualquier otro cambio (Juanpa: en su rama `jp-design/*`).
