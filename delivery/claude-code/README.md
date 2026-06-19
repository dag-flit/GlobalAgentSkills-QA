# delivery/claude-code — empaque para Claude Code (generado)

No se edita a mano: se **genera** desde `core/` con `runtime/delivery/build.mjs`.

```bash
node runtime/delivery/build.mjs dist -t claude-code
```

Produce `dist/claude-code/` con: `skills/<name>/SKILL.md` y `agents/<name>.md` (frontmatter
estándar, copiados de `core/`), `CLAUDE.md` índice, `bin/qa.mjs` y el motor compartido.
Mismo contenido que `core/`, distinto contenedor.
