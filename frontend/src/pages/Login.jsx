import { useState } from "react";

import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../auth/AuthContext";

function Login() {
  const { login } = useAuth();

  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [errors, setErrors] = useState({});

  const [formError, setFormError] = useState("");

  const [busy, setBusy] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    const nextErrors = {};

    if (!username.trim()) {
      nextErrors.username = "Enter your username.";
    }

    if (!password) {
      nextErrors.password = "Enter your password.";
    }

    setErrors(nextErrors);
    setFormError("");

    const firstError = Object.keys(nextErrors)[0];

    if (firstError) {
      document.getElementById(firstError)?.focus();

      return;
    }

    try {
      setBusy(true);

      await login(username.trim(), password);
    } catch {
      setFormError("Username or password is incorrect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">NF</div>

          <div>
            <strong>NetFault AI</strong>

            <span>Network monitoring</span>
          </div>
        </div>

        <div className="login-heading">
          <h1>Welcome back</h1>

          <p>Access your network dashboard.</p>
        </div>

        {formError && (
          <div className="login-error" role="alert">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="username">USERNAME</label>

            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              aria-invalid={Boolean(errors.username)}
              aria-describedby={errors.username ? "username-error" : undefined}
            />

            {errors.username && (
              <span id="username-error" className="field-error" role="alert">
                {errors.username}
              </span>
            )}
          </div>

          <div className="login-field">
            <label htmlFor="password">PASSWORD</label>

            <div className="password-input">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "password-error" : undefined
                }
              />

              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {errors.password && (
              <span id="password-error" className="field-error" role="alert">
                {errors.password}
              </span>
            )}
          </div>

          <button type="submit" className="login-submit" disabled={busy}>
            {busy ? "SIGNING IN..." : "SIGN IN"}
          </button>
        </form>

        <div className="login-footer">NETWORK MONITORING PLATFORM</div>
      </div>
    </main>
  );
}

export default Login;
