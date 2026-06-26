export function Stepper({ steps, idx }: { steps: { key: string; label: string }[]; idx: number }) {
  return (
    <ol className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                active ? "bg-accent/15 text-accent font-medium" : done ? "text-accent2" : "text-muted"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? "bg-accent text-white" : done ? "bg-accent2/20 text-accent2" : "bg-panel2 text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
            {i < steps.length - 1 && <span className="text-border">—</span>}
          </li>
        );
      })}
    </ol>
  );
}
