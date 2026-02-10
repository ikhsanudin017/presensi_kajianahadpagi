import Image from "next/image";

export function IslamicBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: "url('/assets/pattern-arabesque.svg')",
          backgroundSize: "512px 512px",
        }}
      />

      <div className="absolute -left-4 top-0 h-52 w-36 opacity-70 md:h-72 md:w-52">
        <Image
          src="/assets/lantern-left.svg"
          alt=""
          fill
          sizes="(max-width: 768px) 140px, 220px"
          className="object-contain object-top"
          priority
        />
      </div>

      <div className="absolute -right-4 top-0 h-52 w-36 opacity-70 md:h-72 md:w-52">
        <Image
          src="/assets/lantern-right.svg"
          alt=""
          fill
          sizes="(max-width: 768px) 140px, 220px"
          className="object-contain object-top"
          priority
        />
      </div>

      <div className="absolute inset-x-0 bottom-[-6px] h-[220px] md:h-[340px]">
        <Image
          src="/assets/mosque-illustration.png"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-bottom opacity-55"
          priority
        />
      </div>

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.56),rgba(247,241,230,0.18)_48%,rgba(247,241,230,0.4)_95%)]" />
    </div>
  );
}
