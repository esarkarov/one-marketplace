import { Icon } from "@iconify/react";

type OngoingProject = {
  id: string;
  title: string;
  client: string;
  created_at: string | null;
  amount: number;
};

export function OngoingProjects({ projects }: { projects: OngoingProject[] }) {
  if (!projects.length) return null;

  return (
    <section className="rounded-2xl border border-black/8 bg-white p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[.13em] text-[#62805f] uppercase">
            In progress
          </p>
          <h2 className="mt-2 text-xl font-semibold">Ongoing projects</h2>
        </div>
        <p className="text-xs text-[#8a8f87]">
          {projects.length} active {projects.length === 1 ? "project" : "projects"}
        </p>
      </div>

      <div className="grid gap-4">
        {projects.map((project) => (
          <article
            key={project.id}
            className="rounded-xl border border-black/7 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{project.title}</h3>
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#edf4ea] px-2 py-0.5 text-[10px] font-semibold text-[#52784f]">
                    <Icon icon="solar:clock-circle-linear" width="12" />
                    In progress
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#7b8078]">
                  {project.client} · Started{" "}
                  {project.created_at
                    ? new Date(project.created_at).toLocaleDateString(
                        "en-US",
                        { month: "long", year: "numeric" },
                      )
                    : "recently"}
                </p>
              </div>
              <p className="text-sm font-semibold">
                ${Number(project.amount).toLocaleString()}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
