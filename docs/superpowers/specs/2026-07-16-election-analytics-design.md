# Election Analytics Design

**Date:** 2026-07-16
**Status:** Approved
**Project:** PPCRV Election Monitoring Platform

## Overview

Add election analytics to the PPCRV platform: a map view for geographic drill-down, vote share breakdown charts, and undervote/overvote analysis. All data sources are existing DuckDB Parquet files — no new infrastructure.

## Architecture

```
analytics page (/analytics)
├── MapView (Leaflet)
│   └── Drill-down: National → Region → Province → City
├── VoteShareChart (Recharts)
│   └── Bar/Pie chart linked to map selection
└── UndervotePanel
    └── Under/overvote rates with sparkline

Backend: NestJS AnalyticsController
└── Queries existing Parquet data via DuckDB (same pattern as ResultsService)
```

### Data Flow

1. Frontend analytics page loads → fetches geography completion stats from API
2. Map renders at national level with region polygons
3. User clicks region → API returns completion stats for provinces in that region
4. Vote share and undervote charts automatically filter to the selected geography
5. User can also pick a contest via dropdown to switch which contest is shown

No new database or caching layer. All analytics data is computed on-the-fly from Parquet.

### Dependencies Added

- `leaflet` + `@types/leaflet` — MIT, 40KB gzipped
- `react-leaflet` — React bindings for Leaflet, MIT
- `recharts` — Charting library, MIT
- `leaflet.photon` or similar for tile layer (OpenStreetMap tiles, free tier)

## Map View

### Drill-Down Hierarchy

| Level | Polygons | Metric Shown |
|-------|----------|-------------|
| National | 17 regions | % precincts reported per region |
| Region | Provinces in region | % precincts reported per province |
| Province | Cities/municipalities | % precincts reported per city |

### Color Scheme

- Green (#22c55e): ≥80% reported
- Yellow (#eab308): 50-79% reported
- Orange (#f97316): 20-49% reported
- Red (#ef4444): <20% reported
- Gray (#6b7280): no data

### Interactions

- Hover: tooltip with name, completion %, total precincts
- Click: zoom to next level
- Breadcrumb: `National > Region Name > Province Name` — any level clickable to go back
- Brighter colored area border on selection

### Boundary Data

- Simplified GeoJSON from PhilGIS or philippine-geodata npm packages
- Pre-processed with `mapshaper` to reduce polygon precision (target <1MB per level)
- Lazy-loaded: regions first, provinces on region click, cities on province click
- Served as static JSON files from `apps/web/src/app/analytics/data/`

## Vote Share Breakdown

### Chart (Bar/Pie Toggle)

- **Default**: Horizontal bar chart, top candidates ranked by votes
- **Toggle**: Switch to pie chart for proportional view
- **Contest selector**: Dropdown filters to any contest in the elected geography
- **Auto-filter**: When user clicks a region/province on the map, the chart updates to that geography
- **Data**: Same DuckDB Parquet, grouped by candidate, ordered by votes descending

### API Endpoint

```
GET /api/analytics/vote-share?contest=00399000&reg=&prv=&mun=
```

Returns: `{ candidates: [{ name, party, votes, percentage }], totalVotes }`

## Undervote/Overvote Analysis

### Panel

| Metric | Description |
|--------|-------------|
| Total Votes Cast | Sum of votes in selected geography/contest |
| Total Undervotes | Sum of undervotes |
| Total Overvotes | Sum of overvotes |
| Undervote Rate | Percentage of undervotes vs votes cast |
| Overvote Rate | Percentage of overvotes vs votes cast |
| Undervote Trend | Sparkline comparing rate across hierarchy levels |

- Overvotes highlighted in red if >0.5% (potential election integrity concern)
- Undervote rate compared to national average ("+0.3% higher than national")

### API Endpoint

```
GET /api/analytics/undervotes?contest=00399000&reg=&prv=&mun=
```

Returns: `{ totalVotes, totalUndervotes, totalOvervotes, undervoteRate, overvoteRate, nationalAvgUndervoteRate }`

### Sparkline Data

The sparkline shows undervote rate across the geographic path. For example:
- National: 2.7%
- Region selected: 3.0%
- Province selected: 3.2%

## Backend Structure

### New Files

```
apps/api/src/modules/analytics/
├── analytics.module.ts          # NestJS module
├── analytics.controller.ts      # REST controller
├── analytics.service.ts         # DuckDB query logic
└── dto/
    ├── vote-share-query.dto.ts  # Query params validation
    └── undervotes-query.dto.ts  # Query params validation
```

### Controller Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/vote-share` | Vote share for contest+geography |
| GET | `/api/analytics/undervotes` | Undervote/overvote metrics |
| GET | `/api/analytics/geography-status` | Completion % for all regions (initial map load) |

### Query Pattern

Reuses existing DuckDB query pattern from ResultsService:

```typescript
const sql = `
  SELECT reg_name, COUNT(DISTINCT pollplace) as total_precincts,
         SUM(CASE WHEN has_data THEN 1 ELSE 0 END) as reported_precincts
  FROM '${parquetBase}/national/**/*.parquet'
  ${whereClause}
  GROUP BY reg_name
`;
```

## Frontend Structure

### New Files

```
apps/web/src/app/analytics/
├── page.tsx                          # Main analytics page
├── components/
│   ├── map-view.tsx                  # Leaflet map with drill-down
│   ├── vote-share-chart.tsx          # Bar/pie chart (Recharts)
│   ├── undervote-panel.tsx           # Under/overvote stats
│   ├── geography-breadcrumb.tsx      # Navigation breadcrumb
│   └── contest-selector.tsx          # Contest dropdown
├── hooks/
│   └── use-analytics.ts             # Data fetching + state management
├── types.ts                         # TypeScript interfaces
└── data/
    ├── regions.json                  # Simplified regions GeoJSON
    ├── provinces.json                # Simplified provinces GeoJSON
    └── cities.json                   # Simplified cities GeoJSON
```

### Layout

```
┌──────────────────────────────────────────────┐
│  Contest Selector ▼  |  Breadcrumb           │
├────────────────────────┬─────────────────────┤
│                        │                      │
│    Map View            │  Vote Share Chart    │
│    (Leaflet)           │  (Bar/Pie toggle)    │
│                        │                      │
│                        ├─────────────────────┤
│                        │  Undervote Panel     │
│                        │  - rates + sparkline │
│                        │                      │
├────────────────────────┴─────────────────────┤
│  Legend:  Green=high  Yellow=mid  Red=low     │
└──────────────────────────────────────────────┘
```

Two-column layout on desktop, stacked on mobile.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No data for geography | Gray fill, tooltip says "No data" |
| Missing GeoJSON | Fallback to name-based list view |
| DuckDB query failure | 500 with error message, frontend shows error toast |
| Slow tile load | Leaflet default tile loading behavior |
| Empty contest results | "No results found for this contest in this area" |

## Testing

- `analytics.controller.spec.ts` — endpoint response shape, validation errors
- `analytics.service.spec.ts` — query building, edge cases (missing params)
- Frontend component tests — rendering with mock data, drill-down interactions, empty states

## Open Items

| # | Item | Status |
|---|------|--------|
| 1 | Source and simplify Philippines GeoJSON boundaries | Pending |
| 2 | Generate `reg_name` mapping to ensure Parquet region names match GeoJSON region names | Pending |
| 3 | Decide on Leaflet tile layer (OSM vs other) | Pending |
