import Image from "next/image";
export function LogoCard() {
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#6f2fe3] via-[#7b3fe4] to-[#10b981] p-5 shadow-[0_14px_40px_rgba(91,33,182,.18)]">
      <div className="absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/10" />
      <div className="absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-black/10" />
      <div className="relative flex min-h-[155px] items-end justify-between gap-4">
        <div className="max-w-[65%] text-white">
          <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">Local food. Local people.</span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight">Good food,<br/>from your neighbourhood.</h1>
          <p className="mt-2 text-sm text-white/85">Discover home cooks and hawkers near you.</p>
        </div>
        <Image src="/brand/logo-icon.png" alt="Kopi Boy" width={150} height={130} className="mb-1 h-28 w-auto object-contain drop-shadow-xl" priority />
      </div>
    </section>
  );
}
