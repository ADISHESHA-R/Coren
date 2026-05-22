function LoginResult({ result }) {
  if (!result) {
    return null;
  }

  return (
    <div className="login-result text-start mt-4">
      <div className="d-flex align-items-center gap-2 mb-2">
        <span className="status-dot" />
        <strong>Login successful</strong>
      </div>
      <p className="mb-1">
        <strong>Detected Role:</strong> {result.role}
      </p>
      <p className="mb-1">
        <strong>Token Type:</strong> {result.tokenType}
      </p>
      <p className="mb-1">
        <strong>Expires In:</strong> {result.expiresIn} ms
      </p>
      <p className="mb-1 token-line">
        <strong>Access Token:</strong> {result.accessToken}
      </p>
      <p className="mb-0 token-line">
        <strong>Refresh Token:</strong> {result.refreshToken}
      </p>
    </div>
  );
}

export default LoginResult;
