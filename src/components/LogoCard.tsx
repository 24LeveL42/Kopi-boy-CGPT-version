import Image from "next/image";
export function LogoCard() {
  return <section className="kb-home-hero">
    <Image src="/categories/home-cooks.jpg" alt="Local food" fill sizes="(max-width:768px) 100vw, 700px" className="kb-hero-photo" priority />
    <div className="kb-hero-overlay" />
    <div className="relative z-10 grid min-h-[220px] grid-cols-[1fr_auto] items-center gap-3 p-5 sm:p-7">
      <div className="max-w-[18rem] text-white"><span className="kb-hero-kicker">LOCAL FOOD · LOCAL PEOPLE</span><h1 className="mt-3 text-[29px] font-black leading-[1.03] tracking-[-.04em] sm:text-[34px]">Good food,<br/>from your<br/>neighbourhood.</h1><p className="mt-3 text-sm leading-5 text-white/85">Discover home cooks and hawkers near you.</p></div>
      <div className="kb-hero-logo-wrap"><Image src="/brand/logo-icon.png" alt="Kopi Boy" width={145} height={145} className="h-28 w-28 object-contain drop-shadow-2xl sm:h-36 sm:w-36" /></div>
    </div>
    <div className="kb-hero-ribbon"><span>🍜 Real food</span><i/> <span>👨‍🍳 Real people</span><i/> <span>🏷 No platform fee</span></div>
  </section>;
}
