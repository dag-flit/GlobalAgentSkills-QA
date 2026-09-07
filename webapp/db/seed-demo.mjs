// seed-demo.mjs — Carga datos de DEMO del Seguimiento QA en el proyecto (tenant) de un usuario REAL de
// este sistema, para VER los módulos poblados sin borrar nada. Idempotente: ids fijos + ON CONFLICT DO
// NOTHING (re-correrlo no duplica). Respeta la RLS: fija app.current_tenant antes de insertar.
//
// Uso (desde webapp/):  node --env-file=.env.local db/seed-demo.mjs <tu-email>
//   El email es OBLIGATORIO y debe ser un usuario de ESTE sistema. Sin argumento, lista los usuarios y
//   proyectos existentes y sale (no inventa nada). Siembra en el primer proyecto NO archivado del usuario.
import pgmod from "pg";

const PG = pgmod.default ?? pgmod;
const EMAIL = process.argv[2];

function itemsFor(email) {
  return [
    { id: "demo-1", title: "Login falla con contraseña vencida", notes: "Al ingresar con clave expirada muestra pantalla en blanco.", status: "doing", priority: "alta", type: "bug", severity: "critica", labels: ["login", "seguridad"], due: "current_date - 2", assignee: email },
    { id: "demo-2", title: "Validar exportación a Excel del reporte", notes: "Confirmar que las columnas salen separadas (separador ;).", status: "review", priority: "media", type: "test", severity: "", labels: ["reportes"], due: "current_date + 3", assignee: email },
    { id: "demo-3", title: "Mejorar tiempos de carga del tablero", notes: "", status: "todo", priority: "baja", type: "improvement", severity: "", labels: ["performance"], due: "NULL", assignee: "" },
    { id: "demo-4", title: "Caso de prueba: alta de usuario", notes: "Flujo feliz + validaciones de campos.", status: "done", priority: "media", type: "test", severity: "", labels: ["usuarios"], due: "NULL", assignee: email },
    { id: "demo-5", title: "Bug: la fecha límite no se guarda", notes: "Al editar, due_date vuelve vacío.", status: "blocked", priority: "alta", type: "bug", severity: "mayor", labels: ["fechas"], due: "current_date - 1", assignee: "" },
    { id: "demo-6", title: "Documentar criterios de aceptación HU-10618", notes: "", status: "todo", priority: "media", type: "task", severity: "", labels: ["ado", "docs"], due: "current_date + 7", assignee: "", ado: "10618" },
  ];
}

async function main() {
  const url = process.env.CONTROL_PLANE_URL;
  if (!url) { console.error("✗ Falta CONTROL_PLANE_URL (usa: node --env-file=.env.local db/seed-demo.mjs <tu-email>)"); process.exit(2); }
  const client = new PG.Client({ connectionString: url });
  await client.connect();
  try {
    if (!EMAIL) {
      const rows = (await client.query(
        "SELECT u.email, tn.name AS proyecto, tn.archived_at IS NOT NULL AS terminado " +
        "FROM memberships m JOIN users u ON u.id = m.user_id JOIN tenants tn ON tn.id = m.tenant_id ORDER BY u.email, tn.name",
      )).rows;
      console.log("Falta tu email. Usuarios y proyectos de ESTE sistema:\n");
      if (!rows.length) console.log("  (no hay usuarios/proyectos todavía — creá uno en /register o /projects)");
      for (const r of rows) console.log(`  ${r.email}  →  ${r.proyecto}${r.terminado ? " (terminado)" : ""}`);
      console.log("\nCorré:  node --env-file=.env.local db/seed-demo.mjs <tu-email>");
      process.exit(1);
    }

    const t = await client.query(
      "SELECT m.tenant_id, tn.name FROM memberships m JOIN users u ON u.id = m.user_id JOIN tenants tn ON tn.id = m.tenant_id " +
      "WHERE lower(u.email) = lower($1) AND tn.archived_at IS NULL ORDER BY tn.name LIMIT 1",
      [EMAIL],
    );
    if (!t.rows[0]) { console.error(`✗ No encontré un proyecto activo para «${EMAIL}» en este sistema. Corré el script sin argumento para ver la lista.`); process.exit(1); }
    const tenantId = t.rows[0].tenant_id;
    console.log(`▶ Sembrando demo en el proyecto «${t.rows[0].name}» (${tenantId}) para ${EMAIL}…`);

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]); // RLS

    const ITEMS = itemsFor(EMAIL);
    let pos = 0;
    for (const it of ITEMS) {
      await client.query(
        `INSERT INTO qa_items(id, title, notes, status, priority, type, severity, labels, due_date, reporter, assignee, ado_wi, position)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb, ${it.due}, $9, $10, $11, $12)
         ON CONFLICT (tenant_id, id) DO NOTHING`,
        [it.id, it.title, it.notes, it.status, it.priority, it.type, it.severity, JSON.stringify(it.labels), EMAIL, it.assignee, it.ado ?? "", pos++],
      );
    }

    const comments = [
      ["demo-c1", "demo-1", EMAIL, "Reproducido en DEV. Pasa solo con clave vencida."],
      ["demo-c2", "demo-1", EMAIL, "Adjunté evidencia en la HU. Queda para el dev."],
    ];
    for (const [id, item, author, body] of comments) {
      await client.query(
        "INSERT INTO qa_item_comments(id, item_id, author, body) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id, id) DO NOTHING",
        [id, item, author, body],
      );
    }
    const activity = [
      ["demo-a1", "demo-1", EMAIL, "created", "{}"],
      ["demo-a2", "demo-1", EMAIL, "field", JSON.stringify({ field: "estado", from: "todo", to: "doing" })],
    ];
    for (const [id, item, actor, action, detail] of activity) {
      await client.query(
        "INSERT INTO qa_item_activity(id, item_id, actor, action, detail) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT (tenant_id, id) DO NOTHING",
        [id, item, actor, action, detail],
      );
    }
    await client.query(
      "INSERT INTO qa_notifications(id, recipient, item_id, kind, text) VALUES($1,$2,$3,$4,$5) ON CONFLICT (tenant_id, id) DO NOTHING",
      ["demo-n1", EMAIL, "demo-1", "assigned", "Te asignaron «Login falla con contraseña vencida»"],
    );

    await client.query("COMMIT");
    console.log(`✓ Demo cargada: ${ITEMS.length} pendientes, ${comments.length} comentarios, ${activity.length} actividades, 1 notificación.`);
    console.log("  Abrí /seguimiento (tablero + tabla + métricas + export) y mirá la campana arriba.");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("✗ Falló el seed:", e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
