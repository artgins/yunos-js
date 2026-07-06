/***********************************************************************
 *          deploy.js
 *
 *      Per-deployment identity of the AUTH plane, derived from the
 *      serving hostname so a single build serves every deployment with
 *      no baked-in host map.
 *
 *      Only the AUTH BFF is co-located with the SPA (same host):
 *          - bff_url : https://<host>:1808   (auth_bff)
 *
 *      The treedb DATA backends are NOT co-located: the user configures
 *      them at runtime (wss URL + remote_yuno_role/service per
 *      connection) in the Settings page, stored in localStorage (see
 *      C_TREEDB_CONFIG). Because those backends live on OTHER hosts, the
 *      BFF httpOnly cookie cannot reach them; instead the SPA obtains the
 *      access_token from the BFF (POST /auth/token, opt-in) and forwards
 *      it in each C_IEVENT_CLI identity_card. See
 *      [[project_gui_treedb_v2_migration]] and YUNO_AUTH.md §2.2.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

const BFF_PORT = 1808;   /* auth_bff for the treedb GUI plane */


/***************************************************************
 *  Resolve the deployment info from window.location.hostname.
 *  { host, tenant, bff_url }
 *
 *  On localhost the Vite dev server proxies /auth/* to the BFF, so the
 *  BFF base is same-origin (""); in production the BFF is reached at
 *  https://<host>:1808.
 ***************************************************************/
function deploy_info()
{
    let host = (typeof window !== "undefined" && window.location && window.location.hostname)
        ? window.location.hostname : "localhost";

    let tenant = (host.split(".")[0]) || "local";
    let is_local = (host === "localhost" || host === "127.0.0.1");

    return {
        host:    host,
        tenant:  tenant,
        bff_url: is_local ? "" : `https://${host}:${BFF_PORT}`
    };
}

export {deploy_info};
