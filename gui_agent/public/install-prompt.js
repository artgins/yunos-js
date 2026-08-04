/***********************************************************************
 *          install-prompt.js
 *
 *  Catch the install offer before the bundle exists.
 *
 *  Chrome fires `beforeinstallprompt` very early — usually before the
 *  module graph has loaded — and an event nobody caught cannot be asked
 *  for back. So it is caught here, its default banner refused, and the
 *  event stashed for @yuneta/gobj-ui's yui_install.js to use when the
 *  app decides to ask.
 *
 *  Served from public/ and loaded with <script src>, NOT inline: the
 *  page's CSP is `script-src 'self'`, which drops an inline block
 *  without running it and without saying anything.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
(function () {
    "use strict";

    window.__yuneta_install__ = null;

    window.addEventListener("beforeinstallprompt", function (ev) {
        ev.preventDefault();
        window.__yuneta_install__ = ev;
        window.dispatchEvent(new CustomEvent("yuneta:installable"));
    });
})();
