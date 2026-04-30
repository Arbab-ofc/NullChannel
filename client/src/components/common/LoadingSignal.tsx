type LoadingSignalProps = {
  label?: string;
  className?: string;
};

export const LoadingSignal = ({ label = 'Loading', className = '' }: LoadingSignalProps) => (
  <span className={`loading-signal inline-flex items-center gap-2 ${className}`} aria-live="polite">
    <span className="loading-signal__bars" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    <span>{label}</span>
  </span>
);
