import type React from "react";

export type SearchMode = "keyword" | "semantic";

export function SearchModeSelect({
  className = "",
  onChange,
  value,
}: {
  className?: string;
  onChange: (value: SearchMode) => void;
  value: SearchMode;
}) {
  return (
    <select
      aria-label="Search mode"
      className={`filter-select focus-ring font-sans normal-case tracking-normal ${className}`}
      onChange={(event) => onChange(event.target.value as SearchMode)}
      value={value}
    >
      <option value="keyword">Keyword</option>
      <option value="semantic">Semantic</option>
    </select>
  );
}

export function EntityMetricGrid({
  className = "",
  items,
}: {
  className?: string;
  items: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className={`entity-metric-grid ${className}`}>
      {items.map((item) => (
        <EntityMetric key={item.label} label={item.label} value={item.value} />
      ))}
    </div>
  );
}

function EntityMetric({ value, label }: { value: React.ReactNode; label: string }) {
  const textValue = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const rangeParts = textValue.match(/^(\d{4})-(\d{4})$/);

  return (
    <div className="entity-metric">
      {rangeParts ? (
        <p className="entity-metric-value entity-metric-value-stacked plain-number">
          <span>{rangeParts[1]}</span>
          <span>{rangeParts[2]}</span>
        </p>
      ) : (
        <p className="entity-metric-value plain-number">{value}</p>
      )}
      <p className="entity-metric-label">{label}</p>
    </div>
  );
}
