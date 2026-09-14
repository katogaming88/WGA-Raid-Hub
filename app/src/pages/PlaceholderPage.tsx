export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page" aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      <div className="card placeholder">
        <p>Not built yet. This page arrives in a later part of the rebuild.</p>
      </div>
    </section>
  );
}
