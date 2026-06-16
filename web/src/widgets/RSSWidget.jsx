import React, { useState, useEffect, useRef } from 'react'
import { usePoll } from '../lib/usePoll'
import { api } from '../lib/api'
import { toast } from '../lib/notify'

// RSSWidget features:
//  - filter words -> categorize feeds into matching categories + "Other"
//  - configurable length; the body scrolls within the fixed widget height
//  - per-item "Ignore" removes it permanently (stored in state.ignored)
//  - notifications (toast + native) for newly-arrived items
//  - read items dim and stop "shining" (stored in state.read)
//
// Feeds are added/removed via buttons in the settings panel (no config file).

const timeAgo = (iso) => {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m`
  if (diff < 86400) return `${Math.round(diff / 3600)}h`
  return `${Math.round(diff / 86400)}d`
}

export default function RSSWidget({ widget, onChange }) {
  const s = widget.settings
  const st = widget.state || { read: [], ignored: [], seen: [] }
  const [showSettings, setShowSettings] = useState(s.feeds.length === 0)
  const [collapsed, setCollapsed] = useState(() => new Set()) // collapsed category names
  const toggleCat = (name) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })

  // Fetch every configured feed in parallel and merge, newest first.
  const { data, error, loading } = usePoll(
    async () => {
      const lists = await Promise.all(
        s.feeds.map((u) => api.rss(u).catch(() => [])), // one bad feed won't kill the rest
      )
      const merged = lists.flat()
      merged.sort((a, b) => (b.published || '').localeCompare(a.published || ''))
      return merged
    },
    5 * 60 * 1000, // refresh every 5 min
    [s.feeds.join('|')],
  )

  // Notify on newly-seen items (5.4). Skip the very first population.
  const firstLoad = useRef(true)
  useEffect(() => {
    if (!data) return
    const seen = new Set(st.seen)
    const fresh = data.filter((it) => it.guid && !seen.has(it.guid))
    if (firstLoad.current) {
      firstLoad.current = false
    } else if (fresh.length > 0) {
      toast({
        title: `📰 ${fresh.length} new in ${widget.title}`,
        body: fresh[0].title,
      })
    }
    if (fresh.length > 0) {
      // Remember up to the latest 500 guids so "new" detection stays bounded.
      const nextSeen = [...data.map((it) => it.guid), ...st.seen].filter(Boolean)
      patch({ state: { ...st, seen: Array.from(new Set(nextSeen)).slice(0, 500) } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const patch = (p) => onChange({ ...widget, ...p })
  const setSettings = (p) => patch({ settings: { ...s, ...p } })
  const markRead = (guid) => {
    if (st.read.includes(guid)) return
    patch({ state: { ...st, read: [...st.read, guid].slice(-1000) } })
  }
  const ignore = (guid) =>
    patch({ state: { ...st, ignored: [...st.ignored, guid].slice(-1000) } })

  if (showSettings) {
    return <RSSSettings widget={widget} setSettings={setSettings} done={() => setShowSettings(false)} />
  }
  if (loading && !data) return <div className="center-note">Loading feeds…</div>
  if (s.feeds.length === 0) return <div className="center-note">No feeds yet. Click ⚙ to add one.</div>

  // Apply ignore + length, then categorize by filter words.
  const ignored = new Set(st.ignored)
  const read = new Set(st.read)
  const visible = (data || []).filter((it) => !ignored.has(it.guid)).slice(0, s.length || 50)
  const categories = categorize(visible, s.filters)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="head-btn" onClick={() => setShowSettings(true)} title="Feed settings">⚙</button>
      </div>
      {error && <div className="err-note">Some feeds failed: {error}</div>}
      {categories.map(({ name, items }) => {
        const hasHeader = categories.length > 1
        const isCollapsed = hasHeader && collapsed.has(name)
        return (
        <div key={name}>
          {hasHeader && (
            <div className="feed-cat clickable" onClick={() => toggleCat(name)}>
              <span className="cat-arrow">{isCollapsed ? '▶' : '▼'}</span>
              {name}
              <span className="cat-count">{items.length}</span>
            </div>
          )}
          {!isCollapsed && (
          <ul className="feed-list">
            {items.map((it) => (
              <li key={it.guid} className={'feed-item' + (read.has(it.guid) ? ' read' : '')}>
                <div style={{ flex: 1 }}>
                  <a href={it.link} target="_blank" rel="noreferrer" onClick={() => markRead(it.guid)}>
                    {it.title}
                  </a>
                  <div className="meta">{it.source} · {timeAgo(it.published)}</div>
                </div>
                <button className="ignore" title="Ignore" onClick={() => ignore(it.guid)}>✕</button>
              </li>
            ))}
          </ul>
          )}
        </div>
        )
      })}
    </div>
  )
}

// categorize buckets items by filter word (case-insensitive title match). An
// item matching no filter falls into "Other". With no filters, one "All" bucket.
function categorize(items, filters) {
  if (!filters || filters.length === 0) return [{ name: 'All', items }]
  const buckets = filters.map((f) => ({ name: f, items: [], test: f.toLowerCase() }))
  const other = { name: 'Other', items: [] }
  for (const it of items) {
    const title = (it.title || '').toLowerCase()
    let matched = false
    for (const b of buckets) {
      if (title.includes(b.test)) { b.items.push(it); matched = true }
    }
    if (!matched) other.items.push(it)
  }
  return [...buckets, other].filter((b) => b.items.length > 0).map(({ name, items }) => ({ name, items }))
}

// RSSSettings: add/remove feeds + filters via buttons, set length.
function RSSSettings({ widget, setSettings, done }) {
  const s = widget.settings
  const [feed, setFeed] = useState('')
  const [filter, setFilter] = useState('')

  const addFeed = () => {
    const u = feed.trim()
    if (u && !s.feeds.includes(u)) setSettings({ feeds: [...s.feeds, u] })
    setFeed('')
  }
  const addFilter = () => {
    const f = filter.trim()
    if (f && !s.filters.includes(f)) setSettings({ filters: [...s.filters, f] })
    setFilter('')
  }

  return (
    <div>
      <div className="section">
        <label>Feeds (RSS/Atom URLs)</label>
        <div className="chips">
          {s.feeds.map((u) => (
            <span className="chip" key={u}>{shortUrl(u)}<button onClick={() => setSettings({ feeds: s.feeds.filter((x) => x !== u) })}>✕</button></span>
          ))}
          {s.feeds.length === 0 && <span className="muted-note">none yet</span>}
        </div>
        <div className="inline-add">
          <input value={feed} onChange={(e) => setFeed(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFeed()} placeholder="https://example.com/feed.xml" />
          <button className="btn primary" onClick={addFeed}>Add</button>
        </div>
      </div>

      <div className="section">
        <label>Filter words (categorize by title)</label>
        <div className="chips">
          {s.filters.map((f) => (
            <span className="chip" key={f}>{f}<button onClick={() => setSettings({ filters: s.filters.filter((x) => x !== f) })}>✕</button></span>
          ))}
          {s.filters.length === 0 && <span className="muted-note">none — feeds show as one list</span>}
        </div>
        <div className="inline-add">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addFilter()} placeholder="e.g. AI" />
          <button className="btn" onClick={addFilter}>Add</button>
        </div>
      </div>

      <div className="section">
        <label>Max items: {s.length}</label>
        <input type="range" min="10" max="100" step="5" value={s.length} onChange={(e) => setSettings({ length: Number(e.target.value) })} style={{ width: '100%' }} />
      </div>

      <button className="btn primary" onClick={done}>Done</button>
    </div>
  )
}

const shortUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
