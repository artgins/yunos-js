/***********************************************************************
 *          es.js
 *
 *          Traducciones al español.
 *
 *          Convention (all locale files share these rules):
 *            1. Keys are lower-case ASCII English.
 *            2. Values are sentence-case in their target language —
 *               a missing translation falls through to the lower-case
 *               key, making the gap visible to the user at a glance.
 *            3. Every locale file must carry the *same* key set; see
 *               scripts/validate-locales.mjs.
 *
 *          Two key shapes coexist on purpose:
 *            - Free-text UI keys use spaces ("connection to backend
 *              refused").
 *            - Backend protocol IDs (auth_bff error_code values, see
 *              kernel/c/root-linux/src/c_auth_bff.c) keep their
 *              snake_case form so they match the wire format
 *              one-to-one.  Both forms are still ASCII lower-case.
 *
 *          Copyright (c) 2025, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
const es = {
    name: "Español",

    translation: {
        /* etiquetas de UI (llamadas vía t() en c_yuneta_gui.js) */
        "cause":                              "Motivo",
        "user":                               "Usuario",
        "url":                                "URL",
        "remote service":                     "Servicio remoto",
        "connection to backend refused":      "Conexión al backend rechazada",
        "no yuneta backend url available":    "No hay URL de Yuneta backend disponible",
        "no registered url for remote service": "No hay URL registrada para este servicio remoto",

        /* códigos auth_bff — IDs de protocolo, ver c_auth_bff.c */
        "invalid_credentials":                "Usuario o contraseña incorrectos",
        "session_expired":                    "Su sesión ha caducado. Por favor, inicie sesión de nuevo.",
        "account_disabled":                   "Cuenta deshabilitada o no configurada. Contacte con el administrador.",
        "auth_rate_limited":                  "Demasiados intentos. Espere un momento e inténtelo de nuevo.",
        "auth_service_unavailable":           "Servicio de autenticación no disponible. Inténtelo más tarde.",
        "auth_config_error":                  "No se pudo iniciar sesión. Inténtelo más tarde o contacte con el administrador.",
        "auth_unexpected_error":              "No se pudo iniciar sesión. Si el problema persiste, contacte con el administrador.",
        "auth_empty_response":                "No se pudo iniciar sesión. Inténtelo más tarde.",
        "auth_timeout":                       "No se pudo iniciar sesión. Inténtelo más tarde.",
        "network_error":                      "Error de red. Compruebe la conexión e inténtelo de nuevo.",
        "refresh_denied":                     "Su sesión ha caducado. Por favor, inicie sesión de nuevo.",
        "server_busy":                        "El servidor está ocupado. Inténtelo en un momento.",

        /* mantener al final — insertar nuevas claves antes */
        "sign in":                            "Iniciar sesión",
        "username":                           "Usuario",
        "password":                           "Contraseña",
        "show password":                      "Mostrar contraseña",
        "hide password":                      "Ocultar contraseña",
        "toggle theme":                       "Cambiar tema",
        "username and password are required": "Usuario y contraseña son obligatorios",
        "login welcome title":                "Explora tus grafos TreeDB",
        "login welcome lead":                 "Explora topics como tablas y nodos como grafos en cada backend configurado — una sola consola para todos tus treedbs.",
        "login feature topics":               "Topics como tablas editables",
        "login feature graphs":               "Nodos y enlaces como grafos",
        "login feature multibackend":         "Varios backends a la vez",

        /* account menu + About dialog */
        "developer":                          "Desarrollador",
        "logout":                             "Cerrar sesión",
        "about":                              "Acerca de",
        "treedb console":                     "Consola TreeDB",
        "about description":                  "Explora tus topics TreeDB como tablas y nodos como grafos en cada backend configurado.",
        "documentation":                      "Documentación",

        /* app chrome — nav, connection picker, settings (added 2026-07-10) */
        "topics": "Temas",
        "graphs": "Grafos",
        "settings": "Ajustes",
        "connections": "Conexiones",
        "add connection": "Añadir conexión",
        "manage connections": "Gestionar conexiones",
        "no connections yet": "Aún no hay conexiones",
        "no connections - click add connection": "Sin conexiones — pulsa Añadir conexión",
        "connections help": "Edita las celdas en línea. Cada URL es el endpoint público wss de un yuno (más su rol y servicio). Conecta con el botón del enchufe — los servicios se descubren en la primera conexión; marca los que quieras explorar.",
        "backend not connected": "Backend no conectado",

        /* service discovery + tranger records browser (added 2026-07-11) */
        "no services selected": "No hay servicios seleccionados — márcalos en Ajustes",
        "disconnected - connect in settings": "Desconectada — conéctala en Ajustes",
        "connect": "Conectar",
        "disconnect": "Desconectar",
        "refresh services": "Refrescar los servicios del yuno",
        "refreshing services": "Refrescando servicios…",
        "scan failed": "Descubrimiento fallido",
        "scan timeout": "Descubrimiento agotado (timeout)",
        "connection closed": "Conexión cerrada",
        "services failed": "services falló",
        "browse this service": "Explorar este servicio",
        "refresh": "Refrescar",
        "load more": "Cargar más",
        "no records": "Sin registros",
        "records": "registros",
        "last": "últimos",
        "key": "clave",
        "search records": "Buscar…",
        "search in the loaded records": "Buscar en los registros cargados",
        "clear search": "Limpiar búsqueda",
        "filter": "filtro",
        "page": "página",
        "previous page": "Página anterior",
        "next page": "Página siguiente",
        "filter keys": "Filtrar claves…",
        "filter the loaded keys": "Filtrar las claves cargadas",
        "no keys": "Sin claves",
        "loading": "Cargando…",
        "keys": "Claves",
        "rows": "Filas",
        "live": "En vivo",
        "actions": "Acciones",
        "views": "vistas",
        "close": "Cerrar",
        "realtime coming soon": "Tiempo real — próximamente",
        "open a key view": "Abre una vista de clave desde Claves",
        "clear": "Limpiar",
        "waiting for records": "Esperando registros…",
        "no topics": "Sin topics",
        "connecting": "Conectando…",
        "connected": "Conectado",
        "disconnected": "Desconectado",
        "remove": "Eliminar",
        "cancel": "Cancelar",
        "confirm": "Confirmar",
        "treedbs": "TreeDBs",   /* workspace picker heading */
        "role": "Rol",
        "service": "Servicio",
        "from": "Desde",
        "to": "Hasta",
        "select dates please": "Selecciona fechas por favor",
        "login failed": "Error de inicio de sesión",

        "yes": "Sí",
        "no": "No",
        "accept": "Aceptar",
        "are you sure": "¿Está seguro?",
        "please select some row": "Seleccione alguna fila",

        "_xxx":                               "last key — insert new ones above"
    }
};

export {es};
