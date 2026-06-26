// Nombre de la cookie de sesión, en un módulo SIN dependencias de Node (pg/next/headers)
// para que el middleware (Edge runtime) pueda importarlo sin arrastrar el cliente de BD.
export const SESSION_COOKIE = "qof_session";
