interface BreadcrumbNavProps {
  filters: Record<string, string>;
}

export function BreadcrumbNav({ filters }: BreadcrumbNavProps) {
  const crumbs: string[] = [];

  if (filters.region) crumbs.push(filters.region);
  if (filters.province) crumbs.push(filters.province);
  if (filters.municipality) crumbs.push(filters.municipality);
  if (filters.barangay) crumbs.push(filters.barangay);
  if (filters.votingCenter) crumbs.push(filters.votingCenter);

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
