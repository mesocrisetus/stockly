/* =============================================================
   Stockly — lógica de cliente (script clásico, IIFE)
   Un solo fichero para la pantalla de acceso y para la aplicación.
   ============================================================= */
(function () {
  "use strict";

  // ---- Helpers ------------------------------------------------
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function escHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safe(fn, name) { try { fn(); } catch (e) { console.warn("[" + name + "]", e); } }

  // Tipos de fábrica (respaldo si el servidor no manda la lista).
  var TYPE_LABELS = {
    celular: "Celular", portatil: "Portátil", monitor: "Monitor", tablet: "Tablet",
    impresora: "Impresora", mobiliario: "Mobiliario", perifericos: "Periféricos", otro: "Otro"
  };
  var STATE_LABELS = {
    disponible: "Disponible", asignado: "Asignado", reparacion: "En reparación", baja: "Dado de baja"
  };

  // Lista vigente de tipos [{id,label}], la que manda el servidor.
  function typeList() {
    if (S && S.meta && S.meta.types && S.meta.types.length) return S.meta.types;
    return Object.keys(TYPE_LABELS).map(function (k) { return { id: k, label: TYPE_LABELS[k] }; });
  }
  function typeLabel(id) {
    var l = typeList();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i].label;
    return TYPE_LABELS[id] || id;
  }

  // ---- Llamadas al servidor --------------------------------
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {}, credentials: "same-origin", cache: "no-store" };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch("api/" + path, init).then(function (res) {
      if (res.status === 401 && !opts.noAuthRedirect) {
        if (!/index\.html?$/.test(location.pathname) && location.pathname !== "/") {
          location.href = "index.html";
        }
      }
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") === -1) {
        if (!res.ok) throw new Error("El servidor respondió con un error (" + res.status + ").");
        return res;
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data && data.error ? data.error : "No se pudo completar la operación.");
        return data;
      });
    });
  }

  // ---- Tema claro / oscuro -------------------------------
  function initTheme() {
    var btn = $("#theme-toggle");
    function current() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
    function apply(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      try { localStorage.setItem("stockly_theme", theme); } catch (e) {}
      if (btn) btn.setAttribute("aria-pressed", String(theme === "dark"));
    }
    // Normaliza por si el script en línea del <head> no llegó a ejecutarse.
    apply(current());
    if (btn) {
      btn.addEventListener("click", function () {
        apply(current() === "dark" ? "light" : "dark");
      });
    }
  }

  // ---- Avisos (toast) — nunca alert() ---------------------
  function toast(msg, kind) {
    var stack = $("#toast-stack");
    if (!stack) { console.log(msg); return; }
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " " + kind : "");
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transition = "opacity .3s";
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, kind === "err" ? 5200 : 3200);
  }

  // =========================================================
  // PANTALLA DE ACCESO
  // =========================================================
  function initLogin() {
    var form = $("#login-form");
    if (!form) return;
    var errBox = $("#login-error");
    var btn = $("#login-btn");

    // Si ya hay sesión, entra directo.
    api("me", { noAuthRedirect: true }).then(function (d) {
      if (d && d.user) location.href = "app.html";
    }).catch(function () {});

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errBox.hidden = true;
      btn.disabled = true;
      btn.textContent = "Entrando…";
      api("login", { method: "POST", body: {
        username: $("#username").value.trim(),
        password: $("#password").value
      }, noAuthRedirect: true }).then(function () {
        location.href = "app.html";
      }).catch(function (err) {
        errBox.textContent = err.message;
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = "Entrar";
        $("#password").value = "";
        $("#password").focus();
      });
    });
  }

  // =========================================================
  // APLICACIÓN
  // =========================================================
  var S = { user: null, assets: [], employees: [], assignments: [], settings: { stale_days: 30 }, meta: {} };

  function empById(id) { for (var i = 0; i < S.employees.length; i++) if (S.employees[i].id === id) return S.employees[i]; return null; }
  function assetById(id) { for (var i = 0; i < S.assets.length; i++) if (S.assets[i].id === id) return S.assets[i]; return null; }
  function empName(id) { var e = empById(id); return e ? e.name : "—"; }
  function assetTitle(a) {
    var t = [a.brand, a.model].filter(Boolean).join(" ");
    return t || a.serial || (typeLabel(a.type)) + " " + a.id;
  }
  function fmtDate(s) {
    if (!s) return "—";
    var d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  }
  function daysSince(s) {
    if (!s) return null;
    var d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
  }

  function initApp() {
    var root = $("[data-app]");
    if (!root) return;

    api("bootstrap").then(function (d) {
      S.user = d.user; S.assets = d.assets || []; S.employees = d.employees || [];
      S.assignments = d.assignments || []; S.settings = d.settings || S.settings; S.meta = d.meta || {};
      root.hidden = false;
      hydrateChrome();
      wireNav();
      wireGlobalUI();
      wireModalForm();
      fillFilterOptions();
      renderAll();
      var initialView = location.hash.replace("#", "") || "panel";
      showView(["panel", "activos", "empleados", "ajustes"].indexOf(initialView) >= 0 ? initialView : "panel");
    }).catch(function (err) {
      document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">No se pudo cargar el inventario: ' + escHTML(err.message) + '</p>';
    });
  }

  function hydrateChrome() {
    var name = S.user && S.user.name ? S.user.name : "Admin";
    $("#user-name").textContent = name;
    $("#user-avatar").textContent = (name[0] || "A").toUpperCase();
  }

  // ---- Navegación ----------------------------------------
  function wireNav() {
    $$("[data-nav]").forEach(function (b) {
      b.addEventListener("click", function () {
        var v = b.getAttribute("data-nav");
        showView(v);
        if (b.getAttribute("data-focus") === "pass") setTimeout(function () { var el = $("#pw-current"); if (el) el.focus(); }, 60);
        closeUserMenu();
      });
    });
    window.addEventListener("hashchange", function () {
      var v = location.hash.replace("#", "");
      if (["panel", "activos", "empleados", "ajustes"].indexOf(v) >= 0) showView(v);
    });
  }
  function showView(v) {
    $$(".view").forEach(function (s) { s.classList.toggle("is-active", s.getAttribute("data-view") === v); });
    $$(".topnav-link").forEach(function (b) { b.classList.toggle("is-active", b.getAttribute("data-nav") === v); });
    if (location.hash.replace("#", "") !== v) history.replaceState(null, "", "#" + v);
    if (v === "panel") renderPanel();
    if (v === "ajustes") renderAjustes();
  }

  function wireGlobalUI() {
    var menuBtn = $("#usermenu-btn"), pop = $("#usermenu-pop");
    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = pop.hidden;
      pop.hidden = !open;
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", closeUserMenu);
    $("#logout-btn").addEventListener("click", function () {
      api("logout", { method: "POST" }).then(function () { location.href = "index.html"; });
    });

    $("#new-asset-btn").addEventListener("click", function () { openAssetModal(null); });
    $("#new-emp-btn").addEventListener("click", function () { openEmployeeModal(null); });
    $("#new-admin-btn").addEventListener("click", openAdminModal);

    $("#asset-search").addEventListener("input", renderAssets);
    $("#filter-type").addEventListener("change", renderAssets);
    $("#filter-state").addEventListener("change", renderAssets);
    $("#filter-emp").addEventListener("change", renderAssets);
    $("#clear-filters").addEventListener("click", function () {
      $("#asset-search").value = ""; $("#filter-type").value = "";
      $("#filter-state").value = ""; $("#filter-emp").value = "";
      renderAssets();
    });
    $("#emp-search").addEventListener("input", renderEmployees);

    $("#drawer-close").addEventListener("click", closeDrawer);
    $("#scrim").addEventListener("click", closeDrawer);
    $("#modal-close").addEventListener("click", closeModal);
    $("#modal-cancel").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeModal(); closeDrawer(); closeUserMenu(); }
    });

    $("#export-btn").addEventListener("click", function () {
      toast("Preparando la descarga del inventario…");
    });

    $("#settings-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = parseInt($("#stale-days").value, 10);
      if (!(v >= 1 && v <= 365)) { toast("Escribe un número entre 1 y 365.", "err"); return; }
      api("settings", { method: "POST", body: { stale_days: v } }).then(function (d) {
        S.settings = d.settings; toast("Ajuste guardado.", "ok"); renderPanel();
      }).catch(function (err) { toast(err.message, "err"); });
    });

    $("#type-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = $("#type-new");
      var v = inp.value.trim();
      if (v.length < 2) { toast("Escribe un nombre de al menos 2 caracteres.", "err"); return; }
      api("types", { method: "POST", body: { label: v } }).then(function () {
        inp.value = ""; toast("Tipo añadido.", "ok");
        return afterTypesChanged();
      }).catch(function (err) { toast(err.message, "err"); });
    });

    $("#password-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var cur = $("#pw-current").value, nxt = $("#pw-next").value;
      if (nxt.length < 8) { toast("La contraseña nueva debe tener al menos 8 caracteres.", "err"); return; }
      api("password", { method: "POST", body: { current: cur, next: nxt } }).then(function () {
        $("#pw-current").value = ""; $("#pw-next").value = "";
        toast("Contraseña actualizada.", "ok");
      }).catch(function (err) { toast(err.message, "err"); });
    });
  }
  function closeUserMenu() {
    var pop = $("#usermenu-pop");
    if (pop && !pop.hidden) { pop.hidden = true; $("#usermenu-btn").setAttribute("aria-expanded", "false"); }
  }

  // ---- Filtros --------------------------------------------
  function fillFilterOptions() {
    var ftype = $("#filter-type");
    var ct = ftype.value;
    ftype.innerHTML = '<option value="">Todos los tipos</option>';
    typeList().forEach(function (t) {
      ftype.insertAdjacentHTML("beforeend", '<option value="' + escHTML(t.id) + '">' + escHTML(t.label) + "</option>");
    });
    ftype.value = ct;

    var fstate = $("#filter-state");
    if (!fstate.getAttribute("data-filled")) {
      var cs = fstate.value;
      fstate.innerHTML = '<option value="">Todos los estados</option>';
      Object.keys(STATE_LABELS).forEach(function (k) {
        fstate.insertAdjacentHTML("beforeend", '<option value="' + k + '">' + STATE_LABELS[k] + "</option>");
      });
      fstate.value = cs;
      fstate.setAttribute("data-filled", "1");
    }
    refreshEmployeeFilter();
  }
  function refreshEmployeeFilter() {
    var f = $("#filter-emp");
    var cur = f.value;
    f.innerHTML = '<option value="">Cualquier asignación</option><option value="__none__">Sin asignar</option>';
    S.employees.slice().sort(byName).forEach(function (e) {
      f.insertAdjacentHTML("beforeend", '<option value="' + e.id + '">' + escHTML(e.name) + "</option>");
    });
    f.value = cur;
  }
  function byName(a, b) { return String(a.name || "").localeCompare(String(b.name || ""), "es"); }

  // ---- Render maestro -------------------------------------
  function renderAll() { renderPanel(); renderAssets(); renderEmployees(); renderAjustes(); }

  // ---- Alertas -------------------------------------------
  function computeAlerts() {
    var out = [];
    var stale = S.settings.stale_days || 30;
    S.assets.forEach(function (a) {
      if (a.status === "reparacion") {
        out.push({ kind: "repair", asset: a, text: assetTitle(a) + " está en reparación." });
      } else if (a.status === "disponible") {
        var d = daysSince(a.updated_at || a.created_at);
        if (d != null && d >= stale) {
          out.push({ kind: "warn", asset: a, text: assetTitle(a) + " lleva " + d + " días disponible sin asignar." });
        }
      }
    });
    return out;
  }

  function renderPanel() {
    var counts = { disponible: 0, asignado: 0, reparacion: 0, baja: 0 };
    S.assets.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var total = S.assets.length;

    var grid = $("#stat-grid");
    grid.innerHTML = [
      statCard(total, "Activos en total", ""),
      statCard(counts.disponible, "Disponibles", "ok"),
      statCard(counts.asignado, "Asignados", "accent"),
      statCard(counts.reparacion, "En reparación", "danger"),
      statCard(S.employees.length, "Empleados", "")
    ].join("");

    var alerts = computeAlerts();
    $("#alert-count").textContent = alerts.length ? alerts.length + (alerts.length === 1 ? " aviso" : " avisos") : "";
    var list = $("#alert-list");
    if (!alerts.length) {
      list.innerHTML = '<li class="alert-empty">Todo en orden. No hay activos en reparación ni parados demasiado tiempo.</li>';
    } else {
      list.innerHTML = alerts.map(function (al) {
        return '<li class="alert-item ' + al.kind + '" data-asset="' + al.asset.id + '">' +
          '<span class="dot"></span><span>' + escHTML(al.text) + "</span></li>";
      }).join("");
      $$("#alert-list .alert-item").forEach(function (li) {
        li.addEventListener("click", function () { showView("activos"); openAssetDetail(li.getAttribute("data-asset")); });
      });
    }

    // Reparto por tipo
    var byType = {};
    S.assets.forEach(function (a) { byType[a.type] = (byType[a.type] || 0) + 1; });
    var keys = Object.keys(byType).sort(function (x, y) { return byType[y] - byType[x]; });
    var max = keys.length ? byType[keys[0]] : 1;
    var bd = $("#type-breakdown");
    bd.innerHTML = keys.length ? keys.map(function (k) {
      var pct = Math.round((byType[k] / max) * 100);
      return '<li class="bar-row"><span>' + escHTML(typeLabel(k)) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="num">' + byType[k] + "</span></li>";
    }).join("") : '<li class="alert-empty">Sin activos todavía.</li>';

    $("#panel-sub").textContent = total
      ? total + " activos · " + counts.asignado + " asignados · " + counts.disponible + " disponibles"
      : "Aún no has registrado ningún activo. Ve a “Activos” y crea el primero.";
  }
  function statCard(num, label, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="stat-num">' + num + '</div><div class="stat-label">' + escHTML(label) + "</div></div>";
  }

  // ---- Tabla de activos ---------------------------------
  function currentAssetFilter() {
    return {
      q: $("#asset-search").value.trim().toLowerCase(),
      type: $("#filter-type").value,
      state: $("#filter-state").value,
      emp: $("#filter-emp").value
    };
  }
  function renderAssets() {
    var f = currentAssetFilter();
    var rows = S.assets.filter(function (a) {
      if (f.type && a.type !== f.type) return false;
      if (f.state && a.status !== f.state) return false;
      if (f.emp === "__none__" && a.assigned_to) return false;
      if (f.emp && f.emp !== "__none__" && a.assigned_to !== f.emp) return false;
      if (f.q) {
        var hay = [a.brand, a.model, a.serial, a.tag, a.notes, typeLabel(a.type),
          a.assigned_to ? empName(a.assigned_to) : ""].join(" ").toLowerCase();
        if (hay.indexOf(f.q) === -1) return false;
      }
      return true;
    }).sort(function (x, y) { return String(y.updated_at || "").localeCompare(String(x.updated_at || "")); });

    var tb = $("#asset-tbody");
    tb.innerHTML = rows.map(function (a) {
      return "<tr data-id='" + a.id + "'>" +
        "<td class='cell-mute'>" + (escHTML(a.tag) || a.id) + "</td>" +
        "<td><span class='type-chip'>" + escHTML(typeLabel(a.type)) + "</span></td>" +
        "<td class='cell-strong'>" + (escHTML([a.brand, a.model].filter(Boolean).join(" ")) || "<span class='cell-mute'>—</span>") + "</td>" +
        "<td>" + (escHTML(a.serial) || "<span class='cell-mute'>—</span>") + "</td>" +
        "<td><span class='badge " + a.status + "'>" + STATE_LABELS[a.status] + "</span></td>" +
        "<td>" + (a.assigned_to ? escHTML(empName(a.assigned_to)) : "<span class='cell-mute'>—</span>") + "</td>" +
        "<td class='cell-mute'>" + (a.purchase_date ? fmtDate(a.purchase_date) : "—") + "</td>" +
        "</tr>";
    }).join("");
    $("#asset-empty").hidden = rows.length > 0;
    $("#asset-total").textContent = rows.length + " de " + S.assets.length + " activos";
    $$("#asset-tbody tr").forEach(function (tr) {
      tr.addEventListener("click", function () { openAssetDetail(tr.getAttribute("data-id")); });
    });
  }

  // ---- Tabla de empleados ------------------------------
  function assetsOfEmp(id) { return S.assets.filter(function (a) { return a.assigned_to === id; }); }
  function renderEmployees() {
    var q = $("#emp-search").value.trim().toLowerCase();
    var rows = S.employees.filter(function (e) {
      if (!q) return true;
      return [e.name, e.area, e.email].join(" ").toLowerCase().indexOf(q) !== -1;
    }).sort(byName);

    var tb = $("#emp-tbody");
    tb.innerHTML = rows.map(function (e) {
      var n = assetsOfEmp(e.id).length;
      return "<tr data-id='" + e.id + "'>" +
        "<td class='cell-strong'>" + escHTML(e.name) + "</td>" +
        "<td>" + (escHTML(e.area) || "<span class='cell-mute'>—</span>") + "</td>" +
        "<td>" + (escHTML(e.email) || "<span class='cell-mute'>—</span>") + "</td>" +
        "<td>" + (n ? n + (n === 1 ? " activo" : " activos") : "<span class='cell-mute'>ninguno</span>") + "</td>" +
        "</tr>";
    }).join("");
    $("#emp-empty").hidden = rows.length > 0;
    $$("#emp-tbody tr").forEach(function (tr) {
      tr.addEventListener("click", function () { openEmployeeDetail(tr.getAttribute("data-id")); });
    });
  }

  // ---- Ajustes -----------------------------------------
  function renderAjustes() {
    $("#stale-days").value = S.settings.stale_days || 30;
    renderTypeList();
    api("admins").then(function (d) {
      var list = $("#admin-list");
      list.innerHTML = (d.admins || []).map(function (u) {
        var isMe = S.user && u.id === S.user.id;
        return '<li class="admin-row"><span><strong>' + escHTML(u.name) + "</strong> · " + escHTML(u.username) +
          (isMe ? ' <span class="you">(tú)</span>' : "") + "</span>" +
          (isMe ? "" : '<button class="btn btn-ghost btn-sm" data-del-admin="' + u.id + '">Eliminar</button>') +
          "</li>";
      }).join("");
      $$("#admin-list [data-del-admin]").forEach(function (b) {
        b.addEventListener("click", function () {
          if (!confirm("¿Eliminar el acceso de este administrador? No se puede deshacer.")) return;
          api("admins/" + b.getAttribute("data-del-admin"), { method: "DELETE" }).then(function () {
            toast("Administrador eliminado.", "ok"); renderAjustes();
          }).catch(function (err) { toast(err.message, "err"); });
        });
      });
    }).catch(function () {});
  }

  // ---- Ajustes: tipos de activo -----------------------
  function countAssetsOfType(id) {
    var n = 0;
    for (var i = 0; i < S.assets.length; i++) if (S.assets[i].type === id) n++;
    return n;
  }
  function afterTypesChanged() {
    // Refresca meta.types desde el servidor y repinta todo lo que muestra tipos.
    return api("bootstrap").then(function (d) {
      if (d.meta) S.meta = d.meta;
      if (d.assets) S.assets = d.assets;
      fillFilterOptions();
      renderAssets();
      renderPanel();
      renderTypeList();
    });
  }
  function renderTypeList() {
    var list = $("#type-list");
    if (!list) return;
    list.innerHTML = typeList().map(function (t) {
      var used = countAssetsOfType(t.id);
      var canDelete = t.id !== "otro" && used === 0;
      return '<li class="admin-row" data-type="' + escHTML(t.id) + '">' +
        '<span><strong class="type-name">' + escHTML(t.label) + "</strong>" +
        (used ? ' <span class="you">· ' + used + (used === 1 ? " activo" : " activos") + "</span>" : "") + "</span>" +
        '<span class="row-actions">' +
          '<button class="btn btn-ghost btn-sm" data-type-rename="' + escHTML(t.id) + '">Renombrar</button>' +
          (canDelete
            ? '<button class="btn btn-ghost btn-sm" data-type-del="' + escHTML(t.id) + '">Eliminar</button>'
            : "") +
        "</span></li>";
    }).join("");

    $$("#type-list [data-type-rename]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-type-rename");
        var cur = typeLabel(id);
        openRenameTypeModal(id, cur);
      });
    });
    $$("#type-list [data-type-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-type-del");
        if (!confirm('¿Eliminar el tipo "' + typeLabel(id) + '"?')) return;
        api("types/" + encodeURIComponent(id), { method: "DELETE" }).then(function () {
          toast("Tipo eliminado.", "ok");
          return afterTypesChanged();
        }).catch(function (err) { toast(err.message, "err"); });
      });
    });
  }
  function openRenameTypeModal(id, cur) {
    openModal("Renombrar tipo",
      field("Nombre del tipo", "typelabel", 'maxlength="40"', cur),
      function () {
        var v = mval("typelabel");
        if (v.length < 2) { toast("El nombre debe tener al menos 2 caracteres.", "err"); return; }
        api("types/" + encodeURIComponent(id), { method: "PUT", body: { label: v } }).then(function () {
          closeModal(); toast("Tipo renombrado.", "ok");
          return afterTypesChanged();
        }).catch(function (err) { toast(err.message, "err"); });
      }, "Guardar");
  }

  // ---- Drawer: detalle de activo ----------------------
  function openAssetDetail(id) {
    var a = assetById(id);
    if (!a) return;
    $("#drawer-title").textContent = assetTitle(a);

    var hist = S.assignments.filter(function (x) { return x.asset_id === id; })
      .sort(function (x, y) { return String(y.assigned_date).localeCompare(String(x.assigned_date)); });

    var rows = [
      dRow("Código", a.tag || "—"),
      dRow("Tipo", typeLabel(a.type)),
      dRow("Marca", a.brand || "—"),
      dRow("Modelo", a.model || "—"),
      dRow("Nº de serie", a.serial || "—"),
      dRow("Fecha de compra", a.purchase_date ? fmtDate(a.purchase_date) : "—"),
      dRow("Estado", '<span class="badge ' + a.status + '">' + STATE_LABELS[a.status] + "</span>"),
      dRow("Asignado a", a.assigned_to ? escHTML(empName(a.assigned_to)) + " · desde " + fmtDate(a.assigned_since) : "—"),
      dRow("Notas", a.notes ? escHTML(a.notes).replace(/\n/g, "<br>") : "—")
    ].join("");

    var actions = [];
    if (a.status !== "baja") {
      actions.push('<button class="btn btn-ghost btn-sm" data-act="edit">Editar</button>');
      if (a.assigned_to) actions.push('<button class="btn btn-primary btn-sm" data-act="unassign">Desasignar</button>');
      else actions.push('<button class="btn btn-primary btn-sm" data-act="assign">Asignar</button>');
      if (a.status === "reparacion") actions.push('<button class="btn btn-ghost btn-sm" data-act="repair-off">Marcar disponible</button>');
      else if (!a.assigned_to) actions.push('<button class="btn btn-ghost btn-sm" data-act="repair-on">Enviar a reparación</button>');
      actions.push('<button class="btn btn-danger btn-sm" data-act="retire">Dar de baja</button>');
    } else {
      actions.push('<button class="btn btn-primary btn-sm" data-act="reactivate">Reactivar activo</button>');
    }

    var histHTML = hist.length ? '<ul class="timeline">' + hist.map(function (h) {
      var open = !h.returned_date;
      return '<li class="' + (open ? "tl-open" : "") + '"><strong>' + escHTML(empName(h.employee_id)) + "</strong> — " +
        fmtDate(h.assigned_date) + (open ? " · <em>en uso</em>" : " → " + fmtDate(h.returned_date)) +
        (h.assign_notes ? '<div class="tl-meta">Entrega: ' + escHTML(h.assign_notes) + "</div>" : "") +
        (h.return_notes ? '<div class="tl-meta">Devolución: ' + escHTML(h.return_notes) + "</div>" : "") +
        "</li>";
    }).join("") + "</ul>" : '<p class="muted small">Este activo todavía no ha tenido asignaciones.</p>';

    $("#drawer-body").innerHTML =
      '<dl>' + rows + "</dl>" +
      '<div class="detail-actions">' + actions.join("") + "</div>" +
      '<div class="detail-section-title">Historial de asignaciones</div>' + histHTML;

    $$("#drawer-body [data-act]").forEach(function (b) {
      b.addEventListener("click", function () { assetAction(a.id, b.getAttribute("data-act")); });
    });
    openDrawer();
  }

  function assetAction(id, act) {
    var a = assetById(id);
    if (!a) return;
    if (act === "edit") return openAssetModal(a);
    if (act === "assign") return openAssignModal(a);
    if (act === "unassign") return openUnassignModal(a);
    if (act === "repair-on") return quickState(id, "assets/" + id, { status: "reparacion" }, "Activo enviado a reparación.");
    if (act === "repair-off") return quickState(id, "assets/" + id, { status: "disponible" }, "Activo marcado como disponible.");
    if (act === "retire") {
      if (!confirm("¿Dar de baja este activo? Dejará de estar disponible y se cerrará su asignación actual si la tiene.")) return;
      return post("assets/" + id + "/retire", {}, "Activo dado de baja.", id);
    }
    if (act === "reactivate") return post("assets/" + id + "/reactivate", {}, "Activo reactivado.", id);
  }
  function quickState(id, path, body, okMsg) {
    var a = assetById(id);
    var payload = {
      type: a.type, brand: a.brand, model: a.model, serial: a.serial, tag: a.tag,
      purchase_date: a.purchase_date, notes: a.notes, status: body.status
    };
    api(path, { method: "PUT", body: payload }).then(function (d) {
      mergeAsset(d.asset); toast(okMsg, "ok"); afterMutation(id);
    }).catch(function (err) { toast(err.message, "err"); });
  }
  function post(path, body, okMsg, reopenAssetId) {
    api(path, { method: "POST", body: body }).then(function (d) {
      if (d.asset) mergeAsset(d.asset);
      return api("bootstrap");
    }).then(function (d) {
      syncFromBootstrap(d); toast(okMsg, "ok");
      renderAll(); refreshEmployeeFilter();
      if (reopenAssetId && !$("#drawer").hidden) openAssetDetail(reopenAssetId);
    }).catch(function (err) { toast(err.message, "err"); });
  }

  // ---- Drawer: detalle de empleado -------------------
  function openEmployeeDetail(id) {
    var e = empById(id);
    if (!e) return;
    $("#drawer-title").textContent = e.name;

    var current = assetsOfEmp(id);
    var hist = S.assignments.filter(function (x) { return x.employee_id === id; })
      .sort(function (x, y) { return String(y.assigned_date).localeCompare(String(x.assigned_date)); });

    var rows = [
      dRow("Nombre", escHTML(e.name)),
      dRow("Área / Departamento", e.area ? escHTML(e.area) : "—"),
      dRow("Correo", e.email ? escHTML(e.email) : "—"),
      dRow("Activos ahora", current.length ? String(current.length) : "ninguno")
    ].join("");

    var curHTML = current.length ? "<ul class='timeline'>" + current.map(function (a) {
      return "<li class='tl-open'><div class='tl-line'><span><strong>" + escHTML(assetTitle(a)) + "</strong> · " +
        (typeLabel(a.type)) + " — desde " + fmtDate(a.assigned_since) + "</span>" +
        "<button type='button' class='btn btn-ghost btn-sm tl-btn' data-unassign='" + a.id + "'>Quitar</button></div></li>";
    }).join("") + "</ul>" : "<p class='muted small'>Sin activos asignados ahora mismo.</p>";

    var histHTML = hist.length ? "<ul class='timeline'>" + hist.map(function (h) {
      var a = assetById(h.asset_id);
      var open = !h.returned_date;
      return "<li class='" + (open ? "tl-open" : "") + "'><strong>" + escHTML(a ? assetTitle(a) : h.asset_id) + "</strong> — " +
        fmtDate(h.assigned_date) + (open ? " · <em>en uso</em>" : " → " + fmtDate(h.returned_date)) + "</li>";
    }).join("") + "</ul>" : "<p class='muted small'>Sin historial todavía.</p>";

    $("#drawer-body").innerHTML =
      "<dl>" + rows + "</dl>" +
      '<div class="detail-actions">' +
        '<button class="btn btn-ghost btn-sm" data-eact="edit">Editar</button>' +
        '<button class="btn btn-danger btn-sm" data-eact="delete">Eliminar</button>' +
      "</div>" +
      '<div class="detail-section-title">Activos en uso</div>' + curHTML +
      '<div class="detail-section-title">Historial completo</div>' + histHTML;

    $$("#drawer-body [data-unassign]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = assetById(b.getAttribute("data-unassign"));
        if (a) openUnassignModal(a, function () { openEmployeeDetail(id); });
      });
    });

    $$("#drawer-body [data-eact]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-eact");
        if (act === "edit") return openEmployeeModal(e);
        if (act === "delete") {
          if (!confirm("¿Eliminar a " + e.name + "? Solo se puede si no tiene activos asignados. El historial pasado se conserva.")) return;
          api("employees/" + e.id, { method: "DELETE" }).then(function () {
            toast("Empleado eliminado.", "ok");
            return api("bootstrap");
          }).then(function (d) { syncFromBootstrap(d); renderAll(); refreshEmployeeFilter(); closeDrawer(); })
            .catch(function (err) { toast(err.message, "err"); });
        }
      });
    });
    openDrawer();
  }

  function dRow(k, v) { return '<div class="detail-row"><dt>' + escHTML(k) + "</dt><dd>" + v + "</dd></div>"; }

  // ---- Modales ---------------------------------------
  var modalSubmit = null;
  function openModal(title, bodyHTML, onSubmit, saveLabel) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHTML;
    $("#modal-save").textContent = saveLabel || "Guardar";
    modalSubmit = onSubmit;
    $("#modal").hidden = false;
    var first = $("#modal-body input, #modal-body select, #modal-body textarea");
    if (first) setTimeout(function () { first.focus(); }, 40);
  }
  function closeModal() { $("#modal").hidden = true; modalSubmit = null; }
  function wireModalForm() {
    var mf = $("#modal-form");
    if (mf) mf.addEventListener("submit", function (e) {
      e.preventDefault();
      if (modalSubmit) modalSubmit();
    });
  }

  function field(label, name, attrs, value) {
    return '<div class="field"><label for="f-' + name + '">' + escHTML(label) + "</label>" +
      '<input id="f-' + name + '" name="' + name + '" ' + (attrs || "") + ' value="' + escHTML(value || "") + '"></div>';
  }
  function textareaField(label, name, value) {
    return '<div class="field"><label for="f-' + name + '">' + escHTML(label) + "</label>" +
      '<textarea id="f-' + name + '" name="' + name + '">' + escHTML(value || "") + "</textarea></div>";
  }
  function selectField(label, name, options, value) {
    return '<div class="field"><label for="f-' + name + '">' + escHTML(label) + "</label><select id='f-" + name + "' name='" + name + "'>" +
      options.map(function (o) {
        return "<option value='" + escHTML(o.v) + "'" + (o.v === value ? " selected" : "") + ">" + escHTML(o.t) + "</option>";
      }).join("") + "</select></div>";
  }
  function mval(name) { var el = $("#f-" + name); return el ? el.value.trim() : ""; }

  function openAssetModal(a) {
    var isEdit = !!a;
    var typeOpts = typeList().map(function (t) { return { v: t.id, t: t.label }; });
    var defType = a ? a.type : (typeOpts[0] ? typeOpts[0].v : "otro");
    var stateOpts = [{ v: "disponible", t: "Disponible" }, { v: "reparacion", t: "En reparación" }];
    var body =
      '<div class="field-row">' +
        selectField("Tipo", "type", typeOpts, defType) +
        field("Código interno (opcional)", "tag", "", a ? a.tag : "") +
      "</div>" +
      '<div class="field-row">' +
        field("Marca", "brand", "", a ? a.brand : "") +
        field("Modelo", "model", "", a ? a.model : "") +
      "</div>" +
      '<div class="field-row">' +
        field("Nº de serie", "serial", "", a ? a.serial : "") +
        field("Fecha de compra", "purchase_date", 'type="date"', a ? a.purchase_date : "") +
      "</div>" +
      (a && a.status === "asignado"
        ? '<p class="muted small">Este activo está asignado. Para cambiar el estado, usa “Desasignar” en su ficha.</p>'
        : selectField("Estado", "status", stateOpts, a ? (a.status === "reparacion" ? "reparacion" : "disponible") : "disponible")) +
      textareaField("Notas", "notes", a ? a.notes : "");

    openModal(isEdit ? "Editar activo" : "Nuevo activo", body, function () {
      var payload = {
        type: mval("type"), tag: mval("tag"), brand: mval("brand"), model: mval("model"),
        serial: mval("serial"), purchase_date: mval("purchase_date"), notes: mval("notes"),
        status: $("#f-status") ? $("#f-status").value : (a ? a.status : "disponible")
      };
      if (!payload.brand && !payload.model && !payload.serial) {
        toast("Indica al menos la marca, el modelo o el número de serie.", "err"); return;
      }
      var req = isEdit
        ? api("assets/" + a.id, { method: "PUT", body: payload })
        : api("assets", { method: "POST", body: payload });
      req.then(function (d) {
        mergeAsset(d.asset); closeModal();
        toast(isEdit ? "Activo actualizado." : "Activo creado.", "ok");
        renderAll();
        if (isEdit && !$("#drawer").hidden) openAssetDetail(a.id);
      }).catch(function (err) { toast(err.message, "err"); });
    }, isEdit ? "Guardar cambios" : "Crear activo");
  }

  function openEmployeeModal(e) {
    var isEdit = !!e;
    var body =
      field("Nombre completo", "name", "", e ? e.name : "") +
      field("Área / Departamento", "area", "", e ? e.area : "") +
      field("Correo", "email", 'type="email"', e ? e.email : "");
    openModal(isEdit ? "Editar empleado" : "Nuevo empleado", body, function () {
      var payload = { name: mval("name"), area: mval("area"), email: mval("email") };
      if (!payload.name) { toast("El empleado necesita al menos un nombre.", "err"); return; }
      var req = isEdit
        ? api("employees/" + e.id, { method: "PUT", body: payload })
        : api("employees", { method: "POST", body: payload });
      req.then(function (d) {
        return api("bootstrap");
      }).then(function (d) {
        syncFromBootstrap(d); closeModal();
        toast(isEdit ? "Empleado actualizado." : "Empleado creado.", "ok");
        renderAll(); refreshEmployeeFilter();
        if (isEdit && !$("#drawer").hidden) openEmployeeDetail(e.id);
      }).catch(function (err) { toast(err.message, "err"); });
    }, isEdit ? "Guardar cambios" : "Crear empleado");
  }

  function openAssignModal(a) {
    if (!S.employees.length) {
      toast("Primero crea al menos un empleado en la pestaña “Empleados”.", "err");
      return;
    }
    var empOpts = S.employees.slice().sort(byName).map(function (e) {
      return { v: e.id, t: e.name + (e.area ? " · " + e.area : "") };
    });
    var today = new Date().toISOString().slice(0, 10);
    var body =
      '<p class="muted small">Asignando <strong>' + escHTML(assetTitle(a)) + "</strong>.</p>" +
      selectField("Empleado", "emp", empOpts, empOpts[0].v) +
      field("Fecha de asignación", "date", 'type="date"', today) +
      textareaField("Notas de la entrega (opcional)", "notes", "");
    openModal("Asignar activo", body, function () {
      var chosen = $("#f-emp").value;
      api("assign", { method: "POST", body: {
        asset_id: a.id, employee_id: chosen, date: mval("date"), notes: mval("notes")
      } }).then(function () {
        return api("bootstrap");
      }).then(function (d) {
        syncFromBootstrap(d); closeModal();
        toast("Activo asignado a " + empName(chosen) + ".", "ok");
        renderAll(); refreshEmployeeFilter();
        openAssetDetail(a.id);
      }).catch(function (err) { toast(err.message, "err"); });
    }, "Asignar");
  }

  function openUnassignModal(a, reopen) {
    var today = new Date().toISOString().slice(0, 10);
    var quienId = a.assigned_to;
    var body =
      '<p class="muted small">Devolviendo <strong>' + escHTML(assetTitle(a)) + "</strong> de " +
        escHTML(empName(a.assigned_to)) + ".</p>" +
      field("Fecha de devolución", "date", 'type="date"', today) +
      selectField("Estado tras la devolución", "to_state",
        [{ v: "disponible", t: "Disponible" }, { v: "reparacion", t: "En reparación" }], "disponible") +
      textareaField("Notas de la devolución (opcional)", "notes", "");
    openModal("Quitar activo", body, function () {
      api("unassign", { method: "POST", body: {
        asset_id: a.id, date: mval("date"), to_state: $("#f-to_state").value, notes: mval("notes")
      } }).then(function () {
        return api("bootstrap");
      }).then(function (d) {
        syncFromBootstrap(d); closeModal();
        toast("Activo quitado de " + empName(quienId) + ".", "ok");
        renderAll(); refreshEmployeeFilter();
        if (typeof reopen === "function") reopen();
        else openAssetDetail(a.id);
      }).catch(function (err) { toast(err.message, "err"); });
    }, "Quitar activo");
  }

  function openAdminModal() {
    var body =
      field("Usuario (para iniciar sesión)", "username", 'autocomplete="off"', "") +
      field("Nombre", "name", "", "") +
      field("Contraseña (mín. 8 caracteres)", "password", 'type="password" autocomplete="new-password"', "");
    openModal("Nuevo administrador", body, function () {
      api("admins", { method: "POST", body: {
        username: mval("username"), name: mval("name"), password: $("#f-password").value
      } }).then(function () {
        closeModal(); toast("Administrador añadido.", "ok"); renderAjustes();
      }).catch(function (err) { toast(err.message, "err"); });
    }, "Añadir administrador");
  }

  // ---- Estado / sincronización ----------------------
  function mergeAsset(a) {
    if (!a) return;
    for (var i = 0; i < S.assets.length; i++) if (S.assets[i].id === a.id) { S.assets[i] = a; return; }
    S.assets.push(a);
  }
  function syncFromBootstrap(d) {
    if (!d) return;
    if (d.assets) S.assets = d.assets;
    if (d.employees) S.employees = d.employees;
    if (d.assignments) S.assignments = d.assignments;
    if (d.settings) S.settings = d.settings;
  }
  function afterMutation(assetId) {
    api("bootstrap").then(function (d) {
      syncFromBootstrap(d); renderAll(); refreshEmployeeFilter();
      if (assetId && !$("#drawer").hidden) openAssetDetail(assetId);
    });
  }

  // ---- Drawer helpers ------------------------------
  var lastDrawerRender = null;
  function openDrawer() { $("#scrim").hidden = false; $("#drawer").hidden = false; }
  function closeDrawer() { $("#scrim").hidden = true; $("#drawer").hidden = true; }
  function reopenDrawer() { /* el contenido ya se re-renderiza desde quien llama */ }

  // ---- Arranque -----------------------------------
  function boot() {
    safe(initTheme, "initTheme");
    safe(initLogin, "initLogin");
    safe(initApp, "initApp");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
