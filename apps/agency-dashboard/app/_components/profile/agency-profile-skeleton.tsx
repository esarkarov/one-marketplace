const Line = ({ className = "" }: { className?: string }) => (
  <div className={`rounded-full bg-[#e1e5de] ${className}`} />
);

const Card = ({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={`rounded-2xl border border-black/7 bg-white ${className}`}>
    {children}
  </div>
);

export function AgencyProfileSkeleton() {
  return (
    <div aria-label="Loading agency profile" aria-busy="true" className="animate-pulse">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Line className="h-3 w-40" />
          <Line className="mt-3 h-9 w-56" />
          <Line className="mt-3 h-4 w-72 max-w-full" />
        </div>
        <Line className="h-11 w-52 rounded-xl" />
      </div>

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="grid gap-5">
          <Card className="p-6 text-center">
            <div className="mx-auto h-24 w-24 rounded-3xl bg-[#dce3d9]" />
            <Line className="mx-auto mt-5 h-5 w-32" />
            <Line className="mx-auto mt-3 h-3 w-24" />
            <Line className="mx-auto mt-3 h-3 w-36" />
            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-black/7 pt-4">
              {[0, 1, 2].map((item) => (
                <div key={item} className="grid justify-items-center gap-2">
                  <Line className="h-4 w-8" />
                  <Line className="h-2 w-10" />
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <Line className="h-4 w-28" />
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="flex items-center justify-between">
                <Line className="h-3 w-20" />
                <Line className="h-3 w-16" />
              </div>
            ))}
          </Card>
        </aside>

        <div className="grid min-w-0 gap-6">
          <Card className="p-6 sm:p-9">
            <Line className="h-3 w-52" />
            <Line className="mt-4 h-8 w-3/4" />
            <Line className="mt-3 h-4 w-full" />
            <Line className="mt-2 h-4 w-2/3" />
            <div className="mt-6 flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((item) => (
                <Line key={item} className="h-8 w-20" />
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-end justify-between">
              <div>
                <Line className="h-3 w-24" />
                <Line className="mt-2 h-5 w-40" />
              </div>
              <Line className="h-3 w-28" />
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {[0, 1].map((item) => (
                <div key={item} className="overflow-hidden rounded-xl border border-black/9">
                  <div className="aspect-video bg-[#e4ead8]" />
                  <div className="space-y-3 p-5">
                    <Line className="h-3 w-24" />
                    <Line className="h-4 w-3/4" />
                    <Line className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-end justify-between">
              <div>
                <Line className="h-3 w-28" />
                <Line className="mt-2 h-5 w-40" />
              </div>
              <Line className="h-3 w-24" />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-xl border border-black/7 p-4">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 shrink-0 rounded-full bg-[#dce3d9]" />
                    <div className="flex-1">
                      <Line className="h-3 w-28" />
                      <Line className="mt-2 h-3 w-20" />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-1.5">
                    <Line className="h-5 w-14" />
                    <Line className="h-5 w-14" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
