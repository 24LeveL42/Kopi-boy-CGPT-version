"use client";
interface SearchBarProps { value: string; onChange: (value: string) => void; }
export function SearchBar({ value, onChange }: SearchBarProps) {
  return <label className="kb-search-wrap"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" inputMode="search" value={value} onChange={e=>onChange(e.target.value)} placeholder="What are you craving today?" aria-label="Search food, cooks or hawkers"/><span className="kb-search-filter"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg></span></label>;
}
