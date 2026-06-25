// Tiny progressive-enhancement helpers. Kept in a static file (not inline) so the
// Content-Security-Policy can forbid inline scripts.
(function () {
  // Rewrite server-rendered <time data-dt> timestamps to the device's local
  // timezone (the server can't know the viewer's zone). Falls back gracefully:
  // without JS, the AU-timezone text rendered by the server is shown as-is.
  document.querySelectorAll("time[data-dt]").forEach(function (el) {
    var d = new Date(el.getAttribute("datetime"));
    if (!isNaN(d.getTime())) {
      el.textContent = d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
    }
  });

  document.addEventListener("click", function (e) {
    var target = e.target;

    // Select all / clear buttons in Settings: data-select="all|none" data-target="<name>"
    var sel = target.closest("[data-select]");
    if (sel) {
      var name = sel.getAttribute("data-target");
      var check = sel.getAttribute("data-select") === "all";
      document
        .querySelectorAll('input[type="checkbox"][name="' + name + '"]')
        .forEach(function (cb) { cb.checked = check; });
      return;
    }

    // Reorder a settings column row: data-move="up|down" inside [data-column-row].
    var mv = target.closest("[data-move]");
    if (mv) {
      var item = mv.closest("[data-column-row]");
      if (item) {
        if (mv.getAttribute("data-move") === "up" && item.previousElementSibling) {
          item.parentNode.insertBefore(item, item.previousElementSibling);
        } else if (mv.getAttribute("data-move") === "down" && item.nextElementSibling) {
          item.parentNode.insertBefore(item.nextElementSibling, item);
        }
      }
      return;
    }

    // Whole-row click navigation: <tr data-href="..."> (ignore clicks on links).
    var row = target.closest("[data-href]");
    if (row && !target.closest("a")) {
      window.location.href = row.getAttribute("data-href");
    }
  });

  // Auto-submit the enclosing form when a [data-autosubmit] control changes.
  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-autosubmit]");
    if (el && el.form) el.form.submit();
  });

  // If an attachment thumbnail fails to load (e.g. a HEIC image in a browser
  // that can't render it, or a non-image blob), swap it for a download link.
  // `error` events don't bubble, so listen in the capture phase.
  document.addEventListener(
    "error",
    function (e) {
      var img = e.target;
      if (!img || img.tagName !== "IMG") return;
      var thumb = img.closest(".att-thumb");
      if (!thumb) return;
      thumb.classList.remove("att-thumb");
      thumb.classList.add("att-file-link");
      thumb.textContent = thumb.getAttribute("data-filename") || "Download attachment";
    },
    true,
  );
})();
