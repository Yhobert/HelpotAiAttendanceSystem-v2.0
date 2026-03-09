const authModal = document.getElementById("authModal");
const authTitle = document.getElementById("authTitle");
const authAction = document.getElementById("authAction");
const switchMode = document.getElementById("switchMode");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const toggleAuth = document.getElementById("toggleAuth");
const openLoginBtn = document.getElementById("openLogin");

let mode = "login";
let currentUser = null;

const USERS_KEY = "helportai_users";
const SESSION_KEY = "helportai_session";

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function hash(str) {
  return btoa(str);
}

// === Default accounts (requested) ===
// User:  User / User@123
// Admin: Admin / Admin@123
(() => {
  // Reset all stored credentials to only these two accounts
  const users = [
    { username: "User", password: hash("User@123"), role: "user" },
    { username: "Admin", password: hash("Admin@123"), role: "admin" }
  ];
  saveUsers(users);

  // If a saved session doesn't match these accounts, clear it
  try {
    const session = localStorage.getItem(SESSION_KEY);
    if (session) {
      const s = JSON.parse(session);
      const ok = users.some(u => u.username === s.username && u.role === s.role);
      if (!ok) localStorage.removeItem(SESSION_KEY);
    }
  } catch (_) {
    localStorage.removeItem(SESSION_KEY);
  }
})();

// === Role Dropdown for Signup ===
const roleSelect = document.createElement("select");
roleSelect.id = "roleSelect";
roleSelect.innerHTML = `
  <option value="user">User</option>
  <option value="admin">Admin</option>
`;
roleSelect.style.display = "none";
roleSelect.style.margin = "10px 0";
roleSelect.style.padding = "8px";
roleSelect.style.borderRadius = "8px";
roleSelect.style.background = "rgba(255,255,255,0.05)";
roleSelect.style.color = "white";
roleSelect.style.border = "1px solid rgba(255,255,255,0.1)";
authModal.querySelector(".auth-box").insertBefore(roleSelect, authAction);

function setMode(nextMode) {
  mode = nextMode;
  if (mode === "signup") {
    authTitle.textContent = "Sign Up";
    authAction.textContent = "Sign Up";
    roleSelect.style.display = "block";
    toggleAuth.innerHTML = `Have an account? <a href="#" id="switchMode">Login</a>`;
  } else {
    authTitle.textContent = "Login";
    authAction.textContent = "Login";
    roleSelect.style.display = "none";
    toggleAuth.innerHTML = `No account? <a href="#" id="switchMode">Sign up</a>`;
  }
  document.getElementById("switchMode").addEventListener("click", switchMode.click);
}

// === Switch Login / Signup Mode ===
switchMode.addEventListener("click", e => {
  e.preventDefault();
  setMode(mode === "login" ? "signup" : "login");
});

// === Open login modal from header button ===
if (openLoginBtn) {
  openLoginBtn.addEventListener("click", () => {
    setMode("login");
    usernameInput.value = "";
    passwordInput.value = "";
    authModal.classList.remove("hidden");
    usernameInput.focus();
  });
}

// === Handle Login/Signup ===
authAction.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const role = roleSelect.value;

  if (!username || !password) {
    alert("Please fill out all fields.");
    return;
  }

  const users = getUsers();

  if (mode === "signup") {
    if (users.find(u => u.username === username)) {
      alert("Username already exists!");
      return;
    }

    users.push({ username, password: hash(password), role });
    saveUsers(users);
    alert("Sign up successful! Please log in.");
    setMode("login");

  } else {
    const user = users.find(u => u.username === username && u.password === hash(password));
    if (!user) {
      alert("Invalid credentials!");
      return;
    }

    currentUser = user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    authModal.classList.add("hidden");
    applyRoleUI(user.role);
  }

});

// === Auto-login if session exists ===
window.addEventListener("load", () => {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    currentUser = JSON.parse(session);
    authModal.classList.add("hidden");
    applyRoleUI(currentUser.role);
  } else {
    authModal.classList.remove("hidden");
  }
});

// === Apply role-based UI ===
function applyRoleUI(role) {
  const exportBtn = document.getElementById("exportCsv");
  const clearBtn = document.getElementById("clearLog");
  if (role === "admin") {
    exportBtn.style.display = "inline-block";
    clearBtn.style.display = "inline-block";
  } else {
    exportBtn.style.display = "none";
    clearBtn.style.display = "none";
  }
  showUserInfo(role);
}

// === Show username & logout ===
function showUserInfo(role) {
  const header = document.querySelector("header");
  let info = document.getElementById("userInfo");
  if (!info) {
    info = document.createElement("div");
    info.id = "userInfo";
    info.style.marginLeft = "auto";
    info.style.display = "flex";
    info.style.alignItems = "center";
    info.style.gap = "10px";

    const name = document.createElement("span");
    name.id = "userName";
    name.style.fontSize = "14px";
    name.style.color = "#9aa4b2";

    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Logout";
    logoutBtn.classList.add("primary");
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    });

    info.appendChild(name);
    info.appendChild(logoutBtn);
    header.appendChild(info);
  }

  document.getElementById("userName").textContent =
    `${currentUser.username} (${role})`;
}
