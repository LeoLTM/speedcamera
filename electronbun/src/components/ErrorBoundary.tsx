import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
          <div className="flex items-center justify-center size-14 rounded-2xl bg-destructive/10 text-destructive text-2xl select-none">
            ⚠
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Something went wrong</p>
            {this.state.error && (
              <p className="text-sm text-muted-foreground font-mono truncate max-w-sm">
                {this.state.error.message}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={this.handleReset}>
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
