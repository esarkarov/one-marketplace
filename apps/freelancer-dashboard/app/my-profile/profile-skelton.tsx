import { DashboardHeader } from "../_components/dashboard/dashboard-header";

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

export function ProfileSkeleton({ editing }: { editing: boolean }) {
  return (
    <div className="min-h-svh bg-[#f4f6f2] text-[#242724]">
      <DashboardHeader />
      <main
        aria-label="Loading profile"
        aria-busy="true"
        className="mx-auto max-w-360 animate-pulse px-5 py-8 sm:px-8 lg:py-10"
      >
        <Line className="h-4 w-36" />
        <div className="mt-5 flex items-end justify-between gap-5">
          <div>
            <Line className="h-9 w-48" />
            <Line className="mt-3 h-4 w-80 max-w-full" />
          </div>
          <Line className="h-11 w-44 rounded-xl" />
        </div>

        <div className="mt-8 grid items-start gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="grid gap-5">
            <Card className="p-5">
              <div className="mx-auto h-24 w-24 rounded-full bg-[#dce3d9]" />
              <Line className="mx-auto mt-5 h-5 w-36" />
              <Line className="mx-auto mt-3 h-3 w-28" />
              <Line className="mt-7 h-2 w-full" />
            </Card>

            {editing ? (
              <Card className="space-y-3 p-3">
                {[0, 1, 2, 3].map((item) => (
                  <div
                    key={item}
                    className="flex h-11 items-center gap-3 rounded-xl bg-[#f1f3ef] px-3"
                  >
                    <div className="h-5 w-5 rounded-md bg-[#dce2d9]" />
                    <Line className="h-3 w-28" />
                  </div>
                ))}
              </Card>
            ) : (
              <Card className="space-y-4 p-5">
                <Line className="h-4 w-32" />
                <Line className="h-3 w-full" />
                <Line className="h-3 w-4/5" />
              </Card>
            )}
          </aside>

          <div className="grid gap-5">
            {[editing ? 2 : 3, 3, editing ? 2 : 4].map((rows, index) => (
              <Card key={index} className="p-6 sm:p-8">
                <Line className="h-6 w-44" />
                <Line className="mt-3 h-3 w-72 max-w-full" />
                <div className="mt-7 grid gap-5 sm:grid-cols-2">
                  {Array.from({ length: rows }).map((_, row) => (
                    <div key={row}>
                      <Line className="mb-2 h-3 w-24" />
                      <div className="h-12 rounded-xl bg-[#eef1ec]" />
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
