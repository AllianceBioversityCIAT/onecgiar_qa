# Contexto de QA — memoria compartida del equipo

> Lo vigente, no la historia. Cada dato con fuente y fecha. Lo dudoso va a *Preguntas abiertas*.
> 🛑 Sin contraseñas, tokens, usuarios ni datos personales (reglas en `CLAUDE.md` § 5).

## Qué es
- Plataforma nueva de **Quality Assurance (QA)** para los resultados que se reportan en PRMS (Reporting Tool), hecha desde cero en el Q4 2026. *(Yeck, 5-oct-2026)*
- Reemplaza la app de QA actual (`qa.cgiar.org`), que hoy PRMS solo muestra dentro de un iframe, sin intercambio de datos. *(Yeck, 5-oct-2026)*
- Equipo: Yeck (front), Juanda (back), Juanpa (diseño), Santi (negocio de QA). *(Yeck, 6-oct-2026)*

## Flujo de QA (por cada resultado)
1. **Assessor** revisa cada campo: lo aprueba o comenta qué cambiar.
2. **Miembro del programa (SP)** acepta o rechaza cada comentario; si acepta, corrige en Reporting Tool.
3. **Lead assessor** revisa los comentarios rechazados y los marca como *highlighted*.
4. **Third-party broker (TPB)** decide cada campo resaltado.
5. **PPU** aplica en Reporting Tool la corrección acordada.

*(Santi, 30-sep-2026)*

## Roles de la plataforma
- **QA lead / coordinación** — abre y cierra fases, arma batches, asigna assessors.
- **Assessor** · **Lead assessor** · **Third-party broker** · **PPU** — ver flujo arriba.
*(mockup de Juanpa, 5-oct-2026)*

## Lo que pide la coordinación
- Abrir y cerrar fases sin depender del equipo técnico.
- Batches y mini-batches con timelines; cada programa avanza a su ritmo.
- Segunda ronda (round 2) confiable; aporte de IA automático; varios procesos en paralelo.
*(Jira Discovery NOST-451, 5-oct-2026)*

## Pantallas del mockup
Overview · Results (+ detalle por campo con "AI match") · Cycle (fases + batches) · Fields (configuración por tipo de resultado) · Assessors. *(mockup de Juanpa, 5-oct-2026)*

## Glosario
- **Resultado**: lo que un programa reporta en PRMS y pasa por QA.
- **Batch / mini-batch**: grupo de resultados que entra a QA junto.
- **Fase / ciclo**: periodo de QA que la coordinación abre y cierra.
- **Highlighted**: campo en desacuerdo que sube al broker.

## Preguntas abiertas (no asumir respuesta)
- No hay pantalla para el miembro del programa (SP) en el mockup.
- Solo se modela la sincronización Reporting → QA; la vuelta (PPU corrige) falta.
- ¿Un usuario puede tener varios roles? El mockup asume uno.
- ¿Módulo dentro de Reporting Tool o plataforma independiente?
- El "AI match" del mockup no es igual al aporte de IA que existe hoy.
