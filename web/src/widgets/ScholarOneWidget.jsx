import React, { useState } from 'react'
import { api } from '../lib/api'

// ScholarOneWidget: on-demand retrieval of paper (Author) and review (Reviewer)
// status across ScholarOne journal sites. The user enters their login(s); we ask
// the local backend to drive a headless browser, log in to each site, and read
// the dashboards. Credentials live only in this component's memory for the
// duration of a retrieval — they are never saved to the dashboard config. Only
// the scraped results are cached (in widget.state) so they survive a reload
// until the next retrieval.
export default function ScholarOneWidget({ widget, onChange }) {
  const s = widget.settings || {}
  const st = widget.state || { results: [], retrievedAt: '' }
  const sites = s.sites || []
  const enabledSites = sites.filter((x) => x.enabled !== false)
  const sameCreds = s.sameCreds !== false

  const [showSettings, setShowSettings] = useState(false)
  const [editingCreds, setEditingCreds] = useState(false) // force the form back even with cached results
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Credentials: kept in component state only, cleared after each retrieval.
  const [shared, setShared] = useState({ username: '', password: '' })
  const [perSite, setPerSite] = useState({}) // key -> { username, password }

  // Which view (papers/reviews) each result section shows; default papers.
  const [view, setView] = useState({})
  // Which journal tab is open; '' falls back to the first result.
  const [activeKey, setActiveKey] = useState('')

  const results = st.results || []
  const hasResults = results.length > 0
  const showForm = !hasResults || editingCreds

  // --- helpers --------------------------------------------------------------

  const update = (patch) => onChange({ ...widget, ...patch })
  const setSites = (next) => update({ settings: { ...s, sites: next } })

  const credFor = (key) => perSite[key] || { username: '', password: '' }
  const setCredFor = (key, patch) =>
    setPerSite((p) => ({ ...p, [key]: { ...credFor(key), ...patch } }))

  const retrieve = async () => {
    setErr('')
    if (!enabledSites.length) {
      setErr('Add at least one journal site in settings (⚙).')
      return
    }
    const creds = enabledSites.map((site) => {
      const c = sameCreds ? shared : credFor(site.key)
      return {
        key: site.key,
        name: site.name,
        url: site.url,
        username: (c.username || '').trim(),
        password: c.password || '',
      }
    })
    if (creds.some((c) => !c.username || !c.password)) {
      setErr('Enter a username and password for every site.')
      return
    }
    setBusy(true)
    try {
      const res = await api.scholarOne(creds)
      update({ state: { results: res, retrievedAt: new Date().toISOString() } })
      setEditingCreds(false)
      setShared({ username: '', password: '' }) // forget credentials immediately
      setPerSite({})
    } catch (e) {
      setErr(e.message || 'Retrieval failed.')
    } finally {
      setBusy(false)
    }
  }

  // --- settings -------------------------------------------------------------

  if (showSettings) {
    return (
      <div className="s1">
        <div className="section">
          <div className="s1-label">Journal sites</div>
          <div className="feed-edit-list">
            {sites.map((site, i) => (
              <div key={i} className="s1-site-edit">
                <input
                  type="checkbox"
                  title="Include in retrieval"
                  checked={site.enabled !== false}
                  onChange={(e) => {
                    const next = [...sites]
                    next[i] = { ...site, enabled: e.target.checked }
                    setSites(next)
                  }}
                />
                <div style={{ flex: 1 }}>
                  <input
                    className="feed-name-input"
                    value={site.name}
                    placeholder="Journal name"
                    onChange={(e) => {
                      const next = [...sites]
                      next[i] = { ...site, name: e.target.value }
                      setSites(next)
                    }}
                  />
                  <input
                    className="feed-name-input s1-url-input"
                    value={site.url}
                    placeholder="https://mc.manuscriptcentral.com/…"
                    onChange={(e) => {
                      const next = [...sites]
                      next[i] = { ...site, url: e.target.value }
                      setSites(next)
                    }}
                  />
                </div>
                <button
                  className="chip-x"
                  title="Remove site"
                  onClick={() => setSites(sites.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            className="btn"
            style={{ marginTop: 8 }}
            onClick={() =>
              setSites([...sites, { key: 's' + Date.now(), name: '', url: '', enabled: true }])
            }
          >
            + Add site
          </button>
        </div>
        <button className="btn primary" onClick={() => setShowSettings(false)}>
          Done
        </button>
      </div>
    )
  }

  // --- retrieving -----------------------------------------------------------

  if (busy) {
    return (
      <div className="s1 s1-center">
        <div className="s1-spinner" />
        <div className="s1-retrieving">Retrieving…</div>
        <div className="s1-sub">
          Logging in to each journal site in the background. This can take up to a
          minute.
        </div>
      </div>
    )
  }

  // --- credential form ------------------------------------------------------

  if (showForm) {
    return (
      <div className="s1">
        <div className="s1-head">
          <div className="s1-title">Retrieve paper &amp; review status</div>
          <button className="head-btn" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </div>

        {!enabledSites.length && (
          <div className="center-note">No sites enabled. Add one in settings (⚙).</div>
        )}

        <label className="s1-check s1-samecreds">
          <input
            type="checkbox"
            checked={sameCreds}
            onChange={(e) => update({ settings: { ...s, sameCreds: e.target.checked } })}
          />
          Use the same username &amp; password for every site
        </label>

        {sameCreds ? (
          <div className="s1-cred-block">
            <input
              className="s1-input"
              placeholder="Username"
              autoComplete="off"
              value={shared.username}
              onChange={(e) => setShared({ ...shared, username: e.target.value })}
            />
            <input
              className="s1-input"
              type="password"
              placeholder="Password"
              autoComplete="off"
              value={shared.password}
              onChange={(e) => setShared({ ...shared, password: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && retrieve()}
            />
            <div className="s1-sites-note">
              For: {enabledSites.map((x) => x.name || x.key).join(', ')}
            </div>
          </div>
        ) : (
          enabledSites.map((site) => (
            <div key={site.key} className="s1-cred-block">
              <div className="s1-cred-site">{site.name || site.key}</div>
              <input
                className="s1-input"
                placeholder="Username"
                autoComplete="off"
                value={credFor(site.key).username}
                onChange={(e) => setCredFor(site.key, { username: e.target.value })}
              />
              <input
                className="s1-input"
                type="password"
                placeholder="Password"
                autoComplete="off"
                value={credFor(site.key).password}
                onChange={(e) => setCredFor(site.key, { password: e.target.value })}
              />
            </div>
          ))
        )}

        {err && <div className="err-note" style={{ marginTop: 8 }}>{err}</div>}

        <div className="s1-actions">
          <button className="btn primary" onClick={retrieve} disabled={!enabledSites.length}>
            Retrieve
          </button>
          {hasResults && (
            <button className="btn" onClick={() => setEditingCreds(false)}>
              Cancel
            </button>
          )}
        </div>

        <div className="s1-privacy">
          🔒 Credentials are sent only to your local RabbitHome, used once to log
          in, and never stored.
        </div>
      </div>
    )
  }

  // --- results --------------------------------------------------------------

  return (
    <div className="s1">
      <div className="s1-head">
        <div className="s1-title">Submission &amp; review status</div>
        <div>
          <button
            className="head-btn"
            title="Retrieve again"
            onClick={() => {
              setErr('')
              setEditingCreds(true)
            }}
          >
            ↻
          </button>
          <button className="head-btn" onClick={() => setShowSettings(true)}>
            ⚙
          </button>
        </div>
      </div>

      {(() => {
        const active = results.find((r) => r.key === activeKey) || results[0]
        if (!active) return null
        const cur = view[active.key] || 'papers'
        return (
          <div className="s1-results">
            {/* One tab per journal. */}
            <div className="s1-jtabs">
              {results.map((r) => (
                <button
                  key={r.key}
                  className={'s1-jtab' + (r.key === active.key ? ' active' : '')}
                  onClick={() => setActiveKey(r.key)}
                >
                  {r.name || r.key}
                  {r.error ? ' ⚠' : ''}
                </button>
              ))}
            </div>

            <div className="s1-section">
              {active.error ? (
                <div className="err-note">⚠ {active.error}</div>
              ) : (
                <>
                  <div className="s1-toggle">
                    <button
                      className={'s1-tab' + (cur === 'papers' ? ' active' : '')}
                      onClick={() => setView({ ...view, [active.key]: 'papers' })}
                    >
                      Paper
                      {paperBlocks(active.papers).length
                        ? ` (${paperBlocks(active.papers).length})`
                        : ''}
                    </button>
                    <button
                      className={'s1-tab' + (cur === 'reviews' ? ' active' : '')}
                      onClick={() => setView({ ...view, [active.key]: 'reviews' })}
                    >
                      Review{(active.reviews || []).length ? ` (${active.reviews.length})` : ''}
                    </button>
                  </div>

                  {cur === 'papers' ? (
                    <PaperBlocks papers={active.papers} note={active.paperError} />
                  ) : (
                    <ReviewList reviews={active.reviews} note={active.reviewError} />
                  )}
                </>
              )}
            </div>
          </div>
        )
      })()}

      {st.retrievedAt && (
        <div className="s1-footer">Last retrieved {fmtTime(st.retrievedAt)}</div>
      )}
    </div>
  )
}

// splitId separates a manuscript ID into the base (the part shared across
// revisions) and its revision number. Revisions are suffixed ".R1", ".R2", … —
// e.g. "ISRE-2025-2185.R2" → base "ISRE-2025-2185", rev 2. The suffix is NOT
// removed from the displayed ID; it's only used to group the versions together.
function splitId(id) {
  const s = (id || '').trim()
  const m = s.match(/^(.*?)\.R(\d+)\s*$/i)
  if (m) return { base: m[1], rev: parseInt(m[2], 10) }
  return { base: s, rev: 0 }
}

// paperBlocks groups the Author rows by base ID so every revision of one
// manuscript (ISRE-…-2185, .R1, .R2) lands in a single block, ordered oldest →
// newest. Grouping is by base ID only — never by title, which can change across
// revisions. Each block keeps the most recent revision's title as its name.
function paperBlocks(papers) {
  const order = []
  const map = new Map()
  ;(papers || []).forEach((p) => {
    const { base, rev } = splitId(p.id)
    const key = base || p.id || '(no id)'
    if (!map.has(key)) {
      map.set(key, { base: key, versions: [] })
      order.push(key)
    }
    map.get(key).versions.push({ ...p, _rev: rev })
  })
  return order.map((key) => {
    const blk = map.get(key)
    blk.versions.sort((a, b) => a._rev - b._rev)
    const latest = blk.versions[blk.versions.length - 1]
    // Prefer the newest revision's title, but fall back to any non-empty one.
    blk.title =
      latest.title ||
      [...blk.versions].reverse().map((v) => v.title).find(Boolean) ||
      '(untitled submission)'
    return blk
  })
}

// PaperBlocks renders one block per manuscript, each listing all its revisions'
// progress oldest → newest, or a fallback note.
function PaperBlocks({ papers, note }) {
  const blocks = paperBlocks(papers)
  if (!blocks.length) {
    return <div className="s1-empty">{note || 'No paper information.'}</div>
  }
  return (
    <div className="s1-list">
      {blocks.map((blk) => (
        <div key={blk.base} className="s1-block">
          <div className="s1-block-title">{blk.title}</div>
          <div className="s1-block-base">
            {blk.base}
            {blk.versions.length > 1 && (
              <span className="s1-vcount"> · {blk.versions.length} versions</span>
            )}
          </div>
          {blk.versions.map((p, i) => (
            <div key={i} className="s1-version">
              <div className="s1-paper-row">
                {p.id && <span className="s1-id">{p.id}</span>}
                {p.status && <span className="s1-badge">{p.status}</span>}
              </div>
              {p.editors && p.editors.length > 0 && (
                <div className="s1-editors">{p.editors.join(' · ')}</div>
              )}
              {(p.submittingAuthor || p.created || p.submitted) && (
                <div className="s1-dates">
                  {p.submittingAuthor && <>Submitting author: {p.submittingAuthor} · </>}
                  {p.created && <>Created {p.created}</>}
                  {p.submitted && <> · Submitted {p.submitted}</>}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ReviewList renders the Reviewer dashboard rows generically (column headers are
// preserved as labels), or a fallback note.
function ReviewList({ reviews, note }) {
  if (!reviews || !reviews.length) {
    return <div className="s1-empty">{note || 'No review information.'}</div>
  }
  return (
    <div className="s1-list">
      {reviews.map((r, i) => (
        <div key={i} className="s1-review">
          {(r.columns || [])
            .filter((c) => c.value)
            .map((c, j) => (
              <div key={j} className="s1-col">
                {c.label && <span className="s1-col-label">{c.label}</span>}
                <span className="s1-col-val">{c.value}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

// fmtTime turns an ISO timestamp into a short local "today / date + time" label.
function fmtTime(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (d.toDateString() === now.toDateString()) return `today ${time}`
    return `${d.toLocaleDateString()} ${time}`
  } catch {
    return ''
  }
}
