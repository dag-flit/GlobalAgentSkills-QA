"use client";

// Marco visual compartido por las pantallas de login y registro (centrado, sin sidebar).
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent font-bold text-lg">
            Q
          </span>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-white">
            Quality<span className="text-accent">Ops</span>
          </h1>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
          <div className="mt-4">{children}</div>
        </div>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      </div>
    </div>
  );
}
