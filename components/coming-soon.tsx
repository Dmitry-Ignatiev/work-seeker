export function ComingSoon({ title, phase, children }: { title: string; phase: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{children ?? `Arrives in phase ${phase} of the roadmap.`}</p>
    </div>
  );
}
