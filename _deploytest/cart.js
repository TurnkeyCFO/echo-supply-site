/* faith-apparel — minimal storefront JS. Single-item flow via Stripe Payment Links. */
(function () {
  "use strict";

  var ADULT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
  var YOUTH_SIZES = ["YXS", "YS", "YM", "YL", "YXL"];
  var TODDLER_SIZES = ["2T", "3T", "4T", "5T"];

  var AUDIENCE_ORDER = ["adult", "youth", "toddler"];
  var AUDIENCE_LABELS = { adult: "Adult", youth: "Youth", toddler: "Toddler" };

  function sizesFor(audience) {
    if (audience === "adult") return ADULT_SIZES;
    if (audience === "youth") return YOUTH_SIZES;
    if (audience === "toddler") return TODDLER_SIZES;
    return [];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Tiny safe-ish markdown: bold + italic only, escapes everything else.
  function renderMd(md) {
    var s = escapeHtml(md || "");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/\n\n+/g, "</p><p>");
    return "<p>" + s + "</p>";
  }

  // Body-scroll lock state. We save the previous overflow / paddingRight (to
  // compensate for the disappearing scrollbar) and restore on close. Works
  // cross-browser including iOS Safari, where setting body.overflow=hidden is
  // sufficient when combined with the <dialog> element's own focus trap.
  var _scrollLockState = null;
  function lockBodyScroll() {
    if (_scrollLockState) return;
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    _scrollLockState = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight,
    };
    document.body.style.overflow = "hidden";
    if (sbw > 0) document.body.style.paddingRight = sbw + "px";
  }
  function unlockBodyScroll() {
    if (!_scrollLockState) return;
    document.body.style.overflow = _scrollLockState.overflow;
    document.body.style.paddingRight = _scrollLockState.paddingRight;
    _scrollLockState = null;
  }

  // SEO trade-off note: per-product OG meta tags are NOT pre-baked into the
  // static HTML (would explode rendered file count for a static SPA). Instead
  // we mutate document.title and og:title at modal-open time so social share
  // crawlers that execute JS pick up the right metadata; pure-HTML crawlers
  // see the store-level fallback.
  var _titleState = null;
  function setProductMeta(p) {
    if (_titleState) return; // already overridden
    var storeName = (window.STORE_CONFIG && window.STORE_CONFIG.store_name) || "";
    _titleState = {
      title: document.title,
      og: (document.querySelector('meta[property="og:title"]') || {}).content || "",
    };
    document.title = p.name + (storeName ? " – " + storeName : "");
    var og = document.querySelector('meta[property="og:title"]');
    if (og) og.setAttribute("content", p.name + (storeName ? " – " + storeName : ""));
  }
  function restoreMeta() {
    if (!_titleState) return;
    document.title = _titleState.title;
    var og = document.querySelector('meta[property="og:title"]');
    if (og) og.setAttribute("content", _titleState.og);
    _titleState = null;
  }

  function init() {
    var cfg = window.STORE_CONFIG;
    if (!cfg) return;

    // About
    var about = document.getElementById("about-body");
    if (about) about.innerHTML = renderMd(cfg.about_md);

    // Product grid
    var grid = document.getElementById("product-grid");
    if (!grid) return;
    grid.innerHTML = "";
    cfg.products.forEach(function (p, idx) {
      var btn = document.createElement("button");
      btn.className = "product-card";
      btn.type = "button";
      btn.setAttribute("aria-label", "View " + p.name);
      btn.dataset.idx = String(idx);
      var lowestPrice = Math.min.apply(null, p.variants.map(function (v) { return v.price_usd; }));
      btn.innerHTML =
        '<img src="' + escapeHtml(p.mockups[0]) + '" alt="' + escapeHtml(p.name) + '" loading="lazy" width="600" height="600" />' +
        '<div class="pc-body"><h3>' + escapeHtml(p.name) + "</h3>" +
        '<p class="pc-price">From $' + lowestPrice + "</p></div>";
      btn.addEventListener("click", function () { openModal(idx); });
      grid.appendChild(btn);
    });

    // Modal wiring
    var modal = document.getElementById("product-modal");
    modal.querySelectorAll("[data-close]").forEach(function (el) {
      el.addEventListener("click", function () { modal.close(); });
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.close();
    });
    modal.addEventListener("close", function () {
      unlockBodyScroll();
      restoreMeta();
      // Strip ?product= from URL on close so a back-press won't re-open it.
      try {
        var u = new URL(window.location.href);
        if (u.searchParams.has("product")) {
          u.searchParams.delete("product");
          window.history.replaceState({}, "", u.toString());
        }
      } catch (_) { /* older browsers */ }
    });
    document.getElementById("size-select").addEventListener("change", refreshBuyLink);

    // Size guide dialog wiring
    var sizeChart = document.getElementById("size-chart-dialog");
    var sizeBtn = document.getElementById("size-guide-btn");
    if (sizeBtn && sizeChart) {
      sizeBtn.addEventListener("click", function () {
        if (typeof sizeChart.showModal === "function") sizeChart.showModal();
        else sizeChart.setAttribute("open", "");
      });
      sizeChart.querySelectorAll("[data-close-size-chart]").forEach(function (el) {
        el.addEventListener("click", function () { sizeChart.close(); });
      });
      sizeChart.addEventListener("click", function (e) {
        if (e.target === sizeChart) sizeChart.close();
      });
      // Note: size-chart open does NOT body-scroll-lock again — product modal
      // already holds the lock and the size-chart sits on top of it.
    }

    // ?product=<design_id> deep-link auto-open
    try {
      var qp = new URL(window.location.href).searchParams.get("product");
      if (qp) {
        var matchIdx = cfg.products.findIndex(function (p) { return p.id === qp; });
        if (matchIdx >= 0) openModal(matchIdx);
      }
    } catch (_) { /* older browsers */ }
  }

  var currentProductIdx = 0;
  var currentAudience = "adult";

  function audiencesFor(p) {
    // Return the trichotomy audiences that have at least one variant on this product,
    // preserving canonical Adult → Youth → Toddler order.
    var present = {};
    (p.variants || []).forEach(function (v) {
      if (v.stripe_payment_link) present[v.audience] = true;
    });
    return AUDIENCE_ORDER.filter(function (a) { return present[a]; });
  }

  function priceForAudience(p, audience) {
    var match = (p.variants || []).find(function (v) {
      return v.audience === audience && v.stripe_payment_link;
    });
    return match ? match.price_usd : null;
  }

  function renderAudienceButtons(p) {
    // Build segmented Adult · Youth · Toddler buttons; only render audiences
    // with at least one variant (graceful degrade when toddler is unavailable).
    var wrap = document.getElementById("audience-segmented");
    if (!wrap) return;
    var auds = audiencesFor(p);
    wrap.innerHTML = "";
    auds.forEach(function (aud) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "audience-btn";
      b.setAttribute("role", "tab");
      b.setAttribute("data-audience", aud);
      var price = priceForAudience(p, aud);
      b.innerHTML =
        '<span class="audience-label">' + AUDIENCE_LABELS[aud] + '</span>' +
        (price != null ? '<span class="audience-price">$' + price + '</span>' : '');
      b.addEventListener("click", function () { selectAudience(aud); });
      wrap.appendChild(b);
    });
    // Default to first available audience
    if (auds.length) selectAudience(auds[0]);
  }

  function selectAudience(aud) {
    currentAudience = aud;
    var wrap = document.getElementById("audience-segmented");
    if (wrap) {
      wrap.querySelectorAll(".audience-btn").forEach(function (b) {
        var active = b.getAttribute("data-audience") === aud;
        b.setAttribute("aria-selected", active ? "true" : "false");
        b.classList.toggle("is-active", active);
      });
    }
    refreshVariant();
  }

  function openModal(idx) {
    currentProductIdx = idx;
    var p = window.STORE_CONFIG.products[idx];
    document.getElementById("modal-title").textContent = p.name;
    document.getElementById("modal-desc").textContent = p.description || "";

    // Gallery
    var thumbs = document.getElementById("gallery-thumbs");
    var main = document.getElementById("gallery-main");
    thumbs.innerHTML = "";
    main.src = p.mockups[0];
    main.alt = p.name;
    p.mockups.forEach(function (src, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", i === 0 ? "true" : "false");
      b.innerHTML = '<img src="' + escapeHtml(src) + '" alt="View ' + (i + 1) + '" />';
      b.addEventListener("click", function () {
        main.src = src;
        thumbs.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
      });
      thumbs.appendChild(b);
    });

    // Build audience segmented buttons (also picks default audience + refreshes sizes)
    renderAudienceButtons(p);

    var dlg = document.getElementById("product-modal");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    lockBodyScroll();
    setProductMeta(p);
    // Update ?product= so refreshes / shares deep-link to this product.
    try {
      var u = new URL(window.location.href);
      if (u.searchParams.get("product") !== p.id) {
        u.searchParams.set("product", p.id);
        window.history.replaceState({}, "", u.toString());
      }
    } catch (_) { /* older browsers */ }
  }

  function refreshVariant() {
    var p = window.STORE_CONFIG.products[currentProductIdx];
    var aud = currentAudience;
    // Sizes that have a Payment Link for this product+audience
    var available = (p.variants || [])
      .filter(function (v) { return v.audience === aud && v.stripe_payment_link; })
      .map(function (v) { return v.size; });
    // Preserve canonical order
    var canonical = sizesFor(aud);
    var ordered = canonical.filter(function (s) { return available.indexOf(s) !== -1; });
    if (!ordered.length) ordered = available;
    var sel = document.getElementById("size-select");
    sel.innerHTML = ordered.map(function (s) {
      return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + "</option>";
    }).join("");
    refreshBuyLink();
  }

  function refreshBuyLink() {
    var p = window.STORE_CONFIG.products[currentProductIdx];
    var aud = currentAudience;
    var sel = document.getElementById("size-select");
    var size = sel && sel.value;
    var variant = (p.variants || []).find(function (v) {
      return v.audience === aud && v.size === size;
    });
    var btn = document.getElementById("buy-btn");
    if (variant && variant.stripe_payment_link) {
      btn.href = variant.stripe_payment_link;
      btn.removeAttribute("aria-disabled");
      btn.textContent = "Buy now — $" + variant.price_usd;
    } else {
      btn.href = "#";
      btn.setAttribute("aria-disabled", "true");
      btn.textContent = "Sold out";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
