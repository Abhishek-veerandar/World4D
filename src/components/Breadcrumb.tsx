export type Crumb = { label: string; onClick?: () => void };

export default function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav className="breadcrumb" aria-label="Location">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${i}-${crumb.label}`} className="crumb">
            {crumb.onClick && !isLast ? (
              <button type="button" onClick={crumb.onClick}>
                {crumb.label}
              </button>
            ) : (
              <span aria-current={isLast ? 'location' : undefined}>{crumb.label}</span>
            )}
            {!isLast && <span className="crumb-sep">›</span>}
          </span>
        );
      })}
    </nav>
  );
}
