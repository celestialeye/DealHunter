import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";

import { createProjectAction } from "@/app/actions";
import { formatMoney } from "@/lib/format";
import { getProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = getProjects();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Hunt portfolio</p>
          <h1>Projects</h1>
          <p className="lede">
            Group products, retailer listings, alert conditions, budgets, and
            purchasing limits around a single acquisition goal.
          </p>
        </div>
      </header>

      <div className="section-grid">
        <section>
          <div className="project-grid">
            {projects.map((project) => (
              <Link
                className="project-card"
                href={`/projects/${String(project.id)}`}
                key={String(project.id)}
              >
                <p className="eyebrow">{String(project.status)}</p>
                <h2>{String(project.name)}</h2>
                <p>{String(project.description)}</p>
                <div className="project-card-foot">
                  <span>
                    {Number(project.product_count)} products ·{" "}
                    {Number(project.listing_count)} listings
                  </span>
                  <ArrowUpRight size={16} />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside className="panel">
          <div className="panel-head">
            <div>
              <h2>Create a hunt</h2>
              <p>Start with a goal and optional spending ceiling.</p>
            </div>
            <Plus size={18} />
          </div>
          <form className="panel-body form-grid" action={createProjectAction}>
            <div className="field field-wide">
              <label htmlFor="project-name">Project name</label>
              <input
                id="project-name"
                name="name"
                required
                minLength={2}
                data-testid="project-name"
                placeholder="Limited release console"
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="project-description">Goal</label>
              <textarea
                id="project-description"
                name="description"
                data-testid="project-description"
                placeholder="Track exact products and alert when trusted listings qualify."
              />
            </div>
            <div className="field field-wide">
              <label htmlFor="project-budget">Project budget (USD)</label>
              <input
                id="project-budget"
                name="budget"
                type="number"
                min="0"
                step="0.01"
                placeholder={formatMoney(75000).replace("$", "")}
              />
            </div>
            <div className="form-actions">
              <button
                className="button button-amber"
                type="submit"
                data-testid="create-project"
              >
                Create project
              </button>
            </div>
          </form>
        </aside>
      </div>
    </>
  );
}
