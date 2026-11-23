let catalogData = { plans: [], addons: [] };

function showBanner(text, kind = "ok") {
  const el = document.getElementById("banner");
  el.textContent = text;
  el.className = `banner ${kind}`;
}

async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data));
  }
  return data;
}

function formatPrice(cents, currency = "EUR") {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format((cents || 0) / 100);
}

async function loadStatus() {
  const bar = document.getElementById("status-bar");
  try {
    const s = await apiJson("/api/shop/status");
    const msmPill = s.msm.ok
      ? `<span class="pill pill-ok">MSM OK (${s.msm.integration})</span>`
      : `<span class="pill pill-err">MSM: ${s.msm.error || "offline"}</span>`;
    const stripePill = s.stripe_configured
      ? `<span class="pill pill-ok">Stripe Sandbox aktiv</span>`
      : `<span class="pill pill-warn">Stripe Key fehlt</span>`;
    const whPill = s.msm_webhook_configured
      ? `<span class="pill pill-ok">MSM Webhook Secret gesetzt</span>`
      : `<span class="pill pill-warn">MSM Webhook Secret fehlt</span>`;
    bar.innerHTML = `${msmPill}${stripePill}${whPill}`;
  } catch (err) {
    bar.innerHTML = `<span class="pill pill-err">Statusfehler: ${err.message}</span>`;
  }
}

function renderPlanVariables(plan) {
  const box = document.getElementById("variables-box");
  const vars = (plan && Array.isArray(plan.variables)) ? plan.variables.filter((v) => v.customer_editable !== false) : [];
  if (!vars.length) {
    box.className = "full-width hidden";
    box.innerHTML = "";
    return;
  }
  box.className = "full-width form-grid";
  box.innerHTML = vars
    .map(
      (v) => `
      <label>
        <span>Start-Variable: ${v.label || v.key}</span>
        <input type="text" data-var-key="${v.key}" value="${v.default ?? ""}" placeholder="${v.key}" />
      </label>`
    )
    .join("");
}

async function loadCatalog() {
  const grid = document.getElementById("plans-grid");
  const planSelect = document.getElementById("select-plan");
  const addonSelect = document.getElementById("select-addon");
  try {
    catalogData = await apiJson("/api/shop/catalog");
    const plans = catalogData.plans || [];
    const addons = catalogData.addons || [];

    if (!plans.length) {
      grid.innerHTML = `<div class="empty">Keine aktiven Tarife im MSM-Katalog gefunden.</div>`;
    } else {
      grid.innerHTML = plans
        .map(
          (p) => `
          <div class="plan-card" data-plan-id="${p.plan_id}">
            <div>
              <strong>${p.name}</strong>
              <div class="muted">${p.product_key} · ${p.game_type || p.blueprint_id || "Server"}</div>
              <p class="muted" style="margin-top:6px;">
                RAM: ${p.ram_included_mb ?? p.ram_mb ?? "-"} MB (max ${p.ram_max_mb ?? "-"})<br/>
                CPU: ${p.cpu_included_percent ?? p.cpu_percent ?? "-"}% · Slots: ${p.slots_included ?? "-"}
              </p>
            </div>
            <div>
              <div class="plan-price">${formatPrice(p.price_cents, p.currency || "EUR")} / Monat</div>
              <button type="button" class="btn btn-secondary" style="margin-top:8px;" onclick="selectPlan(${p.plan_id})">Auswählen</button>
            </div>
          </div>`
        )
        .join("");
    }

    planSelect.innerHTML = plans
      .map((p) => `<option value="${p.plan_id}">${p.name} (${formatPrice(p.price_cents, p.currency)})</option>`)
      .join("");
    addonSelect.innerHTML = `<option value="">Kein Add-on</option>` + addons
      .map((a) => `<option value="${a.slug}">${a.name} (${formatPrice(a.price_cents, a.currency || "EUR")})</option>`)
      .join("");

    renderPlanVariables(plans[0]);
  } catch (err) {
    grid.innerHTML = `<div class="empty">Katalog nicht ladbar: ${err.message}</div>`;
  }
}

window.selectPlan = (planId) => {
  const select = document.getElementById("select-plan");
  select.value = String(planId);
  const plan = (catalogData.plans || []).find((p) => p.plan_id === planId);
  renderPlanVariables(plan);
};

async function loadContracts() {
  const list = document.getElementById("contracts-list");
  try {
    const contracts = await apiJson("/api/shop/contracts");
    if (!contracts.length) {
      list.innerHTML = `<div class="empty">Noch keine Verträge vorhanden.</div>`;
      return;
    }
    list.innerHTML = contracts
      .map(
        (c) => `
        <div class="contract-card">
          <div class="contract-head">
            <div>
              <strong>${c.external_service_id}</strong> (${c.item_kind})
              <span class="muted"> · Kunde: ${c.external_subject} · Server-ID: ${c.msm_server_id ?? "-"}</span>
            </div>
            <div>
              <span class="pill pill-muted">Zahlung: ${c.payment_status}</span>
              <span class="pill ${c.msm_status === "ready" ? "pill-ok" : c.msm_status === "failed" ? "pill-err" : "pill-warn"}">MSM: ${c.msm_status}</span>
            </div>
          </div>
          <div class="muted">
            Produkt: <code>${c.product_key || c.addon_slug || "-"}</code> · Ziel: <code>${c.desired_state}</code>
            ${c.msm_status_code ? ` · Hinweis: <code>${c.msm_status_code}</code>` : ""}
            ${c.msm_terminate_after ? ` · Löschung nach: <code>${c.msm_terminate_after}</code>` : ""}
          </div>
          <div class="contract-actions">
            <button class="btn btn-secondary" onclick="refreshContract('${c.external_service_id}')">Status abrufen</button>
            <button class="btn btn-primary" onclick="openHandoff('${c.external_service_id}')">Im Panel verwalten (Handoff)</button>
            <button class="btn btn-secondary" onclick="upgradePrompt('${c.external_service_id}')">Upgrade / Tarifwechsel</button>
            <button class="btn btn-warn" onclick="setContractState('${c.external_service_id}', 'suspended', false)">Mahnsperre (suspend)</button>
            <button class="btn btn-secondary" onclick="setContractState('${c.external_service_id}', 'active', false)">Reaktivieren (active)</button>
            <button class="btn btn-danger" onclick="setContractState('${c.external_service_id}', 'terminated', false)">Kündigen (Schonfrist)</button>
            <button class="btn btn-danger" onclick="setContractState('${c.external_service_id}', 'terminated', true)">Sofort löschen</button>
          </div>
        </div>`
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="empty">Fehler: ${err.message}</div>`;
  }
}

window.refreshContract = async (id) => {
  try {
    await apiJson(`/api/shop/contracts/${id}/refresh`, { method: "POST" });
    showBanner(`Vertrag ${id} aktualisiert.`);
    await loadContracts();
  } catch (err) {
    showBanner(err.message, "err");
  }
};

window.openHandoff = async (id) => {
  try {
    const res = await apiJson(`/api/shop/contracts/${id}/handoff`, { method: "POST", body: "{}" });
    window.open(res.url, "_blank", "noopener");
  } catch (err) {
    showBanner(err.message, "err");
  }
};

window.upgradePrompt = async (id) => {
  const ramStr = window.prompt("Neue RAM-Größe in MB (leer lassen für unverändert):", "4096");
  const planStr = window.prompt("Neuer product_key (z. B. plan:2, leer lassen für unverändert):", "");
  if (ramStr === null && planStr === null) return;
  const body = {};
  if (ramStr && Number(ramStr) > 0) body.ram_mb = Number(ramStr);
  if (planStr && planStr.trim()) body.product_key = planStr.trim();
  try {
    await apiJson(`/api/shop/contracts/${id}/upgrade`, { method: "POST", body: JSON.stringify(body) });
    showBanner(`Upgrade/Tarifwechsel für ${id} gesendet.`);
    await loadContracts();
  } catch (err) {
    showBanner(err.message, "err");
  }
};

window.setContractState = async (id, desiredState, purgeImmediately) => {
  try {
    await apiJson(`/api/shop/contracts/${id}/state`, {
      method: "POST",
      body: JSON.stringify({ desired_state: desiredState, purge_immediately: purgeImmediately }),
    });
    showBanner(`Vertrag ${id} -> ${desiredState}${purgeImmediately ? " (sofort)" : ""}.`);
    await loadContracts();
  } catch (err) {
    showBanner(err.message, "err");
  }
};

async function loadWebhooks() {
  const list = document.getElementById("webhooks-list");
  try {
    const events = await apiJson("/api/shop/webhooks");
    if (!events.length) {
      list.innerHTML = `<div class="empty">Noch keine Webhooks empfangen.</div>`;
      return;
    }
    list.innerHTML = events
      .map(
        (ev) => `
        <div class="webhook-card">
          <div class="contract-head">
            <strong>[${ev.source.toUpperCase()}] ${ev.event_type}</strong>
            <span class="pill ${ev.signature_valid ? "pill-ok" : "pill-err"}">
              ${ev.signature_valid ? "Signatur gültig" : "Signatur ungültig"}
            </span>
          </div>
          <div class="muted">${ev.received_at} · Service: ${ev.external_service_id || "-"}</div>
          <pre>${JSON.stringify(ev.payload, null, 2)}</pre>
        </div>`
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<div class="empty">Webhook-Log nicht ladbar: ${err.message}</div>`;
  }
}

document.getElementById("select-plan").addEventListener("change", (e) => {
  const plan = (catalogData.plans || []).find((p) => p.plan_id === Number(e.target.value));
  renderPlanVariables(plan);
});

document.getElementById("checkout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const variables = {};
  document.querySelectorAll("[data-var-key]").forEach((input) => {
    if (input.value !== "") variables[input.dataset.varKey] = input.value;
  });
  const payload = {
    external_subject: document.getElementById("input-subject").value.trim(),
    email: document.getElementById("input-email").value.trim(),
    plan_id: Number(document.getElementById("select-plan").value),
    addon_slug: document.getElementById("select-addon").value || null,
    ram_mb: document.getElementById("input-ram").value ? Number(document.getElementById("input-ram").value) : null,
    slots: document.getElementById("input-slots").value ? Number(document.getElementById("input-slots").value) : null,
    mode: document.getElementById("select-mode").value,
    variables,
  };
  try {
    const res = await apiJson("/api/shop/checkout", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.checkout_url) {
      window.location.href = res.checkout_url;
    } else {
      showBanner(`Checkout erstellt (${res.session_id}), aber keine Checkout-URL erhalten.`, "err");
    }
  } catch (err) {
    showBanner(err.message, "err");
  }
});

document.getElementById("btn-reload-catalog").addEventListener("click", loadCatalog);
document.getElementById("btn-reload-contracts").addEventListener("click", loadContracts);
document.getElementById("btn-reload-webhooks").addEventListener("click", loadWebhooks);

const params = new URLSearchParams(window.location.search);
if (params.get("checkout") === "success") {
  showBanner(`Stripe-Zahlung erfolgreich (${params.get("session_id")}). Provisionierung gestartet.`);
} else if (params.get("checkout") === "error") {
  showBanner(`Stripe-Rückkehr mit Fehler: ${params.get("reason") || "unbekannt"}`, "err");
}

loadStatus();
loadCatalog();
loadContracts();
loadWebhooks();
