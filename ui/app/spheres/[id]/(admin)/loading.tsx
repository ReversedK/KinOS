/**
 * Instant loading state for the workspace sections. Now that each section is its
 * own route (iteration 122), a tab click is a server fetch; this skeleton paints
 * immediately so navigation feels responsive instead of hanging. The layout chrome
 * (rail, header) stays mounted — only this content area is replaced while the
 * section resolves. Generic on purpose: it reads as "loading" for any section.
 */
function Bar({ w }: { w: string }) {
  return <div className="skeleton skeleton-line" style={{ width: w }} />;
}

export default function SectionLoading() {
  return (
    <div className="stack loose" aria-busy="true" aria-label="Loading section">
      {[0, 1].map((panel) => (
        <div key={panel} className="panel">
          <div className="panel-head">
            <div className="skeleton skeleton-line" style={{ width: 160, height: 14 }} />
          </div>
          <div className="panel-body stack">
            {[0, 1, 2].map((row) => (
              <div key={row} className="row" style={{ gap: "var(--s4)", alignItems: "center" }}>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
                <div className="stack tight" style={{ flex: 1, gap: 8 }}>
                  <Bar w={`${70 - row * 12}%`} />
                  <Bar w={`${45 - row * 8}%`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
