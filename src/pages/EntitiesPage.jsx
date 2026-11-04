import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchEntities } from "../api/qwantify";
import { usePollingResource } from "../hooks/usePollingResource";
import { ENTITY_TYPE_OPTIONS, filterEntities, isLinkText, normalizeEntities } from "../lib/entities";

export function EntityTypeBadge({ type }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
      {type}
    </span>
  );
}

export function EntityDescription({ text }) {
  if (!text) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (isLinkText(text)) {
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer"
        className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {text.replace(/^https?:\/\//i, "")}
      </a>
    );
  }
  return <span className="text-muted-foreground">{text}</span>;
}

export default function EntitiesPage() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");

  const resource = usePollingResource(() => fetchEntities(), [], {
    initialData: [],
    cacheKey: "entities:list",
    staleTimeMs: 300_000,
  });

  const entities = useMemo(() => normalizeEntities(resource.data), [resource.data]);
  const visible = useMemo(() => filterEntities(entities, { query, type }), [entities, query, type]);
  const countByType = useMemo(() => {
    const counts = { all: entities.length };
    entities.forEach((entity) => {
      counts[entity.type] = (counts[entity.type] ?? 0) + 1;
    });
    return counts;
  }, [entities]);

  if (resource.error && !entities.length) {
    return (
      <div className="rounded-sm border border-border bg-card p-6 text-sm text-muted-foreground">
        Failed to load entities: {resource.error.message}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-9 w-full max-w-md items-center gap-2 rounded-sm border border-border bg-background px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, type, description or X handle"
            aria-label="Search entities"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>

        <div className="flex items-center gap-1">
          {ENTITY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setType(option.value)}
              className={
                type === option.value
                  ? "rounded-sm bg-muted px-3 py-1.5 text-xs font-medium text-foreground"
                  : "rounded-sm px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              }
            >
              {option.label}
              <span className="ml-1 tabular-nums text-muted-foreground">{countByType[option.value] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-sm border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-light">Name</th>
              <th className="px-4 py-3 font-light">Type</th>
              <th className="px-4 py-3 font-light">Description</th>
              <th className="px-4 py-3 font-light">X</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((entity) => (
              <tr key={entity.id} className="border-b border-border/60 last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <Link to={`/entities/${entity.id}`} className="font-medium hover:underline">
                    {entity.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <EntityTypeBadge type={entity.type} />
                </td>
                <td className="max-w-md px-4 py-3">
                  <EntityDescription text={entity.description} />
                </td>
                <td className="px-4 py-3">
                  {entity.twitterHandle && entity.twitterUrl ? (
                    <a
                      href={entity.twitterUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {entity.twitterHandle}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!visible.length ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {resource.isLoading ? "Loading entities…" : "No entities match your search."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {visible.length} of {entities.length} entities, from Qwantify&apos;s shared entity list.
      </p>
    </div>
  );
}
