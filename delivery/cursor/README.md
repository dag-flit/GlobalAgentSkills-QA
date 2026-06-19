# delivery/cursor — empaque para Cursor (generado)

No se edita a mano: se **genera** desde `core/` con `runtime/delivery/build.mjs`.

```bash
node runtime/delivery/build.mjs dist -t cursor
```

Produce `dist/cursor/` con `.cursor/{skills,agents}/<name>.mdc` (frontmatter → regla `.mdc`
con `alwaysApply: false`, NO global en el kit genérico), `install.ps1` y el motor compartido.
El **contenido** no se edita aquí; se transforma desde `core/`.
