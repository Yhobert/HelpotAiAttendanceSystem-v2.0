/**
 * Resolves api/*.php URLs when the page URL has no trailing slash (e.g. /att.System1
 * instead of /att.System1/). Using new URL('api/', location.href) in that case wrongly
 * points at /api/ on the host root.
 *
 * Optional: set window.__HELPORT_API_BASE__ to the full api folder URL (with trailing slash).
 */
(function () {
  function appDirectoryUrl() {
    let path = window.location.pathname || "/";
    const last = path.split("/").pop() || "";
    if (/\.(html?|php)$/i.test(last)) {
      path = path.slice(0, path.lastIndexOf("/") + 1);
    } else if (!path.endsWith("/")) {
      path += "/";
    }
    return window.location.origin + path;
  }

  window.helportAppDirectoryUrl = appDirectoryUrl;

  window.helportApiUrl = function (filename) {
    const name = String(filename || "").replace(/^\//, "");
    if (typeof window.__HELPORT_API_BASE__ === "string" && window.__HELPORT_API_BASE__.trim()) {
      const base = window.__HELPORT_API_BASE__.trim().replace(/\/$/, "") + "/";
      return new URL(name, base).href;
    }
    return new URL("api/" + name, appDirectoryUrl()).href;
  };
})();
