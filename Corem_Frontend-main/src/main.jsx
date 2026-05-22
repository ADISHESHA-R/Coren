import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './utils/theme.js'
import './index.css'
import App from './App.jsx'
import 'bootstrap/dist/css/bootstrap.min.css';

initTheme();

class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      return (
        <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif', maxWidth: '42rem', margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.25rem' }}>App failed to load</h1>
          <p style={{ color: '#444' }}>
            Open DevTools (F12) → <strong>Console</strong> for details. If you used “Install app” or PWA on localhost before,
            try <strong>Application → Service Workers → Unregister</strong>, then hard refresh (Ctrl+Shift+R).
          </p>
          <pre
            style={{
              background: '#f5f5f5',
              padding: '1rem',
              overflow: 'auto',
              fontSize: '0.8rem',
              border: '1px solid #ddd',
            }}
          >
            {err?.stack || String(err?.message || err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<p style="padding:1rem">Missing #root in index.html</p>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  );
}
