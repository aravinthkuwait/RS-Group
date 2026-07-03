import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// If anything in the app throws at runtime, show a friendly recovery screen
// instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('RS Group app error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#f4f7fb', fontFamily: 'Segoe UI, system-ui, sans-serif', padding: 20,
        }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '36px 40px', maxWidth: 440, textAlign: 'center', boxShadow: '0 12px 40px rgba(22,44,74,.15)' }}>
            <img src="/rs-group-logo.jpg" alt="RS Group" style={{ width: 72, borderRadius: 12 }} />
            <h2 style={{ color: '#163a6b', margin: '14px 0 8px' }}>Something went wrong</h2>
            <p style={{ color: '#4a5a6a', fontSize: 14, marginBottom: 18 }}>
              The page hit an unexpected error. Reloading usually fixes it —
              your data is safe on the server.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ background: '#1e4d8c', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 26px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            >
              ⟳ Reload App
            </button>
            <div style={{ color: '#8494a4', fontSize: 12, marginTop: 14 }}>
              If it keeps happening, take a screenshot of this and report it.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
