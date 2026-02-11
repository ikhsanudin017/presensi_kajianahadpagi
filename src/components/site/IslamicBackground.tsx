import Image from "next/image";

export function IslamicBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-2 top-0 h-24 w-16 opacity-65 md:left-6 md:h-36 md:w-24">
        <Image
          src="/assets/ornamen%20atas.jpg"
          alt=""
          fill
          sizes="(max-width: 768px) 64px, 96px"
          className="object-contain object-top"
          priority
        />
      </div>

      <div className="absolute right-2 top-0 h-24 w-16 opacity-65 md:right-6 md:h-36 md:w-24">
        <Image
          src="/assets/ornamen%20atas.jpg"
          alt=""
          fill
          sizes="(max-width: 768px) 64px, 96px"
          className="object-contain object-top"
          priority
        />
      </div>

      <Image
        src="/assets/masjid.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover object-center opacity-45"
        priority
      />

      <div className="absolute inset-x-0 bottom-0 h-[280px] bg-gradient-to-t from-[rgba(247,241,230,0.85)] via-[rgba(247,241,230,0.22)] to-transparent md:h-[360px]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.56),rgba(247,241,230,0.14)_52%,rgba(247,241,230,0.35)_95%)]" />
    </div>
  );
}
