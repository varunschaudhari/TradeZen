/**
 * @file ErrorBoundary.jsx
 * @description React class-based error boundary. Catches render errors in a
 *   subtree and shows a contained fallback card instead of a blank screen.
 *
 *   Usage:
 *     <ErrorBoundary label="Dashboard panel">
 *       <SomeComponent />
 *     </ErrorBoundary>
 */
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.label ?? 'component', error, info?.componentStack ?? '');
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="card border border-red-500/25 bg-red-500/5 p-6 my-4 text-center space-y-3">
        <p className="text-slate-400 font-semibold text-sm">
          {this.props.label
            ? `"${this.props.label}" failed to render`
            : 'A section failed to render'}
        </p>
        <p className="text-slate-500 text-xs font-mono break-words max-w-md mx-auto">
          {this.state.error?.message ?? 'Unknown error'}
        </p>
        <button
          onClick={this.reset}
          className="btn-ghost text-xs px-4 py-1.5"
        >
          Try again
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
