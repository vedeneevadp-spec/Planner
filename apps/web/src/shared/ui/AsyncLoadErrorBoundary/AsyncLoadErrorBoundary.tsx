import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AsyncLoadErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
  onError?: ((error: Error, errorInfo: ErrorInfo) => void) | undefined
  resetKey?: string | undefined
}

interface AsyncLoadErrorBoundaryState {
  error: Error | null
}

export class AsyncLoadErrorBoundary extends Component<
  AsyncLoadErrorBoundaryProps,
  AsyncLoadErrorBoundaryState
> {
  state: AsyncLoadErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AsyncLoadErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo)
  }

  componentDidUpdate(previousProps: AsyncLoadErrorBoundaryProps): void {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback : this.props.children
  }
}
