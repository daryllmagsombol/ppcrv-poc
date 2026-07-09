interface BreadcrumbNavProps {
  filters: Record<string, string>;
}

export function BreadcrumbNav({ filters }: BreadcrumbNavProps) {
  const crumbs: string[] = [];

  if (filters.reg) crumbs.push(filters.reg);
  if (filters.prv) crumbs.push(filters.prv);
  if (filters.mun) crumbs.push(filters.mun);
  if (filters.brgy) crumbs.push(filters.brgy);
  if (filters.vc) crumbs.push(filters.vc);

  if (crumbs.length === 0) crumbs.push('National');

  return (
    <nav className="mb-4 text-sm text-gray-500">
      {crumbs.map((crumb, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-2">›</span>}
          <span className={i === crumbs.length - 1 ? 'font-semibold text-[#1B3A5C]' : ''}>
            {crumb}
          </span>
        </span>
      ))}
    </nav>
  );
}
