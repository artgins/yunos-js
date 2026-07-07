/***********************************************************************
 *          login.js
 *
 *          Pre-shell login screen for gui_agent (Agent Console) — pure
 *          DOM module. A centered split card: a brand-tinted welcome
 *          panel on the left and the username/password form on the right,
 *          collapsing to form-only below 900px. Theme + language quick
 *          toggles, password reveal, busy state, error banner. Mounted by
 *          C_APP when there is no session, unmounted on EV_LOGIN_ACCEPTED.
 *          Same visual language as wattyzer's login, Agent Console palette.
 *
 *          mount_login({on_submit}) -> { unmount, set_busy, set_error, clear_error }
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {t} from "i18next";

import {current_theme, toggle_theme} from "./theme.js";
import {switch_locale, current_locale} from "./locales/locales.js";
import {deploy_info} from "./conf/deploy.js";
import pkg from "../package.json";

const VERSION = pkg.version || "";


/***************************************************************
 *  Build the login screen and attach it to <body>.
 ***************************************************************/
function mount_login(opts)
{
    let on_submit = (opts && opts.on_submit) || function() {};
    let dep = deploy_info();
    let plane = (dep.plane === "agent22") ? "agent22" : "agents";

    let root = document.createElement("div");
    root.className = "yagent-login";
    root.innerHTML = render_html(dep, plane);
    document.body.appendChild(root);

    paint_i18n(root);
    paint_quick(root);
    let api = wire_form(root, on_submit);
    wire_quick(root);

    setTimeout(function() {
        let u = root.querySelector("input[name=username]");
        if(u) {
            u.focus();
        }
    }, 350);

    return {
        set_error:   api.set_error,
        clear_error: api.clear_error,
        set_busy:    api.set_busy,
        unmount:     function() {
            if(root && root.parentNode) {
                root.parentNode.removeChild(root);
            }
        }
    };
}


                    /***************************
                     *      DOM construction
                     ***************************/


function render_html(dep, plane)
{
    return `
        <div class="ylogin-bg" aria-hidden="true">
            <div class="ylogin-orb ylogin-orb-1"></div>
            <div class="ylogin-orb ylogin-orb-2"></div>
        </div>

        <div class="ylogin-card" role="main">

            <aside class="ylogin-welcome">
                <div class="ylogin-brand">
                    <img class="ylogin-mark" src="/agent-mark.svg" alt="">
                    <span class="ylogin-wordmark">Agent Console</span>
                </div>
                <h1 class="ylogin-welcome-title"
                    data-i18n="login welcome title"
                    data-default="Operate your Yuneta agents">Operate your Yuneta agents</h1>
                <p class="ylogin-welcome-lead"
                   data-i18n="login welcome lead"
                   data-default="Run commands, watch live statistics and open a terminal on every node — from one console, through the control center.">Run commands, watch live statistics and open a terminal on every node — from one console, through the control center.</p>

                <ul class="ylogin-features">
                    <li>${svg_bolt()}<span data-i18n="login feature commands" data-default="Multi-node command console">Multi-node command console</span></li>
                    <li>${svg_bolt()}<span data-i18n="login feature stats" data-default="Live statistics &amp; health">Live statistics &amp; health</span></li>
                    <li>${svg_bolt()}<span data-i18n="login feature terminal" data-default="Interactive node terminal">Interactive node terminal</span></li>
                </ul>

                <div class="ylogin-spark" aria-hidden="true"></div>
            </aside>

            <section class="ylogin-form">

                <header class="ylogin-form-header">
                    <img class="ylogin-mobile-mark" src="/agent-mark.svg" alt="Agent Console">
                    <div class="ylogin-quick">
                        <button type="button" class="yquick-btn" data-quick="theme">
                            <span class="yquick-icon" data-quick-icon="theme"></span>
                        </button>
                        <button type="button" class="yquick-btn" data-quick="lang">
                            <span class="yquick-icon">${svg_globe()}</span>
                            <span class="yquick-label" data-quick-label="lang"></span>
                        </button>
                    </div>
                </header>

                <h2 class="ylogin-title" data-i18n="sign in" data-default="Sign in">Sign in</h2>
                <p class="ylogin-subtitle">${dep.tenant} · ${plane}</p>

                <form class="ylogin-fields" novalidate>
                    <div class="ylogin-alert" data-role="error" hidden></div>

                    <label class="yfield">
                        <span class="yfield-label" data-i18n="username" data-default="Username">Username</span>
                        <input type="text" name="username" autocomplete="username" required>
                    </label>

                    <label class="yfield">
                        <span class="yfield-label" data-i18n="password" data-default="Password">Password</span>
                        <div class="yfield-password">
                            <input type="password" name="password" autocomplete="current-password" required>
                            <button type="button" class="ypassword-toggle" data-action="toggle-password"
                                    aria-pressed="false" aria-label="${t("show password", {defaultValue: "Show password"})}">
                                <span data-password-icon>${svg_eye()}</span>
                            </button>
                        </div>
                    </label>

                    <button type="submit" class="ylogin-cta">
                        <span data-i18n="sign in" data-default="Sign in">Sign in</span>
                    </button>
                </form>
            </section>

            <footer class="ylogin-footer">
                <p data-role="footer-line"></p>
            </footer>
        </div>
    `;
}


                    /***************************
                     *      Form wiring
                     ***************************/


function wire_form(root, on_submit)
{
    let form  = root.querySelector(".ylogin-fields");
    let alert = form.querySelector("[data-role=error]");
    let cta   = form.querySelector(".ylogin-cta");
    let user  = form.querySelector("input[name=username]");
    let pwd   = form.querySelector("input[name=password]");

    function set_error(msg) {
        alert.textContent = msg || "";
        alert.hidden = !msg;
    }
    function clear_error() {
        alert.textContent = "";
        alert.hidden = true;
    }
    function set_busy(on) {
        form.querySelectorAll("input, button").forEach(function(el) {
            el.disabled = !!on;
        });
        cta.classList.toggle("is-busy", !!on);
    }

    form.addEventListener("submit", function(ev) {
        ev.preventDefault();
        let username = String(user.value || "").trim();
        let password = String(pwd.value || "");
        if(!username || !password) {
            set_error(t("username and password are required",
                {defaultValue: "Username and password are required"}));
            return;
        }
        clear_error();
        set_busy(true);
        on_submit({username: username, password: password});
    });

    let toggle   = root.querySelector("[data-action=toggle-password]");
    let pwd_icon = toggle.querySelector("[data-password-icon]");
    toggle.addEventListener("click", function() {
        let revealed = pwd.type === "text";
        pwd.type = revealed ? "password" : "text";
        pwd_icon.innerHTML = revealed ? svg_eye() : svg_eye_off();
        toggle.setAttribute("aria-pressed", revealed ? "false" : "true");
        toggle.setAttribute("aria-label",
            t(revealed ? "show password" : "hide password",
                {defaultValue: revealed ? "Show password" : "Hide password"}));
    });

    return {set_error, clear_error, set_busy};
}


                    /***************************
                     *      Quick toggles
                     ***************************/


function wire_quick(root)
{
    let theme_btn = root.querySelector("[data-quick=theme]");
    theme_btn.addEventListener("click", function() {
        toggle_theme();
        paint_quick(root);
    });

    let lang_btn = root.querySelector("[data-quick=lang]");
    lang_btn.addEventListener("click", function() {
        switch_locale(current_locale() === "es" ? "en" : "es");
        paint_i18n(root);
        paint_quick(root);
    });
}

function paint_quick(root)
{
    let icon = root.querySelector("[data-quick-icon=theme]");
    if(icon) {
        icon.innerHTML = (current_theme() === "light") ? svg_moon() : svg_sun();
    }
    let theme_btn = root.querySelector("[data-quick=theme]");
    if(theme_btn) {
        theme_btn.setAttribute("aria-label", t("toggle theme", {defaultValue: "Toggle theme"}));
    }
    let lang = root.querySelector("[data-quick-label=lang]");
    if(lang) {
        lang.textContent = current_locale().toUpperCase();
    }
}


                    /***************************
                     *      i18n re-paint
                     ***************************/


function paint_i18n(root)
{
    root.querySelectorAll("[data-i18n]").forEach(function(el) {
        let key = el.dataset.i18n;
        let def = el.dataset.default || el.textContent;
        el.textContent = t(key, {defaultValue: def});
    });
    let footer = root.querySelector("[data-role=footer-line]");
    if(footer) {
        let year = new Date().getFullYear();
        footer.textContent = `© ${year} ArtGins` + (VERSION ? ` · v${VERSION}` : "");
    }
}


                    /***************************
                     *      Inline SVGs
                     ***************************/


function svg_globe()
{
    return `<svg class="ysvg" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/>
        <path d="M2 8 H14 M8 2 C5 5 5 11 8 14 M8 2 C11 5 11 11 8 14"
              fill="none" stroke="currentColor" stroke-width="1.2"/>
    </svg>`;
}

function svg_sun()
{
    return `<svg class="ysvg" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="currentColor"/>
        <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <line x1="8" y1="1.5" x2="8" y2="3.5"/><line x1="8" y1="12.5" x2="8" y2="14.5"/>
            <line x1="1.5" y1="8" x2="3.5" y2="8"/><line x1="12.5" y1="8" x2="14.5" y2="8"/>
            <line x1="3.4" y1="3.4" x2="4.8" y2="4.8"/><line x1="11.2" y1="11.2" x2="12.6" y2="12.6"/>
            <line x1="3.4" y1="12.6" x2="4.8" y2="11.2"/><line x1="11.2" y1="4.8" x2="12.6" y2="3.4"/>
        </g>
    </svg>`;
}

function svg_moon()
{
    return `<svg class="ysvg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13 9.5 A6 6 0 0 1 6.5 3 A6 6 0 1 0 13 9.5 Z" fill="currentColor"/>
    </svg>`;
}

function svg_eye()
{
    return `<svg class="ysvg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.5 8 C 3.4 4.5, 5.5 3.2, 8 3.2 C 10.5 3.2, 12.6 4.5, 14.5 8
                 C 12.6 11.5, 10.5 12.8, 8 12.8 C 5.5 12.8, 3.4 11.5, 1.5 8 Z"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="8" cy="8" r="2.4" fill="currentColor"/>
    </svg>`;
}

function svg_eye_off()
{
    return `<svg class="ysvg" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.5 8 C 3.4 4.5, 5.5 3.2, 8 3.2 C 10.5 3.2, 12.6 4.5, 14.5 8
                 C 12.6 11.5, 10.5 12.8, 8 12.8 C 5.5 12.8, 3.4 11.5, 1.5 8 Z"
              fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="8" cy="8" r="2.4" fill="currentColor"/>
        <line x1="2.4" y1="13.6" x2="13.6" y2="2.4" stroke="var(--yl-card-bg,#fff)" stroke-width="2.4" stroke-linecap="round"/>
        <line x1="2.4" y1="13.6" x2="13.6" y2="2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`;
}

function svg_bolt()
{
    return `<svg class="ysvg ysvg-bolt" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M9 1 L3 9 H7 L6 15 L13 6 H9 Z" fill="currentColor"/>
    </svg>`;
}


export {mount_login};
