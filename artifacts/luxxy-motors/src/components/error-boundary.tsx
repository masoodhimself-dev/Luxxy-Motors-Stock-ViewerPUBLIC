import React, { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from '@/components/ui/button';

interface Props {
  children?: ReactNode;
  resetKey?: any;
  showCustomerHelp?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="luxxy-shell flex min-h-[60vh] items-center justify-center px-4 py-12 sm:px-6">
          <section className="w-full max-w-xl rounded-sm border border-border bg-card p-6 sm:p-10" role="alert">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
              <AlertTriangle className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h1 className="heading-2 text-primary">This page couldn’t load</h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              Please try again. If the problem continues, contact the team and tell them which page you were opening.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Button
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </Button>{this.props.showCustomerHelp !== false && <Button asChild variant="outline"><a href="/contact">Contact the showroom</a></Button>}</div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
