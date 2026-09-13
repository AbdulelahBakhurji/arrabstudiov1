(() => {
  const form = document.getElementById("auth-form");
  const success = document.getElementById("success");
  const statusEl = document.getElementById("status");
  const submit = document.getElementById("submit");
  const stateInput = document.getElementById("state");
  const desktopHint = document.getElementById("desktop-hint");
  const passwordInput = document.getElementById("password");
  const displayNameInput = document.getElementById("displayName");
  const headline = document.getElementById("headline");
  const segment = document.querySelector(".segment");

  const params = new URLSearchParams(window.location.search);
  const state = (params.get("state") || "").trim();
  if (state) {
    stateInput.value = state;
    desktopHint.hidden = false;
  }

  let mode = "signin";
  document.body.dataset.mode = mode;

  function setMode(next) {
    mode = next;
    document.body.dataset.mode = mode;
    document.querySelectorAll(".seg").forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    headline.textContent = state
      ? mode === "create"
        ? "Create and link Studio"
        : "Sign in to link Studio"
      : mode === "create"
        ? "Create your account"
        : "Sign in";
    submit.textContent = "Continue";
    passwordInput.autocomplete = mode === "create" ? "new-password" : "current-password";
    statusEl.textContent = "";
    statusEl.className = "status";
  }

  document.querySelectorAll(".seg").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  function showError(message) {
    statusEl.className = "status is-error";
    statusEl.textContent = message;
  }

  function showOk(message) {
    statusEl.className = "status is-ok";
    statusEl.textContent = message;
  }

  async function api(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        (response.status === 401 ? "Invalid email or password" : "Request failed");
      throw new Error(message);
    }
    return payload;
  }

  function finish(payload, kind) {
    form.hidden = true;
    if (segment) segment.hidden = true;
    success.hidden = false;
    const email = payload?.account?.email || "";
    const name = payload?.account?.displayName || "";
    document.getElementById("success-title").textContent =
      kind === "create" ? "Account created" : kind === "desktop" ? "Studio linked" : "Signed in";
    document.getElementById("success-body").textContent = name
      ? `${name} · ${email}`
      : email;

    const tokenBox = document.getElementById("token-box");
    tokenBox.hidden = true;

    const token = payload?.sessionToken;
    if (state) {
      if (token) {
        tokenBox.hidden = false;
        document.getElementById("session-token").textContent = token;
      }
      return;
    }

    try {
      sessionStorage.setItem(
        "arrab.session",
        JSON.stringify({
          token: token || "",
          account: payload?.account || null,
          at: new Date().toISOString(),
        }),
      );
      localStorage.removeItem("arrab.session");
    } catch {
      // storage blocked — stay on success
    }

    statusEl.className = "status is-ok";
    statusEl.textContent = "Opening your workspace…";
    setTimeout(() => {
      window.location.assign("/app");
    }, 450);
  }

  document.getElementById("copy-token").addEventListener("click", async () => {
    const token = document.getElementById("session-token").textContent;
    try {
      await navigator.clipboard.writeText(token);
      showOk("Copied");
    } catch {
      showError("Could not copy — select the token manually");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    statusEl.textContent = "";
    statusEl.className = "status";

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;
    const displayName = displayNameInput.value.trim();

    if (password.length < 8) {
      showError("Password must be at least 8 characters");
      return;
    }

    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = "Please wait…";

    try {
      let payload;
      let kind = mode;

      if (state) {
        payload = await api("/v1/account/auth/web/complete", {
          state,
          email,
          password,
          displayName: displayName || undefined,
        });
        kind = "desktop";
      } else if (mode === "create") {
        payload = await api("/v1/account/connect", {
          email,
          password,
          displayName: displayName || undefined,
        });
        kind = "create";
      } else {
        payload = await api("/v1/account/sign-in", {
          email,
          password,
        });
        kind = "signin";
      }

      finish(payload, kind);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong";
      if (/already connected/i.test(message) && mode === "create") {
        showError("An account already exists. Use Sign in.");
        setMode("signin");
      } else {
        showError(message);
      }
    } finally {
      submit.disabled = false;
      submit.textContent = original;
    }
  });

  setMode("signin");
})();
