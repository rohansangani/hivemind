export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={"inline-block rounded-full border-2 border-current/30 border-t-current animate-spin align-[-2px] " + className}
      style={{ width: size, height: size }}
    />
  );
}
