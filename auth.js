const authModal = document.getElementById("authModal");
const authTitle = document.getElementById("authTitle");
const authAction = document.getElementById("authAction");
const switchMode = document.getElementById("switchMode");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const toggleAuth = document.getElementById("toggleAuth");

/** Absolute URL to api/<filename> — uses helport-api.js (load order in index.html). */
function apiUrl(filename) {
  if (typeof window.helportApiUrl === "function") return window.helportApiUrl(filename);
  return new URL("api/" + String(filename || "").replace(/^\//, ""), window.location.href).href;
}

function parseJsonResponse(txt) {
  const s = String(txt || "").replace(/^\uFEFF/, "").trim();
  return JSON.parse(s);
}

const SESSION_KEY = "helportai_session";
const USERS_KEY = "helportai_users";

let mode = "login";
let currentUser = null;
let serverAuthAvailable = false;

function setHelportGlobals(user, server) {
  currentUser = user;
  window.helportUser = user;
  window.helportServerAuth = !!server;
  window.helportIsServerAuthed = () => !!(server && user);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...user, server: !!server }));
  } catch (_) {}
}

function clearHelportGlobals() {
  currentUser = null;
  window.helportUser = null;
  window.helportServerAuth = false;
  window.helportIsServerAuthed = () => false;
  localStorage.removeItem(SESSION_KEY);
}

function hashLocal(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function seedLocalUsersOnce() {
  if (localStorage.getItem(USERS_KEY)) return;
  const users = [
    { username: "User", password: hashLocal("User@123"), role: "user" },
    { username: "Admin", password: hashLocal("Admin@123"), role: "admin" },
  ];
  saveUsers(users);
}

const roleSelect = document.createElement("select");
roleSelect.id = "roleSelect";
roleSelect.name = "role";
roleSelect.setAttribute("aria-label", "Account role");
roleSelect.innerHTML =
  '<option value="user">User</option><option value="admin">Admin (local demo only)</option>';
roleSelect.className = "auth-role-select";
roleSelect.style.display = "none";
authModal.querySelector(".auth-box").insertBefore(roleSelect, authAction);

function setConnectionBadge(text, ok) {
  let el = document.getElementById("helportConnBadge");
  if (!el) {
    el = document.createElement("span");
    el.id = "helportConnBadge";
    el.className = "conn-badge";
    const header = document.querySelector("header");
    const tag = header && header.querySelector(".tag");
    if (tag && tag.parentNode) tag.parentNode.insertBefore(el, tag);
    else if (header) header.appendChild(el);
  }
  el.textContent = text;
  el.classList.toggle("conn-badge--ok", !!ok);
  el.classList.toggle("conn-badge--warn", !ok);
}

function setMode(nextMode) {
  mode = nextMode;
  if (mode === "signup") {
    authTitle.textContent = "Sign Up";
    authAction.textContent = "Sign Up";
    roleSelect.style.display = serverAuthAvailable ? "none" : "block";
    toggleAuth.innerHTML = `Have an account? <a href="#" id="switchMode">Login</a>`;
  } else {
    authTitle.textContent = "Login";
    authAction.textContent = "Login";
    roleSelect.style.display = "none";
    toggleAuth.innerHTML = `No account? <a href="#" id="switchMode">Sign up</a>`;
  }
  document.getElementById("switchMode").addEventListener("click", switchModeHandler);
}

function switchModeHandler(e) {
  e.preventDefault();
  setMode(mode === "login" ? "signup" : "login");
}

switchMode.addEventListener("click", switchModeHandler);

async function fetchJSON(path, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  if (opts.body != null && !opts.headers) opts.headers = {};
  if (opts.body != null && typeof opts.body === "string" && !opts.headers["Content-Type"]) {
    opts.headers["Content-Type"] = "application/json";
  }
  const r = await fetch(apiUrl(path), opts);
  const txt = await r.text();
  try {
    return { ok: r.ok, status: r.status, data: parseJsonResponse(txt) };
  } catch (_) {
    return { ok: r.ok, status: r.status, data: { raw: txt } };
  }
}

async function tryServerLogin(username, password) {
  const { ok, data, status } = await fetchJSON("login.php", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  if (ok && data.success && data.user) return data.user;
  const msg = (data && data.error) || (data && data.raw) || "Login failed";
  if (status >= 500 || /database connection/i.test(String(msg))) {
    const resetUrl = new URL("api/ensure_local_admin.php", window.location.href).href;
    throw new Error(
      "MySQL is not running or the database is unreachable. In XAMPP, start MySQL (green), then try again.\n\n" +
        "To reset passwords to Admin / Admin@123 and User / User@123, open in your browser:\n" +
        resetUrl
    );
  }
  throw new Error(msg);
}

async function tryServerSignup(username, password) {
  const { ok, data, status } = await fetchJSON("signup.php", {
    method: "POST",
    body: JSON.stringify({ username, password, role: "user" }),
  });
  if (ok && data.success) return true;
  throw new Error((data && data.error) || (status === 405 ? "Server blocked signup" : "Sign up failed"));
}

async function serverLogout() {
  try {
    await fetchJSON("logout.php", { method: "POST", body: "{}" });
  } catch (_) {}
}

function applyRoleUI(role) {
  const exportBtn = document.getElementById("exportCsv");
  const clearBtn = document.getElementById("clearLog");
  if (role === "admin") {
    if (exportBtn) exportBtn.style.display = "inline-block";
    if (clearBtn) clearBtn.style.display = "inline-block";
  } else {
    if (exportBtn) exportBtn.style.display = "none";
    if (clearBtn) clearBtn.style.display = "none";
  }
  showUserInfo(role);
  window.dispatchEvent(
    new CustomEvent("helport-auth-change", {
      detail: { user: currentUser, server: !!window.helportServerAuth },
    })
  );
}

function showUserInfo(role) {
  const header = document.querySelector("header");
  let info = document.getElementById("userInfo");
  if (!info) {
    info = document.createElement("div");
    info.id = "userInfo";
    info.className = "user-info-bar";
    const name = document.createElement("span");
    name.id = "userName";
    const logoutBtn = document.createElement("button");
    logoutBtn.type = "button";
    logoutBtn.textContent = "Logout";
    logoutBtn.className = "primary user-logout-btn";
    logoutBtn.addEventListener("click", async () => {
      if (window.helportServerAuth) await serverLogout();
      clearHelportGlobals();
      location.reload();
    });
    info.appendChild(name);
    info.appendChild(logoutBtn);
    header.appendChild(info);
  }
  const uname = (currentUser && currentUser.username) || "";
  const src = window.helportServerAuth ? "Server" : "Offline";
  document.getElementById("userName").textContent = `${uname} (${role}) · ${src}`;
}

function hideAuthModal() {
  authModal.classList.add("hidden");
}

function showAuthModal() {
  authModal.classList.remove("hidden");
}

authAction.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!username || !password) {
    alert("Please fill out all fields.");
    return;
  }

  if (serverAuthAvailable) {
    authAction.disabled = true;
    try {
      if (mode === "signup") {
        await tryServerSignup(username, password);
        alert("Sign up successful! Please log in.");
        setMode("login");
      } else {
        const user = await tryServerLogin(username, password);
        setHelportGlobals(
          { id: user.id, username: user.username, role: user.role },
          true
        );
        hideAuthModal();
        applyRoleUI(user.role);
      }
    } catch (e) {
      alert(e.message || "Request failed");
    } finally {
      authAction.disabled = false;
    }
    return;
  }

  seedLocalUsersOnce();
  const users = getUsers();

  if (mode === "signup") {
    if (users.find((u) => u.username === username)) {
      alert("Username already exists!");
      return;
    }
    const role = roleSelect.value === "admin" ? "admin" : "user";
    users.push({ username, password: hashLocal(password), role });
    saveUsers(users);
    alert("Sign up successful! Please log in.");
    setMode("login");
    return;
  }

  const user = users.find((u) => u.username === username && u.password === hashLocal(password));
  if (!user) {
    alert("Invalid credentials!");
    return;
  }
  setHelportGlobals({ username: user.username, role: user.role, id: null }, false);
  hideAuthModal();
  applyRoleUI(user.role);
});

window.addEventListener("load", async () => {
  let payload = null;
  let apiOk = false;
  try {
    if (window.location.protocol === "file:") {
      apiOk = false;
    } else {
      const r = await fetch(apiUrl("check_session.php"), { method: "GET", credentials: "same-origin" });
      apiOk = r.ok;
      if (apiOk) {
        const txt = await r.text();
        try {
          payload = parseJsonResponse(txt);
        } catch (_) {
          apiOk = false;
        }
      }
    }
  } catch (_) {
    apiOk = false;
  }

  serverAuthAvailable = apiOk;

  if (apiOk && payload && payload.authenticated && payload.user) {
    const u = payload.user;
    setHelportGlobals({ id: u.id, username: u.username, role: u.role }, true);
    hideAuthModal();
    applyRoleUI(u.role);
    setConnectionBadge("DB connected", true);
    return;
  }

  if (apiOk) setConnectionBadge("DB ready — log in", true);
  else if (window.location.protocol === "file:")
    setConnectionBadge("Use http://localhost/…/ (open via Apache, not file)", false);
  else setConnectionBadge("Offline mode (no PHP)", false);

  const saved = localStorage.getItem(SESSION_KEY);
  if (saved) {
    try {
      const s = JSON.parse(saved);
      if (s && s.username && !s.server) {
        setHelportGlobals(s, false);
        hideAuthModal();
        applyRoleUI(s.role);
        return;
      }
    } catch (_) {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  showAuthModal();
  setMode("login");
});
