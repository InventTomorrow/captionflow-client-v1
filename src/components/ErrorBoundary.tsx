import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Without this, any uncaught render-time throw anywhere in the tree (a bad
 * destructure, a null dereference, a third-party lib throwing) unmounts the
 * whole app to a blank white screen with no recovery UI and nothing logged
 * anywhere observable in production. React only supports catching these via
 * a class component — there is no hook equivalent.
 *
 * Inline styles on purpose: this is the last line of defense, so it must
 * render something even if index.css itself failed to load or the class
 * names it needs have drifted.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#FFFFFF',
            background: '#0B141E',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0, color: '#B6BBC7', maxWidth: '32rem' }}>
            The app hit an unexpected error and couldn't continue. Reloading usually fixes it - if
            it keeps happening, let us know what you were doing when it broke.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '0.6rem 1.4rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#89E900',
              color: '#0B141E',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
