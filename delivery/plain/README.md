# delivery/plain — repo plano + CLI (generado)

No se edita a mano: se **genera** desde `core/` con el empaquetador.

```bash
node runtime/delivery/build.mjs dist            # genera dist/{plain,claude-code,cursor}
node runtime/delivery/build.mjs dist -t plain   # solo este target
```

El paquete `dist/plain/` es autocontenido (motor `core/runtime/adapters/profiles` + CLI):

```bash
node dist/plain/bin/qa.mjs [repoRoot] --work-item <id>
```

Corre `static/unit/e2e/db/security/api` según lo que el repo permita y deja `qa-evidence/`.
