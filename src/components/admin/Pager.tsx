/** Previous / Next paging under admin tables. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="admin-pager">
      <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
