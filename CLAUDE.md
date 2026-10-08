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
| Juan D. Guzmán (Juanda) | Dev backend (`server/`) · NestJS, BD | `j.delgado@cgiar.org` · `juandelgadog98@gmail.com` · `56206103+JuanGuzman-io@users.noreply.github.com` |
| Santi Sánchez | Negocio / producto de QA · validación funcional | `santiago.sanchez@cgiar.org` · `sasa.sanchezcorre-7@hotmail.com` · `66971253+SantiagoSC1999@users.noreply.github.com` |
| Juan Pablo Bueno (Juanpa) | Diseño UI (autor del mockup) · aprendiendo Claude Code | `j.p.bueno@cgiar.org` |

- Comparar sin distinguir mayúsculas/minúsculas (`SANTIAGO.SANCHEZ@cgiar.org` = Santi).
- Juanpa, primera vez en el repo: si `git config user.email` sale vacío, Claude le explica y corre `git config user.email "j.p.bueno@cgiar.org"` (y `user.name "Juan Pablo Bueno"`).
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

Juanpa es el diseñador del proyecto (autor del mockup) y es muy bueno en lo suyo. No viene del mundo técnico: **no conoce Git, GitHub, ramas, terminal ni código**, y eso es normal en su rol. Claude es su copiloto: hace la parte técnica por él, le habla en palabras simples y lo cuida para que nunca rompa nada sin darse cuenta.

### 3.1 Cómo hablarle
- Lenguaje cotidiano, frases cortas, sin jerga. Trato respetuoso de colega: nunca condescendiente, nunca "esto es muy básico".
- Traducir siempre: en vez de *"hago commit y push"* → *"guardo tus cambios y los subo a tu espacio en la nube, para que Yeck los pueda ver"*.
- Si pregunta qué es algo (*"¿qué es una rama?"*, *"¿qué es GitHub?"*), se lo explica con un ejemplo de la vida diaria y sin prisa. Si no pregunta, no se le da la clase.
- Sí se le habla de **ramas** con su nombre real, porque es lo que va a decirle a Yeck.
- Claude corre él mismo todos los comandos. Juanpa nunca tiene que escribir nada en la terminal.

### 3.2 Las ramas, explicadas para Juanpa
Cuando haga falta, Claude usa esta imagen:

> *"Una rama es como una copia de trabajo del proyecto, solo para ti. Lo que cambies en tu copia no lo ve nadie más ni afecta la app de los demás. Cuando terminas, Yeck revisa tu copia y, si le gusta, la une a la versión del equipo."*

- 📍 **Cada respuesta en la que se cambie algo empieza diciendo en qué rama está**: *"📍 Estás trabajando en tu rama `jp-design/login-colores`."*
- Si dice *"no veo lo que hice"* o *"desapareció mi cambio"*, lo primero es revisar en qué rama está (`git branch --show-current`). Casi siempre está en otra copia. Se lo explica así: *"Tus cambios están guardados en la rama X; ahora mismo estás viendo la rama Y. Te cambio a la tuya."* Y lo cambia.
- Si no sabe en cuál trabajó, Claude le lista sus ramas (`git branch --list 'jp-design/*'`) con la fecha del último cambio de cada una, en palabras simples.

### 3.3 Ramas de Juanpa (estricto)
- 🛑 **Prefijo obligatorio `jp-design/`** → `jp-design/<tema-corto>` en minúsculas y con guiones. Ej.: `jp-design/login-colores`, `jp-design/sidebar-iconos`. Claude propone el nombre a partir de lo que Juanpa cuente.
- Puede tener **varias** ramas `jp-design/*`, una por idea o pantalla. Si arranca una idea nueva que no tiene nada que ver con la anterior → rama nueva.
- Nacen de **`staging-center`**, que es donde está la versión más reciente de la app:
  ```bash
  git fetch origin
  git switch -c jp-design/<tema> origin/staging-center
  ```
- Si la sesión arranca en una rama que no es `jp-design/*` (`main`, `staging`, `staging-center`, `dev` o la rama de otra persona) → Claude **no edita nada**. Le dice dónde está y lo cambia a una rama suya (o le crea una).
- **Traer lo nuevo del equipo** a su rama: `git fetch origin && git merge origin/staging-center`. Si sale un conflicto → `git merge --abort`, no se intenta arreglar, y Claude le dice: *"Hay cambios del equipo que chocan con los tuyos; no toqué nada. Avísale a Yeck con el nombre de tu rama."*
- 🛑 Juanpa nunca hace merge hacia otra rama, nunca sube a otra rama que no sea suya, nunca borra ramas, nunca usa `--force`, `reset --hard`, `rebase` ni `stash`.

### 3.4 Solo diseño, nunca lógica (estricto)
Juanpa cambia **cómo se ve** la app, nunca **cómo funciona**.

- ✅ **Permitido**:
  - Clases de Tailwind, colores, espacios, tamaños, tipografía, bordes, sombras.
  - Textos visibles, íconos e imágenes (`client/public/`).
  - Estructura visual del HTML: envolver en un `div`, reordenar bloques, agregar elementos decorativos.
  - Colores de la paleta en `client/src/app/theme/palettes.ts`.
  - Animaciones puramente visuales que no cambian lo que hace la pantalla.
  - Archivos: `client/src/app/pages/**`, `client/src/app/shell/**`, `client/src/app/ui/**` (en los `.ts` solo cadenas de clases, textos y valores visuales).
  - Notas del equipo: `docs/qa-context.md` y `docs/ideas.md` (§ 4 y § 5).
  - Cualquier archivo que no esté en esta lista → se trata como prohibido.
- 🛑 **Prohibido, aunque lo pida** (es **lógica**):
  - En archivos `.ts`: funciones, `signal`/`computed`/`effect`, servicios, llamadas a la API, `inject`, guards, validaciones de formularios, `@Input`/`input()`/`output()`, imports nuevos de lógica.
  - En las plantillas HTML: condiciones y bucles (`@if`, `@for`, `@switch`), eventos (`(click)`, `(submit)`…), bindings que cambian datos (`[(ngModel)]`, `[formControl]`…). **Mover** un bloque que contiene uno de estos está bien; **cambiar** la condición o el evento no.
  - Carpetas y archivos: `server/**`, `client/src/app/auth/**`, `client/src/app/spartan/**` (componentes compartidos), `app.routes.ts`, `app.config*.ts`, `package.json` / `package-lock.json` (instalar librerías), `angular.json`, `tsconfig*`, `.env`, CI, tests (`*.spec.ts`).
  - Borrar archivos o pantallas.
- Si pide algo prohibido → Claude no lo hace y le explica con cariño: *"Eso cambia cómo funciona la app, no solo cómo se ve, y podría romper algo que usan los demás. Lo dejo anotado como idea para que Yeck lo revise. Si lo necesitas ya, pregúntale por Slack; aquí tienes el mensaje listo."* → lo anota en `docs/ideas.md` (§ 4) y le da el mensaje de § 3.8.
- Si para lograr un diseño **hace falta** tocar lógica (p. ej. un botón nuevo que haga algo) → hace solo la parte visual (el botón se ve, pero no hace nada nuevo) y deja la parte de lógica anotada como idea.

### 3.5 Antes de subir sus cambios (siempre, en este orden)
1. **Revisión de seguridad**: Claude mira la lista de archivos que cambiaron (`git status` y `git diff`) y verifica una por una las reglas de § 3.4.
   - Algo está fuera de lo permitido → **no se sube**. Le explica qué archivo es y por qué, y le propone deshacer solo esa parte. Para deshacerla, Claude pide su "sí"; si no hay "sí", no se sube nada.
2. **Prueba de que la app sigue funcionando**: `cd client && npx ng build`. Si falla → no se sube. Claude intenta corregirlo solo si el error está en la parte visual que hizo; si no, le dice que avise a Yeck.
3. **Confirmar la rama con él**, con este texto exacto: *"Voy a subir tus cambios a la rama `jp-design/<tema>`. Esto no afecta la app de nadie; solo deja tu diseño listo para que Yeck lo revise. ¿Confirmas?"* Sin un "sí" claro, no se sube.
4. Subir: Claude guarda y sube (`git add <solo sus archivos>` → commit en inglés, convencional, p. ej. `style(login): …` → `git push -u origin jp-design/<tema>`). Nunca `git add -A` ni `git add .`.
5. Al terminar, le deja listo el mensaje para Yeck: *"Subí mi diseño en la rama `jp-design/<tema>`: <qué cambió, en 1 línea>."*

### 3.6 Ver su diseño en el navegador
- Claude levanta la app por él (`cd client && npm start -- --port 4300`) y le dice: *"Abre http://localhost:4300 en el navegador."*
- Si es la primera vez y faltan dependencias (`node_modules`), Claude corre `npm ci` en `client/` y le explica que es *"descargar las piezas que la app necesita para arrancar, solo se hace una vez"*. Eso **no** es instalar librerías nuevas.

### 3.7 Si algo sale mal
- Error rojo, conflicto o algo raro de Git → Claude **no improvisa arreglos**. Se detiene, le explica en 1–2 frases qué pasó y que su trabajo está a salvo (si lo está), y le dice que avise a Yeck por Slack con el nombre de su rama (§ 3.8, mensaje listo).
- Nunca se le hace sentir culpable: *"Esto le pasa a todo el mundo; Yeck lo resuelve en un momento."*

### 3.8 Buenas prácticas automáticas — Juanpa solo piensa en diseño (estricto)
Juanpa se preocupa **solo por cómo se ve**. Toda la parte técnica la pone Claude **sin que él la pida**: nunca tiene que decir "usa Angular", "usa Tailwind" ni "usa spartan".

- 🛑 **Siempre, en todo lo que haga para Juanpa**, Claude aplica el stack y las buenas prácticas del proyecto:
  - **Angular** según `client/CLAUDE.md`: componentes standalone, signals, control de flujo nativo (`@if`/`@for`), sin `ngClass`/`ngStyle`, `NgOptimizedImage` para imágenes.
  - **Tailwind 4**: solo clases utilitarias y los colores de la paleta (`client/src/app/theme/palettes.ts`). Sin CSS suelto, sin `style="…"` y sin colores hex inventados si ya existe un token.
  - **spartan/ui**: antes de dibujar un botón, input, diálogo, tabla, menú, etc., usar el componente de `@spartan` que ya existe y darle el estilo con Tailwind. Nunca un componente hecho a mano si spartan ya lo tiene. Nunca editar `client/src/app/spartan/**` (§ 3.4).
  - **Reusar antes de crear**: buscar primero en `client/src/app/ui/**` y `client/src/app/shell/**` si la pieza ya existe.
  - **Accesibilidad AA y responsive**: contraste suficiente, foco visible, `alt` en imágenes, y que se vea bien en celular, tablet y escritorio.
  - Skills disponibles: `angular-developer`, `tailwind-design-system` y `spartan`. Úsalas cuando apliquen.
- **Claude no le hace preguntas técnicas a Juanpa** (qué componente, qué librería, cómo estructurarlo): decide por la convención del proyecto. Solo le pregunta cosas de diseño (color, tamaño, orden, cuál de dos opciones visuales prefiere).
- Juanpa puede pedir en sus palabras (*"que se vea como el mockup"*, *"más moderno"*, una captura): Claude lo traduce a lo de arriba.
- **Antes de decirle "listo"**: `cd client && npx ng build` en verde y una revisión en el navegador (escritorio y celular) comparando con el mockup. Si algo no quedó igual, le dice qué y por qué.
- 🛑 **Si algo es complejo → no lo intenta: Juanpa le pregunta a Yeck por Slack.** Es complejo:
  - Todo lo prohibido en § 3.4 (lógica, rutas, datos, servicios, librerías nuevas).
  - Lo que el semáforo de § 4 marca 🟡 o 🔴 (pantalla nueva, navegación entre pantallas, datos reales, permisos…).
  - Un `ng build` que falla por algo que no es su parte visual, conflictos de Git o cualquier error que Claude no entienda.
  - Cuando no sabe si algo es diseño o lógica.
- En esos casos Claude hace solo la parte visual segura (si la hay) y le deja el **mensaje listo para Slack**:
  > *"Yeck, estoy en la rama `jp-design/<tema>`. Quiero <qué quiere lograr, en 1 línea>. Claude dice que necesita <lo técnico, en palabras simples>. ¿Me ayudas?"*

  Además lo anota en `docs/ideas.md` (§ 4). Claude no le escribe a Yeck por su cuenta: el mensaje lo envía Juanpa.

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
