(function () {
  const key = "destina-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  function preference() {
    try {
      const value = localStorage.getItem(key);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#262722" : "#ECE8DD";
  }
  apply(preference() || (system.matches ? "dark" : "light"));
  document.addEventListener("click", function (event) {
    const button =
      event.target instanceof Element
        ? event.target.closest("[data-theme-toggle]")
        : null;
    if (!button) return;
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(key, next);
    } catch {}
  });
  system.addEventListener("change", function () {
    if (!preference()) apply(system.matches ? "dark" : "light");
  });
  window.addEventListener("storage", function (event) {
    if (event.key === key || event.key === null)
      apply(preference() || (system.matches ? "dark" : "light"));
  });
})();
