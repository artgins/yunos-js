/***********************************************************************
 *          en.js
 *
 *          English translations.
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
const en = {
    name: "English",

    translation: {
        /* free-text UI labels (called via t() in c_yuneta_gui.js) */
        "cause":                              "Cause",
        "user":                               "User",
        "url":                                "URL",
        "remote service":                     "Remote service",
        "connection to backend refused":      "Connection to backend refused",
        "no yuneta backend url available":    "No Yuneta backend URL available",
        "no registered url for remote service": "No registered URL for this remote service",

        /* auth_bff error codes — wire IDs, see c_auth_bff.c */
        "invalid_credentials":                "Invalid username or password",
        "session_expired":                    "Your session has expired. Please log in again.",
        "account_disabled":                   "Account disabled or not fully configured. Please contact the administrator.",
        "auth_rate_limited":                  "Too many login attempts. Please wait a moment and try again.",
        "auth_service_unavailable":           "Authentication service unavailable. Please try again later.",
        "auth_config_error":                  "Could not log in. Please try again later or contact the administrator.",
        "auth_unexpected_error":              "Could not log in. If the problem persists, please contact the administrator.",
        "auth_empty_response":                "Could not log in. Please try again later.",
        "auth_timeout":                       "Could not log in. Please try again later.",
        "network_error":                      "Network error. Please check your connection and try again.",
        "refresh_denied":                     "Your session has expired. Please log in again.",
        "server_busy":                        "The server is busy. Please try again in a moment.",

        /* keep this last so adding new keys above never hits the comma trap */
        "sign in":                            "Sign in",
        "username":                           "Username",
        "password":                           "Password",
        "show password":                      "Show password",
        "hide password":                      "Hide password",
        "toggle theme":                       "Toggle theme",
        "username and password are required": "Username and password are required",
        "login welcome title":                "Browse your TreeDB graphs",
        "login welcome lead":                 "Explore topics as tables and nodes as graphs across every configured backend — one console for all your treedbs.",
        "login feature topics":               "Topics as editable tables",
        "login feature graphs":               "Nodes & links as graphs",
        "login feature multibackend":         "Multiple backends at once",

        /* account menu + About dialog */
        "developer":                          "Developer",
        "logout":                             "Sign Out",
        "about":                              "About",
        "treedb console":                     "TreeDB Console",
        "about description":                  "Browse your TreeDB topics as tables and nodes as graphs across every configured backend.",
        "documentation":                      "Documentation",

        /* app chrome — nav, connection picker, settings (added 2026-07-10) */
        "topics": "Topics",
        "graphs": "Graphs",
        "settings": "Settings",
        "connections": "Connections",
        "add connection": "Add connection",
        "manage connections": "Manage connections",
        "no connections yet": "No connections yet",
        "no connections - click add connection": "No connections — click Add connection",
        "connections help": "Edit cells inline. Each URL is a yuno's public wss endpoint (plus its role and service). Connect with the plug button — services are discovered on the first connect; check the ones to browse.",
        "backend not connected": "Backend not connected",

        /* service discovery + tranger records browser (added 2026-07-11) */
        "no services selected": "No services selected — pick them in Settings",
        "disconnected - connect in settings": "Disconnected — connect it in Settings",
        "connect": "Connect",
        "disconnect": "Disconnect",
        "refresh services": "Refresh the yuno services",
        "refreshing services": "Refreshing services…",
        "scan failed": "Discovery failed",
        "scan timeout": "Discovery timeout",
        "connection closed": "Connection closed",
        "services failed": "services failed",
        "browse this service": "Browse this service",
        "refresh": "Refresh",
        "load more": "Load more",
        "no records": "No records",
        "records": "records",
        "last": "last",
        "key": "key",
        "search records": "Search…",
        "search in the loaded records": "Search in the loaded records",
        "clear search": "Clear search",
        "filter": "filter",
        "page": "page",
        "previous page": "Previous page",
        "next page": "Next page",
        "filter keys": "Filter keys…",
        "filter the loaded keys": "Filter the loaded keys",
        "no keys": "No keys",
        "loading": "Loading…",
        "keys": "Keys",
        "rows": "Rows",
        "live": "Live",
        "actions": "Actions",
        "views": "views",
        "close": "Close",
        "realtime coming soon": "Realtime — coming soon",
        "open a key view": "Open a key view from Keys",
        "clear": "Clear",
        "waiting for records": "Waiting for records…",
        "from time": "From time",
        "to time": "To time",
        "from rowid": "From rowid",
        "to rowid": "To rowid",
        "user-flag mask set": "User-flag mask (set)",
        "user-flag mask clear": "User-flag mask (clear)",
        "open rows": "Open Rows",
        "leave blank for the full key": "Leave blank for the full key",
        "filters loaded rows": "filters loaded rows",
        "column filters apply to the loaded rows only": "Column filters apply to the loaded rows only",
        "1-based; negative = from end": "1-based; negative = from end",
        "0 = last": "0 = last",
        "user_flag bits": "user_flag bits",
        "no topics": "No topics",
        "connecting": "Connecting…",
        "connected": "Connected",
        "disconnected": "Disconnected",
        "remove": "Remove",
        "cancel": "Cancel",
        "confirm": "Confirm",
        "treedbs": "TreeDBs",   /* workspace picker heading */
        "role": "Role",
        "service": "Service",
        "from": "From",
        "to": "To",
        "select dates please": "Select dates please",
        "login failed": "Login failed",

        "yes": "Yes",
        "no": "No",
        "accept": "Accept",
        "are you sure": "Are you sure?",
        "please select some row": "Please select some row",

        "_xxx":                               "last key — insert new ones above"
    }
};

export {en};
