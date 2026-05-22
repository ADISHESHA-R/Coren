function LoginForm({ email, password, loading, onEmailChange, onPasswordChange, onSubmit }) {
  return (
    <form onSubmit={onSubmit} className="login-form">
      <div className="mb-3 text-start">
        <label htmlFor="email" className="form-label fw-semibold">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="form-control form-control-lg"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="name@company.com"
          autoComplete="username"
          required
        />
      </div>

      <div className="mb-2 text-start">
        <label htmlFor="password" className="form-label fw-semibold">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="form-control form-control-lg"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          required
        />
      </div>

      <button type="submit" className="btn btn-primary btn-lg w-100 mt-3" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}

export default LoginForm;
