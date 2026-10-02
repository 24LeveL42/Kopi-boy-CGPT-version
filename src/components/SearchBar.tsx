"use client";
interface SearchBarProps { value: string; onChange: (value: string) => void; }
export function SearchBar({ value, onChange }: SearchBarProps) {
  return <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-[0_8px_24px_rgba(24,24,40,.07)] ring-1 ring-slate-100">
    <svg className="shrink-0" style={{color:"var(--kb-purple)"}} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input type="search" inputMode="search" value={value} onChange={e=>onChange(e.target.value)} placeholder="Search food, cooks or hawkers" aria-label="Search merchants" className="w-full bg-transparent text-[15px] font-medium outline-none placeholder:text-slate-400" />
    <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-purple-50 text-purple-700"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg></span>
  </div>;
}
